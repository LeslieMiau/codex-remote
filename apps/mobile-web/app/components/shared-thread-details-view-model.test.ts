import { describe, expect, it } from "vitest";
import type {
  CodexCapabilitiesResponse,
  CodexTranscriptPageResponse
} from "@codex-remote/protocol";

import { buildSharedThreadDetailsViewModel } from "./shared-thread-details-view-model";

function buildCapabilities(
  overrides: Partial<CodexCapabilitiesResponse> = {}
): CodexCapabilitiesResponse {
  return {
    collaboration_mode: "default",
    shared_state_available: true,
    shared_thread_create: true,
    supports_images: true,
    run_start: true,
    live_follow_up: true,
    image_inputs: true,
    interrupt: true,
    approvals: true,
    patch_decisions: true,
    thread_rename: true,
    thread_archive: true,
    thread_compact: true,
    thread_fork: true,
    thread_rollback: true,
    review_start: true,
    skills_input: true,
    diagnostics_read: true,
    settings_read: true,
    settings_write: true,
    shared_model_config: true,
    shared_history: true,
    shared_threads: true,
    ...overrides
  };
}

function buildTranscript(
  archived = false
): CodexTranscriptPageResponse {
  return {
    thread: {
      thread_id: "thread_demo",
      project_id: "project_demo",
      title: "Demo thread",
      project_label: "codex-remote",
      repo_root: "/repo/codex-remote",
      state: "ready",
      archived,
      has_active_run: false,
      pending_approvals: 0,
      pending_patches: 0,
      pending_native_requests: 0,
      active_turn_id: null,
      last_stream_seq: 0,
      sync_state: "native_confirmed",
      updated_at: "2026-03-28T10:00:00.000Z"
    },
    items: [],
    approvals: [],
    patches: [],
    native_requests: [],
    has_more: false
  };
}

describe("shared thread details view model", () => {
  it("disables thread actions while native sync is pending", () => {
    const model = buildSharedThreadDetailsViewModel({
      capabilities: buildCapabilities(),
      hasSkillCapability: true,
      isLoading: false,
      isMutating: false,
      locale: "en",
      remoteThreadActionsBlocked: true,
      selectedModelLabel: "GPT-5.4",
      transcript: buildTranscript()
    });

    expect(model.archiveDisabled).toBe(true);
    expect(model.reviewDisabled).toBe(true);
    expect(model.rollbackDisabled).toBe(true);
    expect(model.syncBlockedNote).toContain("sync finishes");
  });

  it("switches archive label when the thread is already archived", () => {
    const model = buildSharedThreadDetailsViewModel({
      capabilities: buildCapabilities(),
      hasSkillCapability: true,
      isLoading: false,
      isMutating: false,
      locale: "zh",
      remoteThreadActionsBlocked: false,
      selectedModelLabel: null,
      transcript: buildTranscript(true)
    });

    expect(model.archiveLabel).toBe("取消归档");
    expect(model.modelValue).toBe("-");
  });
});
