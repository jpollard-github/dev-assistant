import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SqliteTaskEventStore } from "./event-store.js";
import { TaskCoordinator, createDemoAgentHandlers } from "./coordinator.js";

describe("TaskCoordinator", () => {
  it("runs a deterministic task to completion and persists events", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "dev-assistant-core-")), "tasks.sqlite");
    const store = new SqliteTaskEventStore(dbPath);
    const coordinator = new TaskCoordinator({
      store,
      agents: createDemoAgentHandlers()
    });

    const result = await coordinator.runTask({
      prompt: "Implement a deterministic phase 1 flow",
      config: {
        approvalPolicy: "on-risky-action",
        allowedShellCommands: ["pnpm test"],
        testCommands: ["pnpm test"]
      }
    });

    expect(result.task.status).toBe("completed");
    expect(result.usage.modelCalls).toBe(4);
    expect(result.usage.shellCommands).toBe(1);
    expect(store.listEvents(result.task.id).length).toBeGreaterThan(0);

    store.close();
  });

  it("blocks the task when an agent keeps returning invalid output", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "dev-assistant-core-")), "tasks.sqlite");
    const store = new SqliteTaskEventStore(dbPath);
    const coordinator = new TaskCoordinator({
      store,
      agents: {
        ...createDemoAgentHandlers(),
        reviewer() {
          return { bad: true };
        }
      }
    });

    const result = await coordinator.runTask({
      prompt: "Trigger invalid reviewer output",
      config: {
        approvalPolicy: "never",
        allowedShellCommands: [],
        testCommands: []
      }
    });

    expect(result.task.status).toBe("blocked");
    const invalidEvents = store
      .listEvents(result.task.id)
      .filter((event) => event.type === "agent.output-invalid");
    expect(invalidEvents.length).toBeGreaterThan(0);

    store.close();
  });

  it("blocks the task when approval is denied for file edits", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "dev-assistant-core-")), "tasks.sqlite");
    const store = new SqliteTaskEventStore(dbPath);
    const coordinator = new TaskCoordinator({
      store,
      agents: {
        ...createDemoAgentHandlers(),
        coder() {
          return {
            summary: "Modify one file",
            rationale: "Need to edit a file",
            diff: "--- a/file.ts\n+++ b/file.ts\n",
            files: [{ path: "file.ts", changeType: "update" }],
            commands: []
          };
        }
      },
      approvalDecider: {
        decide() {
          return {
            approved: false,
            approver: "test",
            rationale: "Manual review required"
          };
        }
      }
    });

    const result = await coordinator.runTask({
      prompt: "Require file edit approval",
      config: {
        approvalPolicy: "on-risky-action",
        allowedShellCommands: [],
        testCommands: []
      }
    });

    expect(result.task.status).toBe("blocked");
    expect(result.approvals[0]?.approved).toBe(false);

    store.close();
  });

  it("records prompt snapshots and llm metadata for wrapped agent outputs", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "dev-assistant-core-")), "tasks.sqlite");
    const store = new SqliteTaskEventStore(dbPath);
    const coordinator = new TaskCoordinator({
      store,
      agents: {
        ...createDemoAgentHandlers(),
        coordinator() {
          return {
            output: {
              summary: "Plan task",
              steps: [{ id: "plan", description: "Plan it", kind: "analysis" }],
              requiresTests: true
            },
            metadata: {
              promptSnapshot: "SYSTEM:\nCoordinator prompt",
              provider: "ollama",
              model: "qwen2.5-coder:7b",
              durationMs: 42,
              tokenUsage: {
                inputTokens: 12,
                outputTokens: 18,
                totalTokens: 30
              }
            }
          };
        }
      }
    });

    const result = await coordinator.runTask({
      prompt: "Record prompt snapshots",
      config: {
        approvalPolicy: "never",
        allowedShellCommands: [],
        testCommands: []
      }
    });

    expect(result.task.status).toBe("completed");
    const events = store.listEvents(result.task.id);
    expect(events.some((event) => event.type === "agent.prompt-snapshot")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "tool.result" &&
          event.payload.tool === "llm-provider" &&
          "provider" in event.payload.result &&
          event.payload.result.provider === "ollama"
      )
    ).toBe(true);

    store.close();
  });
});
