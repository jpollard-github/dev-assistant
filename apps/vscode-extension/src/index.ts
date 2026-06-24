import { readFileSync } from "node:fs";
import { extname, join } from "node:path";

import type { ApprovalDecision, ApprovalRequest, TaskEvent } from "@dev-assistant/core";
import * as vscode from "vscode";

import { describeEvent, ExtensionStateStore, isActiveTask, type ExtensionTaskSummary } from "./state.js";
import { LocalWorkspaceService } from "./service.js";

type TaskTreeNode = TaskItemNode | EventItemNode | EmptyItemNode;

class DevAssistantTreeProvider implements vscode.TreeDataProvider<TaskTreeNode> {
  private readonly emitter = new vscode.EventEmitter<TaskTreeNode | undefined>();

  public readonly onDidChangeTreeData = this.emitter.event;

  public constructor(private readonly state: ExtensionStateStore) {}

  public refresh(): void {
    this.emitter.fire(undefined);
  }

  public getTreeItem(element: TaskTreeNode): vscode.TreeItem {
    return element.item;
  }

  public getChildren(element?: TaskTreeNode): vscode.ProviderResult<TaskTreeNode[]> {
    if (!element) {
      const snapshot = this.state.snapshot();

      if (snapshot.activeTasks.length === 0) {
        return [createEmptyNode("No active tasks", "Start a task from the command palette to see timeline events here.")];
      }

      return snapshot.activeTasks.map((task) => createTaskNode(task));
    }

    if (element.kind === "task") {
      if (element.task.events.length === 0) {
        return [createEmptyNode("No events yet", "The task timeline will populate as agents emit events.")];
      }

      return [...element.task.events]
        .slice(-12)
        .reverse()
        .map((event) => createEventNode(event));
    }

    return [];
  }
}

class DevAssistantExtension {
  private readonly state = new ExtensionStateStore();
  private readonly treeProvider = new DevAssistantTreeProvider(this.state);
  private readonly runningTasks = new Map<string, AbortController>();
  private readonly pendingDiffApprovals = new Map<string, ApprovalRequest>();

