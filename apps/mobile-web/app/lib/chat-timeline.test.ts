import { describe, expect, it } from "vitest";

import { buildChatTimelineItems, getVisibleTimelineItems } from "./chat-timeline";

function buildMessage(input: {
  body?: string;
  details?: Array<{ kind: "thinking" | "testing" | "tool_call"; title: string }>;
  is_live_draft?: boolean;
  message_id: string;
  role: "assistant" | "system_action" | "user";
  timestamp: string;
}) {
  return {
    action_required: false,
    body: input.body ?? input.message_id,
    details: (input.details ?? []).map((detail, index) => ({
      ...detail,
      detail_id: `${input.message_id}:detail:${index}`,
      mono: false
    })),
    message_id: input.message_id,
    origin: "native_confirmed" as const,
    role: input.role,
    thread_id: "thread-1",
    timestamp: input.timestamp,
    is_live_draft: input.is_live_draft
  };
}

describe("chat timeline", () => {
  it("groups consecutive same-role messages within five minutes", () => {
    const items = buildChatTimelineItems({
      messages: [
        buildMessage({
          message_id: "message-1",
          role: "assistant",
          timestamp: "2026-03-23T09:00:00.000Z"
        }),
        buildMessage({
          message_id: "message-2",
          role: "assistant",
          timestamp: "2026-03-23T09:04:30.000Z"
        })
      ],
      pendingSends: []
    });

    expect(items).toHaveLength(2);
    expect(items[0]?.type).toBe("date_divider");
    expect(items[1]?.type).toBe("message_group");
    if (items[1]?.type !== "message_group") {
      throw new Error("Expected a message group.");
    }
    expect(items[1].group.messages.map((message) => message.message_id)).toEqual([
      "message-1",
      "message-2"
    ]);
  });

  it("separates live drafts instead of merging them into the previous assistant group", () => {
    const items = buildChatTimelineItems({
      messages: [
        buildMessage({
          message_id: "message-1",
          role: "assistant",
          timestamp: "2026-03-23T09:00:00.000Z"
        }),
        buildMessage({
          message_id: "message-2",
          role: "assistant",
          timestamp: "2026-03-23T09:01:00.000Z",
          is_live_draft: true
        })
      ],
      pendingSends: []
    });

    expect(items.filter((item) => item.type === "message_group")).toHaveLength(2);
  });

  it("keeps empty live drafts out of synthetic assistant fallback bodies", () => {
    const items = buildChatTimelineItems({
      messages: [
        buildMessage({
          body: "",
          message_id: "message-live",
          role: "assistant",
          timestamp: "2026-03-23T09:01:00.000Z",
          is_live_draft: true
        })
      ],
      pendingSends: []
    });

    expect(items).toHaveLength(2);
    expect(items[1]?.type).toBe("message_group");
    if (items[1]?.type !== "message_group") {
      throw new Error("Expected a message group.");
    }
    expect(items[1].group.messages[0]?.body).toBe("");
  });

  it("inserts date dividers across day boundaries and keeps pending sends in order", () => {
    const items = buildChatTimelineItems({
      messages: [
        buildMessage({
          message_id: "message-1",
          role: "user",
          timestamp: "2026-03-23T10:00:00.000Z"
        }),
        buildMessage({
          message_id: "message-2",
          role: "assistant",
          timestamp: "2026-03-24T10:01:00.000Z"
        })
      ],
      pendingSends: [
        {
          local_id: "pending-1",
          body: "Pending",
          prompt: "Pending",
          created_at: "2026-03-24T10:02:00.000Z",
          status: "sending",
          input_items: [],
          images: [],
          skills: []
        }
      ]
    });

    expect(items.map((item) => item.type)).toEqual([
      "date_divider",
      "message_group",
      "date_divider",
      "message_group",
      "pending_send"
    ]);
  });

  it("appends a live banner after the conversation items", () => {
    const items = buildChatTimelineItems({
      messages: [
        buildMessage({
          message_id: "message-1",
          role: "assistant",
          timestamp: "2026-03-23T09:00:00.000Z"
        })
      ],
      pendingSends: [],
      liveBanner: {
        live_state: {
          status: "running",
          detail: "Codex is still typing",
          assistant_text: "",
          updated_at: "2026-03-23T09:01:00.000Z",
          awaiting_native_commit: false,
          details: []
        },
        tone: "neutral",
        has_inline_draft: false
      }
    });

    expect(items.at(-1)?.type).toBe("live_banner");
  });

  it("returns only the latest visible timeline window", () => {
    const allItems = Array.from({ length: 8 }, (_, index) => ({
      type: "pending_send" as const,
      id: `pending:${index}`,
      timestamp: `2026-03-23T09:0${index}:00.000Z`,
      pending_send: {
        local_id: `pending-${index}`,
        body: String(index),
        prompt: String(index),
        created_at: `2026-03-23T09:0${index}:00.000Z`,
        status: "sending" as const,
        input_items: [],
        images: [],
        skills: []
      }
    }));

    const visible = getVisibleTimelineItems(allItems, 3);
    expect(visible.hiddenCount).toBe(5);
    expect(visible.visibleItems.map((item) => item.id)).toEqual([
      "pending:5",
      "pending:6",
      "pending:7"
    ]);
  });
});
