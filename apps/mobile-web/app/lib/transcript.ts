import type {
  CodexLiveState,
  CodexMessage,
  CodexTranscriptPageResponse,
  GatewayEvent,
  NativeRequestRecord
} from "@codex-remote/protocol";

function asNativeRequestStatus(
  value: unknown,
  fallback: NativeRequestRecord["status"]
): NativeRequestRecord["status"] {
  switch (value) {
    case "requested":
    case "responded":
    case "resolved":
    case "failed":
    case "canceled":
      return value;
    default:
      return fallback;
  }
}

function messageKey(message: CodexMessage) {
  return message.message_id ?? message.id ?? `${message.role}:${message.timestamp}`;
}

export function applyEventToLiveState(
  state: CodexLiveState | null,
  event: GatewayEvent
): CodexLiveState {
  const nextDetails = state?.details ?? [];
  return {
    status:
      typeof event.payload.state === "string"
        ? event.payload.state
        : event.event_type === "turn.failed"
          ? "failed"
          : event.event_type === "turn.completed"
            ? "completed"
            : "running",
    detail:
      typeof event.payload.message === "string"
        ? event.payload.message
        : state?.detail ?? "",
    assistant_text: state?.assistant_text ?? "",
    updated_at: new Date().toISOString(),
    awaiting_native_commit: state?.awaiting_native_commit ?? false,
    details: nextDetails
  };
}

export function mergeMessages(
  olderMessages: CodexMessage[] = [],
  newerMessages: CodexMessage[] = []
) {
  const merged = new Map<string, CodexMessage>();
  for (const message of [...olderMessages, ...newerMessages]) {
    merged.set(messageKey(message), message);
  }
  return [...merged.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function mergeTranscript(
  current: CodexTranscriptPageResponse | null,
  next: CodexTranscriptPageResponse
) {
  if (!current) {
    return next;
  }
  return {
    ...next,
    items: mergeMessages(current.items, next.items),
    approvals: next.approvals.length > 0 ? next.approvals : current.approvals,
    patches: next.patches.length > 0 ? next.patches : current.patches,
    native_requests: next.native_requests.length > 0 ? next.native_requests : current.native_requests,
    live_state: next.live_state ?? current.live_state ?? null
  };
}

function upsertNativeRequest(
  nativeRequests: NativeRequestRecord[],
  nextRequest: NativeRequestRecord
) {
  const byId = new Map(
    nativeRequests.map((request) => [request.native_request_id, request] as const)
  );
  byId.set(nextRequest.native_request_id, nextRequest);
  return [...byId.values()].sort((left, right) =>
    left.requested_at.localeCompare(right.requested_at)
  );
}

function deriveThreadState(input: CodexTranscriptPageResponse) {
  if (input.thread.archived) {
    return "archived";
  }
  if (input.thread.native_status_type === "systemError") {
    return "system_error";
  }
  if (input.native_requests.some((request) => request.status === "requested")) {
    return "waiting_input";
  }
  return input.thread.state;
}

export function applyEventToTranscript(
  current: CodexTranscriptPageResponse | null | undefined,
  event: GatewayEvent
): CodexTranscriptPageResponse | null {
  if (!current) {
    return current ?? null;
  }

  switch (event.event_type) {
    case "native_request.required": {
      const payload = event.payload as unknown as NativeRequestRecord;
      const alreadyKnown = current.native_requests.some(
        (request) => request.native_request_id === payload.native_request_id
      );
      const nextTranscript: CodexTranscriptPageResponse = {
        ...current,
        thread: {
          ...current.thread,
          pending_native_requests: alreadyKnown
            ? current.thread.pending_native_requests
            : (current.thread.pending_native_requests ?? 0) + 1,
          state: payload.kind === "user_input" ? "waiting_input" : current.thread.state,
          updated_at: event.timestamp ?? current.thread.updated_at
        },
        native_requests: upsertNativeRequest(current.native_requests, payload)
      };
      return {
        ...nextTranscript,
        thread: {
          ...nextTranscript.thread,
          state: deriveThreadState(nextTranscript)
        }
      };
    }
    case "native_request.resolved": {
      const nativeRequestId = String(event.payload.native_request_id ?? "");
      const nextNativeRequests = current.native_requests.map((request) =>
        request.native_request_id === nativeRequestId
          ? {
              ...request,
              status: asNativeRequestStatus(event.payload.status, request.status),
              resolved_at:
                typeof event.payload.resolved_at === "string"
                  ? event.payload.resolved_at
                  : request.resolved_at
            }
          : request
      );
      const pendingNativeRequests = nextNativeRequests.filter(
        (request) => request.status === "requested"
      ).length;
      const nextTranscript: CodexTranscriptPageResponse = {
        ...current,
        thread: {
          ...current.thread,
          pending_native_requests: pendingNativeRequests,
          updated_at: event.timestamp ?? current.thread.updated_at
        },
        native_requests: nextNativeRequests
      };
      return {
        ...nextTranscript,
        thread: {
          ...nextTranscript.thread,
          state: deriveThreadState(nextTranscript)
        }
      };
    }
    case "thread.metadata.updated": {
      const nextTranscript: CodexTranscriptPageResponse = {
        ...current,
        thread: {
          ...current.thread,
          title:
            typeof event.payload.title === "string" ? event.payload.title : current.thread.title,
          archived:
            typeof event.payload.archived === "boolean"
              ? event.payload.archived
              : current.thread.archived,
          native_status_type:
            typeof event.payload.native_status_type === "string"
              ? event.payload.native_status_type
              : current.thread.native_status_type,
          native_active_flags: Array.isArray(event.payload.native_active_flags)
            ? (event.payload.native_active_flags as string[])
            : current.thread.native_active_flags,
          native_token_usage:
            (event.payload.native_token_usage as Record<string, unknown> | undefined) ??
            current.thread.native_token_usage,
          updated_at:
            typeof event.payload.updated_at === "string"
              ? event.payload.updated_at
              : current.thread.updated_at
        }
      };
      return {
        ...nextTranscript,
        thread: {
          ...nextTranscript.thread,
          state: deriveThreadState(nextTranscript)
        }
      };
    }
    default:
      return current;
  }
}