  private readonly service: LocalWorkspaceService;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspacePath: string
  ) {
    this.service = new LocalWorkspaceService(workspacePath);
    const history = this.service.listTaskHistory(20);
    this.state.hydrate(history.tasks);

    for (const task of history.tasks) {
      for (const event of history.eventsByTaskId[task.id] ?? []) {
        this.state.recordEvent(event);
      }
    }
  }

  public async activate(): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(
        "Dev Assistant is disabled until this workspace is trusted."
      );
    }

    this.context.subscriptions.push(
      vscode.window.registerTreeDataProvider("devAssistant.tasks", this.treeProvider),
      vscode.commands.registerCommand("devAssistant.startTask", () => this.startTask()),
      vscode.commands.registerCommand("devAssistant.reviewCurrentDiff", () => this.reviewCurrentDiff()),
      vscode.commands.registerCommand("devAssistant.generateTestsForCurrentFile", () => this.generateTestsForCurrentFile()),
      vscode.commands.registerCommand("devAssistant.explainTechnicalDebt", () => this.explainTechnicalDebt()),
      vscode.commands.registerCommand("devAssistant.showHistory", () => this.showHistory()),
      vscode.commands.registerCommand("devAssistant.cancelTask", (node?: unknown) =>
        this.cancelTask(asTaskNode(node)?.task.id)
      ),
      vscode.commands.registerCommand("devAssistant.openPendingDiff", (node?: unknown) =>
        this.openPendingDiff(asTaskNode(node)?.task.id)
      )
    );
  }

  private async startTask(): Promise<void> {
    if (!this.ensureTrusted() || this.runningTasks.size > 0) {
      if (this.runningTasks.size > 0) {
        void vscode.window.showInformationMessage(
          "Only one active assistant task is supported right now. Cancel or finish the current task first."
        );
      }
      return;
    }

    const prompt = await vscode.window.showInputBox({
      title: "Start Assistant Task",
      prompt: "Describe the task you want the assistant to handle.",
      ignoreFocusOut: true
    });

    if (!prompt || prompt.trim().length === 0) {
      return;
    }

    const abortController = new AbortController();
    let activeTaskId: string | null = null;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Dev Assistant task running",
        cancellable: true
      },
      async (progress, token) => {
        token.onCancellationRequested(() => abortController.abort());

        const result = await this.service.startTask({
          prompt,
          signal: abortController.signal,
          onEvent: async (event) => {
            activeTaskId = event.taskId;
            this.runningTasks.set(event.taskId, abortController);
            this.state.recordEvent(event);
            this.treeProvider.refresh();
            progress.report({
              message: describeEvent(event)
            });
          },
          requestApproval: (request) => this.requestApproval(request)
        });

        this.runningTasks.delete(result.task.id);
        this.pendingDiffApprovals.delete(result.task.id);
        this.state.upsertTask(result.task);
        this.treeProvider.refresh();

        const outcomeMessage =
          result.task.status === "completed"
            ? result.outputs["coordinator-report"]?.summary ?? "Task completed."
            : `Task ${result.task.status}.`;
        void vscode.window.showInformationMessage(outcomeMessage);
      }
    ).finally(() => {
      if (activeTaskId) {
        this.runningTasks.delete(activeTaskId);
        this.pendingDiffApprovals.delete(activeTaskId);
      }
      this.treeProvider.refresh();
    });
  }

  private async reviewCurrentDiff(): Promise<void> {
    if (!this.ensureTrusted()) {
      return;
    }

    const summary = await this.service.reviewCurrentDiff();
    const findings =
      summary.review.findings.length > 0
        ? summary.review.findings
            .map((finding) => `- [${finding.severity}] ${finding.message}${formatLocation(finding.filePath, finding.line)}`)
            .join("\n")
        : "- No findings.";

    await this.openMarkdownDocument(
      "review-summary",
      `# Diff Review\n\n${summary.review.summary}\n\n## Files\n\n${formatList(summary.diffFiles)}\n\n## Findings\n\n${findings}\n`
    );
  }

  private async generateTestsForCurrentFile(): Promise<void> {
    if (!this.ensureTrusted()) {
      return;
    }

    const filePath = this.requireActiveFilePath();
    if (!filePath) {
      return;
    }

    const summary = await this.service.generateTestsForFile(filePath);
    const recommendations =
      summary.output.recommendedTests.length > 0
        ? summary.output.recommendedTests
            .map(
              (test) =>
                `- \`${test.filePath}\`: **${escapeMarkdown(test.testName)}**\n  ${escapeMarkdown(test.rationale)}`
            )
            .join("\n")
        : "- No concrete test cases were suggested.";
    const gaps =
      summary.output.coverageGaps.length > 0
        ? summary.output.coverageGaps.map((gap) => `- ${escapeMarkdown(gap)}`).join("\n")
        : "- No obvious gaps called out.";

    await this.openMarkdownDocument(
      "test-recommendations",
      `# Test Recommendations\n\n${escapeMarkdown(summary.output.summary)}\n\n## File\n\n- \`${summary.filePath}\`\n\n## Coverage Gaps\n\n${gaps}\n\n## Recommended Tests\n\n${recommendations}\n`
    );
  }

  private async explainTechnicalDebt(): Promise<void> {
    if (!this.ensureTrusted()) {
      return;
    }

    const summary = await this.service.explainTechnicalDebt();
    const debtItems =
      summary.output.items.length > 0
        ? summary.output.items
            .map(
              (item) =>
                `- **${escapeMarkdown(item.title)}** (${item.priority})\n  Files: ${item.files.length > 0 ? item.files.map((file) => `\`${file}\``).join(", ") : "none"}\n  Why: ${escapeMarkdown(item.rationale)}\n  Fix: ${escapeMarkdown(item.recommendedFix)}`
            )
            .join("\n")
        : "- No debt items proposed.";
    const architecture =
      summary.architecture.recommendations.length > 0
        ? summary.architecture.recommendations
            .map(
              (item) =>
                `- [${item.severity}] ${item.area}: ${escapeMarkdown(item.message)}${item.filePath ? ` (\`${item.filePath}\`)` : ""}`
            )
            .join("\n")
        : "- No architecture-specific concerns.";

    await this.openMarkdownDocument(
      "technical-debt",
      `# Technical Debt\n\n${escapeMarkdown(summary.output.summary)}\n\n## Diff Files\n\n${formatList(summary.diffFiles)}\n\n## Reviewer Context\n\n${escapeMarkdown(summary.review.summary)}\n\n## Architecture Signals\n\n${architecture}\n\n## Debt Items\n\n${debtItems}\n`
    );
  }

  private async showHistory(): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      "devAssistant.history",
      "Dev Assistant History",
      vscode.ViewColumn.One,
      {
        enableScripts: false
      }
    );
    const history = this.service.listTaskHistory(25);

    panel.webview.html = renderHistoryHtml(history.tasks.map((task) => ({
      title: task.title,
      prompt: task.prompt,
      status: task.status,
      updatedAt: task.updatedAt,
      events: history.eventsByTaskId[task.id] ?? []
    })));
  }

  private async cancelTask(taskId?: string): Promise<void> {
    const [firstRunningTaskId] = this.runningTasks.keys();
    const resolvedTaskId = taskId ?? firstRunningTaskId;

    if (!resolvedTaskId) {
      void vscode.window.showInformationMessage("There is no active assistant task to cancel.");
      return;
    }

    const controller = this.runningTasks.get(resolvedTaskId);
    controller?.abort();
    void vscode.window.showInformationMessage("Cancellation requested. The task will stop at the next safe checkpoint.");
  }

  private async openPendingDiff(taskId?: string): Promise<void> {
    const [firstTaskId] = this.pendingDiffApprovals.keys();
    const resolvedTaskId = taskId ?? firstTaskId;

    if (!resolvedTaskId) {
      void vscode.window.showInformationMessage("No pending patch approval is waiting for review.");
      return;
    }

    const request = this.pendingDiffApprovals.get(resolvedTaskId);
    if (!request) {
      return;
    }

    await this.previewPatch(request);
  }

  private async requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    if (request.kind === "file-edit") {
      const taskId = this.findPendingTaskId(request);
      if (taskId) {
        this.pendingDiffApprovals.set(taskId, request);
      }

      await this.previewPatch(request);

      const choice = await vscode.window.showInformationMessage(
        request.reason,
        {
          modal: true,
          detail: request.summary ?? `Files: ${(request.files ?? []).join(", ")}`
        },
        "Apply edits",
        "Deny"
      );

      return {
        approved: choice === "Apply edits",
        approver: "vscode",
        rationale: choice === "Apply edits" ? "Approved in VS Code after diff preview." : "Denied in VS Code."
      };
    }

    const choice = await vscode.window.showWarningMessage(
      request.reason,
      request.command ? { modal: true, detail: `Command: ${request.command}` } : { modal: true },
      "Run command",
      "Deny"
    );

    return {
      approved: choice === "Run command",
      approver: "vscode",
      rationale: choice === "Run command" ? "Approved shell command in VS Code." : "Denied shell command in VS Code."
    };
  }

  private async previewPatch(request: ApprovalRequest): Promise<void> {
    const operation = request.operations?.find((entry) => entry.changeType !== "delete") ?? request.operations?.[0];
    const targetPath = operation?.path ?? request.files?.[0];

    if (!targetPath) {
      return;
    }

    const absolutePath = join(this.workspacePath, targetPath);
    const currentContent = operation?.changeType === "create"
      ? ""
      : safeReadFile(absolutePath);
    const proposedContent =
      operation?.changeType === "delete" ? "" : operation?.content ?? request.diff ?? currentContent;
    const language = extname(targetPath).replace(/^\./, "") || "plaintext";
    const left = await vscode.workspace.openTextDocument({
      content: currentContent,
      language
    });
    const right = await vscode.workspace.openTextDocument({
      content: proposedContent,
      language
    });

    await vscode.commands.executeCommand(
      "vscode.diff",
      left.uri,
      right.uri,
      `Proposed patch: ${targetPath}`
    );
  }

  private ensureTrusted(): boolean {
    if (vscode.workspace.isTrusted) {
      return true;
    }

    void vscode.window.showWarningMessage(
      "Trust this workspace before running Dev Assistant commands."
    );
    return false;
  }

  private requireActiveFilePath(): string | null {
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;

    if (!filePath) {
      void vscode.window.showInformationMessage("Open a file first.");
      return null;
    }

    return filePath;
  }

  private async openMarkdownDocument(name: string, content: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
      language: "markdown",
      content
    });
    await vscode.window.showTextDocument(document, {
      preview: false,
      viewColumn: vscode.ViewColumn.Beside
    });
  }

  private findPendingTaskId(request: ApprovalRequest): string | null {
    const active = this.state.snapshot().activeTasks.find((task) => task.pendingApproval === request);
    return active?.id ?? [...this.runningTasks.keys()][0] ?? null;
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    return;
  }

  const extension = new DevAssistantExtension(context, workspaceFolder.uri.fsPath);
  await extension.activate();
}

