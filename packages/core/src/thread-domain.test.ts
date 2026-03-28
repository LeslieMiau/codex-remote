import { describe, expect, it } from "vitest";

import {
  buildMirroredCodexThread,
  deriveMirroredCodexThreadState,
  deriveMirroredSyncState,
  deriveThreadSnapshotState,
  isLiveStateAwaitingNativeCommit,
  isTerminalTurnState,
  progressToTurnState,
  requiresMaterializedThreadControl,
  type PendingThreadCounts
} from "./thread-domain";

const emptyPending: PendingThreadCounts = {
  approvals: 0,
  native_requests: 0,
  patches: 0
};

describe("thread-domain", () => {
  it("derives mirrored codex thread states from pending work and terminal statuses", () => {
    expect(
      deriveMirroredCodexThreadState({
        threadState: "ready",
        pending: {
          ...emptyPending,
          native_requests: 1
        }
      })
    ).toBe("waiting_input");

    expect(
      deriveMirroredCodexThreadState({
        threadState: "failed",
        pending: {
          ...emptyPending,
          approvals: 1
        }
      })
    ).toBe("failed");

    expect(
      deriveMirroredCodexThreadState({
        threadState: "ready",
        pending: {
          ...emptyPending,
          patches: 1
        }
      })
    ).toBe("needs_review");

    expect(
      deriveMirroredCodexThreadState({
        threadState: "completed",
        pending: emptyPending
      })
    ).toBe("completed");
  });

  it("derives thread snapshot states for runtime refreshes", () => {
    expect(
      deriveThreadSnapshotState({
        threadState: "ready",
        pending: {
          ...emptyPending,
          approvals: 1
        },
        activeTurnId: "turn_1",
        hasActiveExecution: true
      })
    ).toBe("waiting_approval");

    expect(
      deriveThreadSnapshotState({
        threadState: "ready",
        pending: emptyPending,
        activeTurnId: "turn_1",
        activeTurnState: "completed",
        hasActiveExecution: false
      })
    ).toBe("completed");

    expect(
      deriveThreadSnapshotState({
        threadState: "ready",
        pending: emptyPending,
        latestTurnState: "failed"
      })
    ).toBe("failed");
  });

  it("builds mirrored codex threads with shared mapping rules", () => {
    const thread = buildMirroredCodexThread({
      thread: {
        project_id: "project_demo",
        thread_id: "thread_demo",
        state: "waiting_approval",
        active_turn_id: "turn_demo",
        pending_turn_ids: [],
        pending_approval_ids: ["approval_demo"],
        adapter_kind: "codex-app-server",
        adapter_thread_ref: "native_demo",
        native_active_flags: [],
        last_stream_seq: 4,
        updated_at: "2026-03-28T00:00:00.000Z"
      },
      projectLabel: "codex-remote",
      repoRoot: "/repo",
      source: "gateway_fallback",
      syncState: "sync_pending",
      title: "Need approval",
      pending: {
        approvals: 1,
        native_requests: 0,
        patches: 0
      }
    });

    expect(thread.state).toBe("waiting_approval");
    expect(thread.has_active_run).toBe(true);
    expect(thread.pending_approvals).toBe(1);
    expect(thread.sync_state).toBe("sync_pending");
  });

  it("exposes transport and live-state helpers", () => {
    expect(
      deriveMirroredSyncState({
        adapterThreadRef: undefined,
        state: "ready"
      })
    ).toBe("sync_pending");
    expect(
      deriveMirroredSyncState({
        adapterThreadRef: "native_demo",
        state: "completed"
      })
    ).toBe("sync_failed");
    expect(
      requiresMaterializedThreadControl({
        adapter_thread_ref: "native_demo",
        sync_state: "sync_pending"
      })
    ).toBe(true);
    expect(isLiveStateAwaitingNativeCommit({
      awaiting_native_commit: true
    })).toBe(true);
  });

  it("keeps turn-state helpers pure and explicit", () => {
    expect(isTerminalTurnState("completed")).toBe(true);
    expect(isTerminalTurnState("streaming")).toBe(false);
    expect(progressToTurnState("queued", {})).toBe("started");
    expect(progressToTurnState("waiting_input", {})).toBe("streaming");
    expect(progressToTurnState("streaming", {
      resumed: true
    })).toBe("resumed");
  });
});
