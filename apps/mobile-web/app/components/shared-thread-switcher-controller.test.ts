import { describe, expect, it } from "vitest";

import type { CodexThread } from "@codex-remote/protocol";

import { getCodexOverview } from "../lib/gateway-client";
import {
  beginThreadSwitcherLoadState,
  completeThreadSwitcherLoadState,
  failThreadSwitcherLoadState,
  loadThreadSwitcherResult,
  resetThreadSwitcherControllerState
} from "./shared-thread-switcher-controller";

function buildThread(
  input: Partial<CodexThread> & Pick<CodexThread, "thread_id" | "updated_at">
): CodexThread {
  const { thread_id, updated_at, ...overrides } = input;
  return {
    adapter_thread_ref: "adapter-demo",
    archived: false,
    degraded: false,
    active_turn_id: null,
    has_active_run: false,
    last_stream_seq: 0,
    pending_approvals: 0,
    pending_native_requests: 0,
    pending_patches: 0,
    project_id: "project_demo",
    project_label: "codex-remote",
    repo_root: "/Users/miau/Documents/codex-remote",
    source: "native",
    state: "completed",
    sync_state: "native_confirmed",
    ...overrides,
    thread_id,
    title: overrides.title ?? thread_id,
    updated_at
  };
}

describe("thread switcher controller", () => {
  it("marks the switcher as loading and clears stale errors", () => {
    const loading = beginThreadSwitcherLoadState({
      ...resetThreadSwitcherControllerState(),
      threadSwitcherError: "stale"
    });

    expect(loading.isLoadingThreads).toBe(true);
    expect(loading.threadSwitcherError).toBe(null);
  });

  it("filters hidden threads and sorts visible chats by recency", () => {
    const completed = completeThreadSwitcherLoadState(
      beginThreadSwitcherLoadState(resetThreadSwitcherControllerState()),
      [
        buildThread({
          thread_id: "thread-hidden",
          archived: true,
          updated_at: "2026-03-28T11:00:00.000Z"
        }),
        buildThread({
          thread_id: "thread-new",
          pending_approvals: 1,
          updated_at: "2026-03-28T12:00:00.000Z"
        }),
        buildThread({
          thread_id: "thread-old",
          updated_at: "2026-03-28T09:00:00.000Z"
        })
      ]
    );

    expect(completed.isLoadingThreads).toBe(false);
    expect(completed.threadSwitcherError).toBe(null);
    expect(completed.switcherThreads.map((thread) => thread.thread_id)).toEqual([
      "thread-new",
      "thread-old"
    ]);
  });

  it("keeps an empty switcher result stable", async () => {
    const result = await loadThreadSwitcherResult({
      describeError: (error) => String(error),
      loadOverview: async () =>
        ({
        projects: [],
        queue: [],
        threads: [],
        capabilities: {
          adapter_kind: "codex-app-server",
          approvals: false,
          collaboration_mode: "default",
          degraded: true,
          diagnostics_read: false,
          image_inputs: false,
          interrupt: false,
          live_follow_up: false,
          patch_decisions: false,
          reason: "offline",
          review_start: false,
          run_start: false,
          settings_read: true,
          settings_write: false,
          shared_history: false,
          shared_model_config: true,
          shared_state_available: false,
          shared_thread_create: false,
          shared_threads: false,
          skills_input: false,
          supports_images: false,
          thread_archive: false,
          thread_compact: false,
          thread_fork: false,
          thread_rename: false,
          thread_rollback: false
        }
      }) as Awaited<ReturnType<typeof getCodexOverview>>
    });

    expect(result).toEqual({
      switcherThreads: [],
      threadSwitcherError: null
    });
  });

  it("surfaces loading failures as controller errors", async () => {
    const result = await loadThreadSwitcherResult({
      describeError: () => "load failed",
      loadOverview: async () => {
        throw new Error("boom");
      }
    });
    const failed = failThreadSwitcherLoadState(
      beginThreadSwitcherLoadState(resetThreadSwitcherControllerState()),
      result.threadSwitcherError ?? "unexpected"
    );

    expect(failed.isLoadingThreads).toBe(false);
    expect(failed.switcherThreads).toEqual([]);
    expect(failed.threadSwitcherError).toBe("load failed");
  });
});
