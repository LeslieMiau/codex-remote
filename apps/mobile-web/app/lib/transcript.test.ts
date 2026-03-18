import { describe, expect, it } from "vitest";

import {
  applyEventToTranscript,
  mergeMessages,
  mergeTranscript
} from "./transcript";

describe("transcript", () => {
  it("merges messages by message id and keeps chronological order", () => {
    expect(
      mergeMessages(
        [
          {
            message_id: "message-2",
            role: "assistant",
            thread_id: "thread_1",
            timestamp: "2026-03-16T09:00:02.000Z",
            origin: "native_confirmed",
            details: [],
            action_required: false
          }
        ],
        [
          {
            message_id: "message-1",
            role: "user",
            thread_id: "thread_1",
            timestamp: "2026-03-16T09:00:01.000Z",
            origin: "native_confirmed",
            details: [],
            action_required: false
          },
          {
            message_id: "message-2",
            role: "assistant",
            thread_id: "thread_1",
            timestamp: "2026-03-16T09:00:02.000Z",
            origin: "native_confirmed",
            body: "patched",
            details: [],
            action_required: false
          }
        ]
      ).map((message) => message.message_id)
    ).toEqual(["message-1", "message-2"]);
  });

  it("prefers fresher transcript metadata while preserving existing actions when needed", () => {
    const merged = mergeTranscript(
      {
        thread: {
          thread_id: "thread_1"
        },
        items: [
          {
            message_id: "message-1",
            role: "user",
            thread_id: "thread_1",
            timestamp: "2026-03-16T09:00:01.000Z",
            origin: "native_confirmed",
            details: [],
            action_required: false
          }
        ],
        approvals: [
          {
            approval_id: "approval_1",
            reason: "Allow",
            requested_at: "2026-03-16T09:00:01.000Z",
            status: "requested"
          }
        ],
        patches: [],
        native_requests: [],
        live_state: null,
        has_more: false
      } as never,
      {
        thread: {
          thread_id: "thread_1"
        },
        items: [
          {
            message_id: "message-2",
            role: "assistant",
            thread_id: "thread_1",
            timestamp: "2026-03-16T09:00:02.000Z",
            origin: "native_confirmed",
            details: [],
            action_required: false
          }
        ],
        approvals: [],
        patches: [],
        native_requests: [],
        live_state: {
          status: "running",
          detail: "Streaming",
          assistant_text: "",
          updated_at: "2026-03-16T09:00:02.000Z",
          awaiting_native_commit: false,
          details: []
        },
        has_more: false
      } as never
    );

    expect(merged.items.map((message) => message.message_id)).toEqual([
      "message-1",
      "message-2"
    ]);
    expect(merged.approvals).toHaveLength(1);
    expect(merged.live_state?.status).toBe("running");
  });

  it("applies native request events to transcript state", () => {
    const base = {
      thread: {
        archived: false,
        native_status_type: "idle",
        pending_native_requests: 0,
        state: "ready",
        title: "Thread",
        updated_at: "2026-03-16T09:00:00.000Z"
      },
      items: [],
      approvals: [],
      patches: [],
      native_requests: [],
      live_state: null,
      has_more: false
    } as never;

    const required = applyEventToTranscript(base, {
      event_type: "native_request.required",
      payload: {
        kind: "user_input",
        native_request_id: "native_1",
        requested_at: "2026-03-16T09:00:05.000Z",
        status: "requested"
      },
      stream_seq: 1
    } as never);
    expect(required?.thread.state).toBe("waiting_input");
    expect(required?.thread.pending_native_requests).toBe(1);

    const resolved = applyEventToTranscript(required, {
      event_type: "native_request.resolved",
      payload: {
        native_request_id: "native_1",
        status: "resolved"
      },
      stream_seq: 2
    } as never);
    expect(resolved?.thread.pending_native_requests).toBe(0);
  });
});