export function deactivate(): void {}

function createTaskNode(task: ExtensionTaskSummary): TaskItemNode {
  const item = new vscode.TreeItem(task.title, vscode.TreeItemCollapsibleState.Expanded);
  item.description = task.status;
  item.tooltip = `${task.prompt}\n\n${task.lastMessage ?? ""}`.trim();
  item.iconPath = new vscode.ThemeIcon(iconForStatus(task.status));
  item.contextValue = "devAssistant.task";
  item.command = {
    command: "devAssistant.openPendingDiff",
    title: "Open Pending Diff",
    arguments: [{ kind: "task", task, item }]
  };

  return {
    kind: "task",
    task,
    item
  };
}

function createEventNode(event: TaskEvent): EventItemNode {
  const item = new vscode.TreeItem(describeEvent(event), vscode.TreeItemCollapsibleState.None);
  item.description = new Date(event.timestamp).toLocaleTimeString();
  item.iconPath = new vscode.ThemeIcon(iconForEvent(event.type));

  return {
    kind: "event",
    event,
    item
  };
}

function createEmptyNode(label: string, tooltip: string): EmptyItemNode {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.tooltip = tooltip;
  item.iconPath = new vscode.ThemeIcon("info");
  return {
    kind: "empty",
    item
  };
}

function iconForStatus(status: ExtensionTaskSummary["status"]): string {
  switch (status) {
    case "completed":
      return "check";
    case "blocked":
      return "error";
    case "cancelled":
      return "circle-slash";
    default:
      return "sync";
  }
}

