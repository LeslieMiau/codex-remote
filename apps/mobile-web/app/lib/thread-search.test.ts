import { describe, expect, it } from "vitest";

import type { CodexThread } from "@codex-remote/protocol";

import { filterThreadsForQuery } from "./thread-search";

function createThread(overrides: Partial<CodexThread>): CodexThread {
  return {
    thread_id: "thread_1",
    project_id: "project_1",
    project_label: "Mobile",
    repo_root: "/Users/miau/Documents/codex-remote",
    title: "Review the mobile diagnostics surface",
    state: "ready",
    archived: false,
    has_active_run: false,
    active_turn_id: null,
    last_stream_seq: 0,
    sync_state: "native_confirmed",
    pending_approvals: 0,
    pending_patches: 0,
    pending_native_requests: 0,
    updated_at: "2026-03-21T14:00:00.000Z",
    ...overrides
  };
}

describe("filterThreadsForQuery", () => {
  it("returns all threads for an empty query", () => {
    const threads = [createThread({ thread_id: "thread_a" })];

    expect(filterThreadsForQuery(threads, "   ")).toBe(threads);
  });

  it("matches by title, workspace label, and repo root", () => {
    const matching = createThread({
      thread_id: "thread_match",
      project_label: "Payments",
      repo_root: "/work/apps/payments",
      title: "Investigate retry policy"
    });
    const other = createThread({
      thread_id: "thread_other",
      project_label: "Docs",
      repo_root: "/work/apps/docs",
      title: "Write onboarding copy"
    });

    expect(filterThreadsForQuery([matching, other], "retry")).toEqual([matching]);
    expect(filterThreadsForQuery([matching, other], "payments")).toEqual([matching]);
    expect(filterThreadsForQuery([matching, other], "/work/apps/pay")).toEqual([
      matching
    ]);
  });

  it("normalizes case and trims whitespace", () => {
    const thread = createThread({
      title: "Fix Android Sync Banner"
    });

    expect(filterThreadsForQuery([thread], "  android sync  ")).toEqual([thread]);
  });
});
