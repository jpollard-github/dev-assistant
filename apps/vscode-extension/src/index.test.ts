import { describe, expect, it } from "vitest";

import { describeEvent, ExtensionStateStore, isActiveTask } from "./state.js";

describe("ExtensionStateStore", () => {
  it("tracks active tasks and clears pending approvals when approvals resolve", () => {
    const state = new ExtensionStateStore();

    state.recordEvent({
      id: "1",
      taskId: "task-1",
      type: "task.created",
      timestamp: "2026-06-24T12:00:00.000Z",
      payload: {
        title: "Ship sidebar",
        prompt: "Implement phase 7",
        budget: {
          maxModelCalls: 8,
          maxShellCommands: 4,
          maxChangedFiles: 6,
          maxRuntimeMs: 60000
        }
      }
    });
    state.recordEvent({
      id: "2",
      taskId: "task-1",
      type: "approval.requested",
      timestamp: "2026-06-24T12:01:00.000Z",
      payload: {
        request: {
          kind: "file-edit",
          reason: "Apply proposed patch",
          files: ["apps/vscode-extension/src/index.ts"]
        }
      }
    });

    expect(state.snapshot().activeTasks).toHaveLength(1);
    expect(state.getTask("task-1")?.pendingApproval?.kind).toBe("file-edit");

    state.recordEvent({
      id: "3",
      taskId: "task-1",
      type: "approval.resolved",
      timestamp: "2026-06-24T12:02:00.000Z",
      payload: {
        request: {
          kind: "file-edit",
          reason: "Apply proposed patch"
        },
        decision: {
          approved: true,
          approver: "vscode",
          rationale: "Approved"
        }
      }
    });
    state.recordEvent({
      id: "4",
      taskId: "task-1",
      type: "task.status-changed",
      timestamp: "2026-06-24T12:03:00.000Z",
      payload: {
        from: "created",
        to: "completed",
        reason: "Task finished"
      }
    });

    expect(state.getTask("task-1")?.pendingApproval).toBeNull();
    expect(state.snapshot().activeTasks).toHaveLength(0);
  });
});

describe("state helpers", () => {
  it("marks completed, blocked, and cancelled tasks as inactive", () => {
    expect(isActiveTask("completed")).toBe(false);
    expect(isActiveTask("blocked")).toBe(false);
    expect(isActiveTask("cancelled")).toBe(false);
    expect(isActiveTask("reviewed")).toBe(true);
  });

  it("describes task cancellation events", () => {
    expect(
      describeEvent({
        id: "evt",
        taskId: "task",
        type: "task.cancelled",
        timestamp: "2026-06-24T12:00:00.000Z",
        payload: {
          reason: "Task cancelled by the user."
        }
      })
    ).toContain("Cancelled");
  });
});
