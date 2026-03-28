import { describe, expect, it } from "vitest";
import type {
  CodexCapabilitiesResponse,
  CodexSharedSettingsResponse,
  CodexTranscriptPageResponse
} from "@codex-remote/protocol";

import {
  buildSharedThreadWorkspaceScreenModel,
  parseNativeRequestQuestions
} from "./shared-thread-workspace-screen-model";

function buildTranscript(
  overrides: Partial<CodexTranscriptPageResponse> = {}
): CodexTranscriptPageResponse {
  return {
    thread: {
      thread_id: "thread_demo",
      project_id: "project_demo",
      title: "Demo thread",
      project_label: "codex-remote",
      repo_root: "/repo/codex-remote",
      state: "ready",
      archived: false,
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
    has_more: false,
    ...overrides
  };
}

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

function buildSharedSettings(
  overrides: Partial<CodexSharedSettingsResponse> = {}
): CodexSharedSettingsResponse {
  return {
    model: "gpt-5.4",
    model_reasoning_effort: "medium",
    approval_policy: "on-request",
    sandbox_mode: "workspace-write",
    service_tier: "default",
    available_models: [
      {
        slug: "gpt-5.4",
        display_name: "GPT-5.4"
      }
    ],
    ...overrides
  } as CodexSharedSettingsResponse;
}

describe("shared thread workspace screen model", () => {
  it("derives composer blocking copy from pending approvals", () => {
    const model = buildSharedThreadWorkspaceScreenModel({
      transcript: buildTranscript({
        approvals: [
          {
            approval_id: "approval_demo",
            project_id: "project_demo",
            thread_id: "thread_demo",
            turn_id: "turn_demo",
            kind: "command",
            source: "legacy_gateway",
            status: "requested",
            reason: "Need confirmation.",
            requested_at: "2026-03-28T10:01:00.000Z",
            recoverable: true
          }
        ]
      }),
      capabilities: buildCapabilities(),
      sharedSettings: buildSharedSettings(),
      locale: "zh",
      selectedImages: [],
      isMutating: false,
      error: null,
      returnToListHref: "/projects"
    });

    expect(model.pendingApprovals).toHaveLength(1);
    expect(model.leadApproval?.approval_id).toBe("approval_demo");
    expect(model.composerDisabledReason).toBe("先处理批准请求，再继续发新消息。");
  });

  it("marks degraded fallback threads and preserves attachment capabilities", () => {
    const model = buildSharedThreadWorkspaceScreenModel({
      transcript: buildTranscript({
        thread: {
          ...buildTranscript().thread,
          degraded: true,
          degraded_reason: "shared_state_unavailable",
          sync_state: "sync_failed"
        }
      }),
      capabilities: buildCapabilities({
        shared_state_available: false
      }),
      sharedSettings: buildSharedSettings(),
      locale: "en",
      selectedImages: [],
      isMutating: false,
      error: "Gateway degraded",
      returnToListHref: "/queue"
    });

    expect(model.isOfflineFallbackThread).toBe(true);
    expect(model.returnToListLabel).toBe("Back to inbox");
    expect(model.hasImageCapability).toBe(true);
    expect(model.topStatus?.detail).toBe("Gateway degraded");
  });

  it("covers native input, pending review, failed upload, and live follow-up composer gates", () => {
    const waitingForInput = buildSharedThreadWorkspaceScreenModel({
      transcript: buildTranscript({
        native_requests: [
          {
            native_request_id: "native_demo",
            kind: "user_input",
            source: "native",
            status: "requested",
            requested_at: "2026-03-28T10:02:00.000Z"
          }
        ]
      }),
      capabilities: buildCapabilities(),
      sharedSettings: buildSharedSettings(),
      locale: "en",
      selectedImages: [],
      isMutating: false,
      error: null,
      returnToListHref: "/projects"
    });
    const waitingForReview = buildSharedThreadWorkspaceScreenModel({
      transcript: buildTranscript({
        patches: [
          {
            patch_id: "patch_demo",
            thread_id: "thread_demo",
            project_id: "project_demo",
            turn_id: "turn_demo",
            summary: "Review me",
            status: "generated",
            created_at: "2026-03-28T10:03:00.000Z",
            updated_at: "2026-03-28T10:03:00.000Z",
            rollback_available: false,
            changes: [],
            files: []
          }
        ]
      }),
      capabilities: buildCapabilities(),
      sharedSettings: buildSharedSettings(),
      locale: "en",
      selectedImages: [],
      isMutating: false,
      error: null,
      returnToListHref: "/projects"
    });
    const failedUpload = buildSharedThreadWorkspaceScreenModel({
      transcript: buildTranscript(),
      capabilities: buildCapabilities(),
      sharedSettings: buildSharedSettings(),
      locale: "en",
      selectedImages: [
        {
          local_id: "image-1",
          file_name: "demo.png",
          content_type: "image/png",
          status: "failed",
          error: "upload failed"
        }
      ],
      isMutating: false,
      error: null,
      returnToListHref: "/projects"
    });
    const liveFollowUpUnavailable = buildSharedThreadWorkspaceScreenModel({
      transcript: buildTranscript({
        thread: {
          ...buildTranscript().thread,
          active_turn_id: "turn_demo",
          state: "running"
        }
      }),
      capabilities: buildCapabilities({
        live_follow_up: false
      }),
      sharedSettings: buildSharedSettings(),
      locale: "en",
      selectedImages: [],
      isMutating: false,
      error: null,
      returnToListHref: "/projects"
    });

    expect(waitingForInput.composerDisabledReason).toBe(
      "Resolve the input request before sending a new message."
    );
    expect(waitingForReview.composerDisabledReason).toBe(
      "Review the pending change before sending a new message."
    );
    expect(failedUpload.composerDisabledReason).toBe(
      "Remove the failed image upload or try again before sending."
    );
    expect(liveFollowUpUnavailable.composerDisabledReason).toBe(
      "Live follow-up unavailable on this Codex build."
    );
  });

  it("parses native request questions into stable answer options", () => {
    const questions = parseNativeRequestQuestions({
      native_request_id: "native_demo",
      kind: "user_input",
      source: "native",
      status: "requested",
      requested_at: "2026-03-28T10:00:00.000Z",
      payload: {
        questions: [
          {
            id: "answer",
            question: "Choose one",
            options: [
              {
                label: "Alpha",
                value: "alpha",
                description: "Recommended"
              }
            ]
          }
        ]
      }
    });

    expect(questions).toEqual([
      {
        id: "answer",
        question: "Choose one",
        options: [
          {
            label: "Alpha",
            value: "alpha",
            description: "Recommended"
          }
        ]
      }
    ]);
  });
});
