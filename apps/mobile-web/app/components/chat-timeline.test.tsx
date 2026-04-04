import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CodexMessage } from "@codex-remote/protocol";

import { ChatTimeline } from "./chat-timeline";

function buildMessage(input: {
  body?: string;
  details?: CodexMessage["details"];
  message_id: string;
  role: "assistant" | "system_action" | "user";
  timestamp: string;
  title?: string;
}) {
  return {
    action_required: false,
    body: input.body ?? input.message_id,
    collaboration_mode: "default" as const,
    details: input.details ?? [],
    message_id: input.message_id,
    origin: "native_confirmed" as const,
    role: input.role,
    thread_id: "thread-1",
    timestamp: input.timestamp,
    title: input.title
  };
}

describe("chat timeline component", () => {
  it("renders date dividers, grouped messages, pending sends, and live banners", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatTimeline, {
        hasMoreRemoteHistory: true,
        hiddenItemCount: 12,
        isLoading: false,
        isLoadingOlder: false,
        locale: "en",
        onDismissPendingSend() {},
        onEditPendingSend() {},
        onOpenPatchReview() {},
        onRetryPendingSend() {},
        pendingApprovalsById: new Map(),
        timelineItems: [
          {
            type: "date_divider" as const,
            id: "date:2026-03-23",
            date_key: "2026-03-23",
            timestamp: "2026-03-23T09:00:00.000Z"
          },
          {
            type: "message_group" as const,
            id: "group:assistant",
            timestamp: "2026-03-23T09:02:00.000Z",
            group: {
              action_required: false,
              detail_count: 0,
              ended_at: "2026-03-23T09:02:00.000Z",
              group_id: "group:assistant",
              includes_live_draft: false,
              messages: [
                buildMessage({
                  body: "Hello from Codex",
                  message_id: "message-1",
                  role: "assistant",
                  timestamp: "2026-03-23T09:02:00.000Z"
                })
              ],
              role: "assistant",
              started_at: "2026-03-23T09:02:00.000Z"
            }
          },
          {
            type: "pending_send" as const,
            id: "pending:1",
            timestamp: "2026-03-23T09:03:00.000Z",
            pending_send: {
              local_id: "pending-1",
              body: "Queued on phone",
              prompt: "Queued on phone",
              created_at: "2026-03-23T09:03:00.000Z",
              status: "failed" as const,
              input_items: [],
              images: [],
              skills: []
            }
          },
          {
            type: "live_banner" as const,
            id: "live:1",
            timestamp: "2026-03-23T09:04:00.000Z",
            tone: "warning" as const,
            has_inline_draft: false,
            live_state: {
              status: "running",
              detail: "Codex is still working",
              assistant_text: "",
              updated_at: "2026-03-23T09:04:00.000Z",
              awaiting_native_commit: false,
              details: []
            }
          }
        ]
      })
    );

    expect(markup).toContain("Hello from Codex");
    expect(markup).toContain("Queued on phone");
    expect(markup).toContain("Codex is still working");
    expect(markup).toContain("12 more items are hidden above");
    expect(markup).toContain("Retry");
  });

  it("renders the empty state when no items are available", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatTimeline, {
        hasMoreRemoteHistory: false,
        hiddenItemCount: 0,
        isLoading: false,
        isLoadingOlder: false,
        locale: "en",
        onDismissPendingSend() {},
        onEditPendingSend() {},
        onOpenPatchReview() {},
        onRetryPendingSend() {},
        pendingApprovalsById: new Map(),
        timelineItems: []
      })
    );

    expect(markup).toContain("No messages yet in this chat.");
  });

  it("renders a degraded empty-state message when the workspace provides one", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatTimeline, {
        emptyMessage: "Shared chat state is degraded right now.",
        hasMoreRemoteHistory: false,
        hiddenItemCount: 0,
        isLoading: false,
        isLoadingOlder: false,
        locale: "en",
        onDismissPendingSend() {},
        onEditPendingSend() {},
        onOpenPatchReview() {},
        onRetryPendingSend() {},
        pendingApprovalsById: new Map(),
        timelineItems: []
      })
    );

    expect(markup).toContain("Shared chat state is degraded right now.");
    expect(markup).not.toContain("No messages yet in this chat.");
  });

  it("renders system actions as lightweight review notices", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatTimeline, {
        hasMoreRemoteHistory: false,
        hiddenItemCount: 0,
        isLoading: false,
        isLoadingOlder: false,
        locale: "en",
        onDismissPendingSend() {},
        onEditPendingSend() {},
        onOpenPatchReview() {},
        onRetryPendingSend() {},
        pendingApprovalsById: new Map(),
        timelineItems: [
          {
            type: "message_group" as const,
            id: "group:system",
            timestamp: "2026-03-23T09:02:00.000Z",
            group: {
              action_required: true,
              detail_count: 0,
              ended_at: "2026-03-23T09:02:00.000Z",
              group_id: "group:system",
              includes_live_draft: false,
              messages: [
                {
                  ...buildMessage({
                    body: "A patch is ready to review.",
                    message_id: "message-system-1",
                    role: "system_action",
                    timestamp: "2026-03-23T09:02:00.000Z"
                  }),
                  patch_id: "patch-1",
                  title: "Patch ready"
                }
              ],
              role: "system_action",
              started_at: "2026-03-23T09:02:00.000Z"
            }
          }
        ]
      })
    );

    expect(markup).toContain("Patch ready");
    expect(markup).toContain("A patch is ready to review.");
    expect(markup).toContain("Open review");
  });

  it("summarizes assistant process details behind a single disclosure", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatTimeline, {
        hasMoreRemoteHistory: false,
        hiddenItemCount: 0,
        isLoading: false,
        isLoadingOlder: false,
        locale: "en",
        onDismissPendingSend() {},
        onEditPendingSend() {},
        onOpenPatchReview() {},
        onRetryPendingSend() {},
        pendingApprovalsById: new Map(),
        timelineItems: [
          {
            type: "message_group" as const,
            id: "group:assistant-detail",
            timestamp: "2026-03-23T09:02:00.000Z",
            group: {
              action_required: false,
              detail_count: 2,
              ended_at: "2026-03-23T09:02:00.000Z",
              group_id: "group:assistant-detail",
              includes_live_draft: false,
              messages: [
                buildMessage({
                  body: "I found the regression and cleaned up the layout.",
                  details: [
                    {
                      detail_id: "detail-1",
                      kind: "thinking",
                      mono: false,
                      title: "Checked the timeline layout",
                      body: "Looked at the assistant bubble stack first.",
                      timestamp: "2026-03-23T09:01:00.000Z"
                    },
                    {
                      detail_id: "detail-2",
                      kind: "tool_result",
                      mono: false,
                      title: "Opened the CSS module",
                      body: "Confirmed the old disclosure styles were too heavy.",
                      timestamp: "2026-03-23T09:01:30.000Z"
                    }
                  ],
                  message_id: "message-detail-1",
                  role: "assistant",
                  timestamp: "2026-03-23T09:02:00.000Z"
                })
              ],
              role: "assistant",
              started_at: "2026-03-23T09:02:00.000Z"
            }
          }
        ]
      })
    );

    expect(markup).toContain("Process and reads");
    expect(markup).toContain("1 steps");
    expect(markup).toContain("1 reads");
    expect(markup).toContain("Checked the timeline layout");
    expect(markup).toContain("Opened the CSS module");
  });

  it("does not render the old synthetic assistant fallback copy for empty live drafts", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatTimeline, {
        hasMoreRemoteHistory: false,
        hiddenItemCount: 0,
        isLoading: false,
        isLoadingOlder: false,
        locale: "en",
        onDismissPendingSend() {},
        onEditPendingSend() {},
        onOpenPatchReview() {},
        onRetryPendingSend() {},
        pendingApprovalsById: new Map(),
        timelineItems: [
          {
            type: "message_group" as const,
            id: "group:assistant-live",
            timestamp: "2026-03-23T09:02:00.000Z",
            group: {
              action_required: false,
              detail_count: 0,
              ended_at: "2026-03-23T09:02:00.000Z",
              group_id: "group:assistant-live",
              includes_live_draft: true,
              messages: [
                {
                  ...buildMessage({
                    body: "",
                    message_id: "message-live-1",
                    role: "assistant",
                    timestamp: "2026-03-23T09:02:00.000Z"
                  }),
                  is_live_draft: true
                }
              ],
              role: "assistant",
              started_at: "2026-03-23T09:02:00.000Z"
            }
          }
        ]
      })
    );

    expect(markup).not.toContain("Codex is still typing...");
    expect(markup).not.toContain("Codex is processing this request");
  });
});
