import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Adapter } from "../adapters/types";
import { GatewayStore } from "../lib/store";
import { nowIso } from "../lib/time";
import { SessionHub } from "./session-hub";
import { ThreadRuntimeManager } from "./thread-runtime-manager";

async function waitFor<T>(
  producer: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  timeoutMs = 4_000
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await producer();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out waiting for condition");
}

const cleanupRoots = new Set<string>();

afterEach(async () => {
  for (const root of cleanupRoots) {
    await fs.rm(root, { recursive: true, force: true });
  }
  cleanupRoots.clear();
});

async function createThreadHarness(adapter: Adapter) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "thread-runtime-manager-"));
  cleanupRoots.add(root);

  const repoRoot = path.join(root, "repo");
  await fs.mkdir(repoRoot, { recursive: true });

  const store = await GatewayStore.open(":memory:");
  const timestamp = nowIso();
  store.saveProject({
    project_id: "project_demo",
    repo_root: repoRoot,
    created_at: timestamp,
    updated_at: timestamp
  });
  store.saveThread({
    project_id: "project_demo",
    thread_id: "thread_demo",
    state: "ready",
    active_turn_id: null,
    pending_turn_ids: [],
    pending_approval_ids: [],
    adapter_kind: "codex-app-server",
    last_stream_seq: 0,
    created_at: timestamp,
    updated_at: timestamp
  });

  const manager = new ThreadRuntimeManager({
    store,
    sessionHub: new SessionHub(),
    adapter
  });

  return {
    manager,
    repoRoot,
    root,
    store
  };
}

describe("ThreadRuntimeManager", () => {
  it("restores the approval -> patch -> complete execution loop", async () => {
    const adapter: Adapter = {
      kind: "mock",
      async runTurn(context, callbacks) {
        expect(context.turnInput?.prompt).toBe("generate a reviewed patch");
        expect(context.worktreePath).toContain(".codex-remote/worktrees");

        await callbacks.onProgress({
          channel: "thinking",
          message: "Preparing a patch for review.",
          step: "analysis"
        });

        const approval = await callbacks.onApprovalRequest({
          kind: "network",
          reason: "Need outbound access before continuing."
        });
        expect(approval.status).toBe("approved");

        const patchDecision = await callbacks.onPatchReady({
          summary: "Add a generated note",
          files: [
            {
              path: "notes/generated.txt",
              added_lines: 1,
              removed_lines: 0
            }
          ],
          changes: [
            {
              path: "notes/generated.txt",
              before_content: null,
              after_content: "Generated: recovery loop\n"
            }
          ],
          test_summary: "Tests skipped during recovery"
        });
        expect(patchDecision.action).toBe("apply");

        await callbacks.onCompleted("Generated patch was applied.");

        return {
          async interrupt() {}
        };
      }
    };

    const { manager, store } = await createThreadHarness(adapter);
    const started = await manager.startTurn({
      actor_id: "phone",
      request_id: "req-start-turn",
      thread_id: "thread_demo",
      prompt: "generate a reviewed patch",
      command_type: "turns.start"
    });

    const approval = await waitFor(
      () => store.listApprovals("thread_demo"),
      (value) => value.length === 1
    );
    expect(store.getThread("thread_demo")?.state).toBe("waiting_approval");

    await manager.resolveApproval({
      actor_id: "phone",
      request_id: "req-approve",
      approval_id: approval[0].approval_id,
      command_type: "approvals.approve",
      confirmed: true
    });

    const patches = await waitFor(
      () => store.listPatches("thread_demo"),
      (value) => value.length === 1
    );
    expect(store.getThread("thread_demo")?.state).toBe("needs_review");

    await manager.resolvePatch({
      actor_id: "phone",
      request_id: "req-apply-patch",
      patch_id: patches[0].patch_id,
      command_type: "patches.apply"
    });

    const completedTurn = await waitFor(
      () => store.getTurn(started.turn.turn_id),
      (turn) => turn?.state === "completed"
    );

    expect(completedTurn?.summary).toBe("Generated patch was applied.");

    const detail = store.getThreadDetail("thread_demo");
    expect(detail?.thread.state).toBe("completed");
    expect(detail?.thread.worktree_path).toBeTruthy();
    expect(detail?.patches[0]?.status).toBe("applied");

    const patchPath = path.join(
      detail!.thread.worktree_path!,
      detail!.patches[0].changes[0].path
    );
    await expect(fs.readFile(patchPath, "utf8")).resolves.toContain(
      "Generated: recovery loop"
    );

    const eventTypes = store.listEvents("thread_demo", 0).map((event) => event.event_type);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "turn.queued",
        "turn.started",
        "approval.required",
        "patch.ready",
        "turn.completed"
      ])
    );
    expect(store.getLiveState("thread_demo")?.status).toBe("completed");
  });

  it("records adapter failures with terminal turn state and events", async () => {
    const adapter: Adapter = {
      kind: "mock",
      async runTurn(_context, callbacks) {
        await callbacks.onDiagnostic({
          message: "adapter_boot"
        });
        await callbacks.onFailed({
          code: "adapter_crash",
          message: "The adapter crashed during recovery.",
          retryable: true
        });

        return {
          async interrupt() {}
        };
      }
    };

    const { manager, store } = await createThreadHarness(adapter);
    const started = await manager.startTurn({
      actor_id: "phone",
      request_id: "req-failure-turn",
      thread_id: "thread_demo",
      prompt: "trigger adapter crash",
      command_type: "turns.start"
    });

    const failedTurn = await waitFor(
      () => store.getTurn(started.turn.turn_id),
      (turn) => turn?.state === "failed"
    );

    expect(failedTurn?.state).toBe("failed");
    expect(store.getThread("thread_demo")?.state).toBe("failed");
    expect(store.getLiveState("thread_demo")?.status).toBe("failed");

    const failureEvent = store
      .listEvents("thread_demo", 0)
      .find((event) => event.event_type === "turn.failed");
    expect(failureEvent?.payload).toMatchObject({
      error_code: "adapter_crash",
      retryable: true
    });

    expect(
      store
        .listAuditLogs("thread_demo")
        .some((entry) => entry.category === "adapter_lifecycle" && entry.message === "turn_failed")
    ).toBe(true);
  });
});
