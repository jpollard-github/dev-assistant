import type { CoderOutput, FileChange, FileOperation, ReviewerOutput, TestWriterOutput } from "./index.js";

export function isLikelyTestFilePath(path: string): boolean {
  return /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/i.test(path);
}

export function isAssistantControlPath(path: string): boolean {
  const normalized = normalizePath(path).replace(/\/+$/, "");
  return (
    normalized === ".dev-assistant" ||
    normalized.startsWith(".dev-assistant/") ||
    normalized === "dev-assistant.config.json" ||
    normalized === ".git" ||
    normalized.startsWith(".git/")
  );
}

export function sanitizeCoderProposal(proposal: CoderOutput, prompt: string): CoderOutput {
  if (promptExplicitlyTargetsAssistantControlPath(prompt)) {
    return reconcileCoderProposal(proposal);
  }

  const filteredOperations = proposal.operations.filter((operation) => !isAssistantControlPath(operation.path));
  const allowedPaths = new Set(filteredOperations.map((operation) => normalizePath(operation.path)));
  const filteredFiles = proposal.files.filter(
    (file) =>
      !isAssistantControlPath(file.path) &&
      (allowedPaths.size === 0 || allowedPaths.has(normalizePath(file.path)))
  );

  const removedPaths = [
    ...proposal.operations
      .map((operation) => operation.path)
      .filter((path) => !allowedPaths.has(normalizePath(path))),
    ...proposal.files
      .map((file) => file.path)
      .filter((path) => isAssistantControlPath(path))
  ];

  if (removedPaths.length === 0) {
    return reconcileCoderProposal(proposal);
  }

  return reconcileCoderProposal({
    ...proposal,
    rationale: `${proposal.rationale}\n\nSanitized proposal: removed assistant-control paths that were not requested by the user.`,
    files: filteredFiles,
    operations: filteredOperations
  });
}

export function mergeTestWriterIntoCoderProposal(
  proposal: CoderOutput,
  testWriter: TestWriterOutput
): CoderOutput {
  const testOperations = testWriter.operations.filter((operation) => isLikelyTestFilePath(operation.path));
  const testFiles =
    testWriter.files.length > 0
      ? testWriter.files.filter((file) => isLikelyTestFilePath(file.path))
      : deriveFilesFromOperations(testOperations);

  if (testOperations.length === 0 && testFiles.length === 0) {
    return reconcileCoderProposal(proposal);
  }

  const existingPaths = new Set(proposal.operations.map((operation) => operation.path));
  const mergedOperations = [
    ...proposal.operations,
    ...testOperations.filter((operation) => !existingPaths.has(operation.path))
  ];

  const existingFilePaths = new Set(proposal.files.map((file) => file.path));
  const mergedFiles = [
    ...proposal.files,
    ...testFiles.filter((file) => !existingFilePaths.has(file.path))
  ];

  const mergedCommands = Array.from(new Set([...proposal.commands, ...testWriter.commands]));

  return reconcileCoderProposal({
    ...proposal,
    summary: `${proposal.summary} Added ${testOperations.length} test file operation(s) from the test-writer.`,
    rationale: `${proposal.rationale}\n\nTest-writer augmentation: ${testWriter.summary}`,
    files: mergedFiles,
    operations: mergedOperations,
    commands: mergedCommands
  });
}

export function reconcileCoderProposal(proposal: CoderOutput): CoderOutput {
  const normalizedOperations = dedupeOperations(proposal.operations);
  const operationPaths = new Set(normalizedOperations.map((operation) => normalizePath(operation.path)));
  const normalizedFiles = dedupeFiles(
    proposal.files.filter((file) => operationPaths.has(normalizePath(file.path)))
  );

  if (
    normalizedOperations.length === proposal.operations.length &&
    normalizedFiles.length === proposal.files.length
  ) {
    return proposal;
  }

  return {
    ...proposal,
    rationale: `${proposal.rationale}\n\nNormalized proposal: removed declared files without matching operations and deduplicated operation paths.`,
    files: normalizedFiles,
    operations: normalizedOperations
  };
}

export function enrichReviewerOutput(
  review: ReviewerOutput,
  diffText: string,
  changedPaths: readonly string[]
): ReviewerOutput {
  if (review.findings.length === 0) {
    return review;
  }

  const fallbackPath = changedPaths.length === 1 ? changedPaths[0] : undefined;
  const changedLinesByPath = collectChangedLinesByPath(diffText);

  return {
    ...review,
    findings: review.findings.map((finding) => {
      const filePath = finding.filePath ?? fallbackPath;
      const changedLines = filePath
        ? (changedLinesByPath.get(normalizePath(filePath)) ?? changedLinesByPath.get(filePath))
        : undefined;
      const line =
        finding.line && changedLines && changedLines.length > 0
          ? snapToNearestChangedLine(finding.line, changedLines)
          : finding.line ?? changedLines?.[0];

      return {
        ...finding,
        ...(filePath ? { filePath } : {}),
        ...(line ? { line } : {})
      };
    })
  };
}

function deriveFilesFromOperations(operations: readonly FileOperation[]): FileChange[] {
  return operations.map((operation) => ({
    path: operation.path,
    changeType: operation.changeType
  }));
}

function dedupeOperations(operations: readonly FileOperation[]): FileOperation[] {
  const seen = new Set<string>();
  const result: FileOperation[] = [];

  for (const operation of operations) {
    const normalized = normalizePath(operation.path);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(operation);
  }

  return result;
}

function dedupeFiles(files: readonly FileChange[]): FileChange[] {
  const seen = new Set<string>();
  const result: FileChange[] = [];

  for (const file of files) {
    const normalized = normalizePath(file.path);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(file);
  }

  return result;
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "");
}

function promptExplicitlyTargetsAssistantControlPath(prompt: string): boolean {
  const normalizedPrompt = prompt.toLowerCase();
  return [".dev-assistant", "dev-assistant.config.json", ".git"].some((path) =>
    normalizedPrompt.includes(path.toLowerCase())
  );
}

function collectChangedLinesByPath(diffText: string): Map<string, number[]> {
  const lines = diffText.split("\n");
  const changed = new Map<string, number[]>();
  let currentPath: string | null = null;
  let nextLine = 0;

  for (const line of lines) {
    if (line.startsWith("+++ b/")) {
      currentPath = line.slice("+++ b/".length).trim();
      if (!changed.has(currentPath)) {
        changed.set(currentPath, []);
      }
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      nextLine = Number.parseInt(hunkMatch[1] ?? "0", 10);
      continue;
    }

    if (!currentPath || nextLine <= 0) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      changed.get(currentPath)?.push(nextLine);
      nextLine += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      nextLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      continue;
    }
  }

  return changed;
}

function snapToNearestChangedLine(line: number, changedLines: readonly number[]): number {
  let nearest = changedLines[0] ?? line;
  let nearestDistance = Math.abs(nearest - line);

  for (const candidate of changedLines) {
    const distance = Math.abs(candidate - line);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return nearest;
}