function iconForEvent(eventType: TaskEvent["type"]): string {
  switch (eventType) {
    case "approval.requested":
      return "question";
    case "approval.resolved":
      return "pass";
    case "task.blocked":
      return "error";
    case "task.completed":
      return "check";
    case "task.cancelled":
      return "circle-slash";
    default:
      return "history";
  }
}

function renderHistoryHtml(
  tasks: ReadonlyArray<{
    readonly title: string;
    readonly prompt: string;
    readonly status: string;
    readonly updatedAt: string;
    readonly events: readonly TaskEvent[];
  }>
): string {
  const rows = tasks
    .map((task) => {
      const events = [...task.events]
        .slice(-8)
        .reverse()
        .map((event) => `<li>${escapeHtml(describeEvent(event))} <span>${escapeHtml(new Date(event.timestamp).toLocaleString())}</span></li>`)
        .join("");

      return `<section>
  <h2>${escapeHtml(task.title)} <small>${escapeHtml(task.status)}</small></h2>
  <p>${escapeHtml(task.prompt)}</p>
  <p><strong>Updated:</strong> ${escapeHtml(new Date(task.updatedAt).toLocaleString())}</p>
  <ul>${events}</ul>
</section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); }
    section { border-bottom: 1px solid var(--vscode-panel-border); padding: 12px 0; }
    h2 { margin: 0 0 8px; }
    small { opacity: 0.7; }
    ul { padding-left: 18px; }
    li { margin-bottom: 6px; }
    span { opacity: 0.7; margin-left: 8px; }
  </style>
</head>
<body>
  <h1>Dev Assistant History</h1>
  ${rows || "<p>No tasks recorded yet.</p>"}
</body>
</html>`;
}

function safeReadFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.map((value) => `- \`${value}\``).join("\n") : "- None";
}

function formatLocation(filePath?: string, line?: number): string {
  if (!filePath) {
    return "";
  }

  return line ? ` (\`${filePath}:${line}\`)` : ` (\`${filePath}\`)`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\*_`[\]]/g, "\\$&");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface TaskItemNode {
  readonly kind: "task";
  readonly task: ExtensionTaskSummary;
  readonly item: vscode.TreeItem;
}

interface EventItemNode {
  readonly kind: "event";
  readonly event: TaskEvent;
  readonly item: vscode.TreeItem;
}

interface EmptyItemNode {
  readonly kind: "empty";
  readonly item: vscode.TreeItem;
}

function asTaskNode(value: unknown): TaskItemNode | undefined {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return undefined;
  }

  return (value as { kind?: string }).kind === "task" ? (value as TaskItemNode) : undefined;
}
