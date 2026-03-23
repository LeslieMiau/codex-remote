import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatTimeline } from "./chat-timeline";

function buildMessage(input: {
  body?: string;
  message_id: string;
  role: "assistant" | "system_action" | "user";
  timestamp: string;
}) {
  return {
    action_required: false,
    body: input.body ?? input.message_id,
    details: [],
    message_id: input.message_id,
    origin: "native_confirmed" as const,
    role: input.role,
    thread_id: "thread-1",
    timestamp: input.timestamp
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
});
