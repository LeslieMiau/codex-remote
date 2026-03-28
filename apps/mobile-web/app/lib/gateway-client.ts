import type {
  ApprovalRequest,
  CodexCapabilitiesResponse,
  CodexDiagnosticsSummaryResponse,
  CodexLiveState,
  CodexOverviewResponse,
  CodexMessage,
  CodexPatchRecord,
  CodexReviewStartBody,
  CodexReviewStartResponse,
  CodexSharedSettingsResponse,
  CodexThread,
  CodexThreadForkResponse,
  CodexThreadSkillsResponse,
  CodexTimelineResponse,
  CodexTranscriptPageResponse,
  GatewayEvent,
  NativeRequestRecord,
  TurnInputItem,
  UpdateCodexSharedSettingsBody,
  UpdateCodexSharedSettingsResponse,
  UploadedImageAttachment
} from "@codex-remote/protocol";

import {
  buildGatewayHttpUrl,
  buildGatewayWsUrl,
  getGatewayBase
} from "./gateway-url";
import {
  buildApprovalApiPath,
  buildNativeRequestApiPath,
  buildPatchApiPath,
  buildRunApiPath,
  buildThreadApiPath
} from "./codex-paths";

export class GatewayRequestError extends Error {
  constructor(
    message: string,
    public status = 500,
    public code?: string
  ) {
    super(message);
  }
}

export type SharedRunInputItem = TurnInputItem;
export type TransportState = "idle" | "websocket" | "sse";

const gatewayBase = getGatewayBase();

function now() {
  return new Date().toISOString();
}

function requestId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

function urlFor(pathname: string) {
  return buildGatewayHttpUrl(gatewayBase, pathname);
}

function websocketUrlFor(pathname: string) {
  return buildGatewayWsUrl(gatewayBase, pathname);
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!(init?.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(urlFor(pathname), {
    cache: "no-store",
    ...init,
    headers
  });
  const payload = await readJson(response);

  if (!response.ok) {
    const code =
      typeof payload.error === "string" && payload.error.trim() ? payload.error.trim() : undefined;
    const message =
      typeof payload.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : code ?? `Gateway request failed (${response.status})`;
    throw new GatewayRequestError(message, response.status, code);
  }

  return payload as T;
}

async function readOrFallback<T>(pathname: string, fallback: () => T): Promise<T> {
  try {
    return await requestJson<T>(pathname, {
      method: "GET"
    });
  } catch (error) {
    if (error instanceof GatewayRequestError) {
      throw error;
    }
    return fallback();
  }
}

function buildCapabilities(): CodexCapabilitiesResponse {
  return {
    adapter_kind: "codex-app-server",
    collaboration_mode: "default",
    shared_state_available: false,
    degraded: true,
    shared_thread_create: false,
    supports_images: false,
    run_start: false,
    live_follow_up: false,
    image_inputs: false,
    interrupt: false,
    approvals: false,
    patch_decisions: false,
    thread_rename: false,
    thread_archive: false,
    thread_compact: false,
    thread_fork: false,
    thread_rollback: false,
    review_start: false,
    skills_input: false,
    diagnostics_read: false,
    settings_read: true,
    settings_write: false,
    shared_model_config: true,
    shared_history: false,
    shared_threads: false,
    reason: "Shared gateway is offline."
  };
}

function buildThread(threadId = "recovered-thread"): CodexThread {
  return {
    thread_id: threadId,
    title: "Chat",
    project_id: "recovered-project",
    project_label: "Codex",
    repo_root: "/Users/miau/Documents/codex-remote",
    source: "gateway_fallback",
    state: "ready",
    archived: false,
    has_active_run: false,
    pending_approvals: 0,
    pending_patches: 0,
    pending_native_requests: 0,
    active_turn_id: null,
    last_stream_seq: 0,
    sync_state: "sync_failed",
    degraded: true,
    degraded_reason: "gateway_offline",
    updated_at: now()
  };
}

function buildTranscript(threadId = "recovered-thread"): CodexTranscriptPageResponse {
  const thread = buildThread(threadId);
  const items: CodexMessage[] = [];
  const liveState: CodexLiveState = {
    status: "ready",
    detail: "",
    assistant_text: "",
    updated_at: now(),
    awaiting_native_commit: false,
    details: []
  };
  return {
    thread,
    items,
    approvals: [],
    patches: [],
    native_requests: [],
    next_cursor: null,
    has_more: false,
    live_state: liveState
  };
}

function buildOverview(): CodexOverviewResponse {
  const thread = buildThread();
  return {
    projects: [
      {
        project_id: thread.project_id,
        label: thread.project_label,
        repo_root: thread.repo_root
      }
    ],
    threads: [thread],
    queue: [],
    capabilities: buildCapabilities()
  };
}

function buildTimeline(threadId = "recovered-thread"): CodexTimelineResponse {
  const timestamp = now();
  const patch: CodexPatchRecord = {
    patch_id: "recovered-patch",
    project_id: "recovered-project",
    thread_id: threadId,
    turn_id: "recovered-turn",
    status: "generated",
    summary: "Offline patch snapshot",
    test_summary: "Patch details are unavailable while the gateway is offline.",
    created_at: timestamp,
    updated_at: timestamp,
    rollback_available: false,
    files: [],
    changes: []
  };
  return {
    thread: buildThread(threadId),
    items: [],
    approvals: [],
    patches: [patch],
    native_requests: []
  };
}

function buildSettings(): CodexSharedSettingsResponse {
  return {
    locale: "en",
    model: "gpt-5.4",
    model_reasoning_effort: "medium",
    available_models: [
      {
        slug: "gpt-5.4",
        display_name: "GPT-5.4",
        reasoning_levels: [{ effort: "medium" }],
        input_modalities: [],
        supports_personality: false,
        is_default: true
      }
    ],
    experimental_features: [],
    read_only: true
  };
}

export async function archiveSharedThread(threadId: string) {
  return requestJson(buildThreadApiPath(threadId, "/archive"), {
    method: "POST",
    body: JSON.stringify({
      actor_id: "mobile_web",
      request_id: requestId("archive-thread")
    })
  });
}

export async function compactSharedThread(threadId: string) {
  return requestJson(buildThreadApiPath(threadId, "/compact"), {
    method: "POST",
    body: JSON.stringify({
      actor_id: "mobile_web",
      request_id: requestId("compact-thread")
    })
  });
}

export async function createSharedThread(input: { prompt: string; repoRoot: string }) {
  return requestJson<{ thread: { thread_id: string } }>("/threads/shared", {
    method: "POST",
    body: JSON.stringify({
      actor_id: "mobile_web",
      request_id: requestId("create-thread"),
      repo_root: input.repoRoot,
      prompt: input.prompt
    })
  });
}

export async function decidePatch(
  patchId: string,
  action: "apply" | "discard" | "rollback"
) {
  if (action === "rollback") {
    return requestJson(buildPatchApiPath(patchId, "/rollback"), {
      method: "POST",
      body: JSON.stringify({
        actor_id: "mobile_web",
        request_id: requestId("rollback-patch")
      })
    });
  }

  return requestJson(buildPatchApiPath(patchId, `/${action}`), {
    method: "POST",
    body: JSON.stringify({
      actor_id: "mobile_web",
      request_id: requestId(`${action}-patch`)
    })
  });
}

export async function followUpRun(
  runId: string,
  prompt: string,
  inputItems?: SharedRunInputItem[]
) {
  return requestJson(buildRunApiPath(runId, "/follow-ups"), {
    method: "POST",
    body: JSON.stringify({
      actor_id: "mobile_web",
      request_id: requestId("follow-up"),
      prompt,
      input_items: inputItems
    })
  });
}

export async function forkSharedThread(threadId: string): Promise<CodexThreadForkResponse> {
  return requestJson<CodexThreadForkResponse>(buildThreadApiPath(threadId, "/fork"), {
    method: "POST",
    body: JSON.stringify({
      actor_id: "mobile_web",
      request_id: requestId("fork-thread")
    })
  });
}

export async function getCodexCapabilities(): Promise<CodexCapabilitiesResponse> {
  return readOrFallback("/capabilities", buildCapabilities);
}

export async function getCodexMessagesLatest(
  threadId = "recovered-thread",
  limit = 20
): Promise<CodexTranscriptPageResponse> {
  return readOrFallback(
    buildThreadApiPath(
      threadId,
      `/messages/latest?limit=${encodeURIComponent(String(limit))}`
    ),
    () => buildTranscript(threadId)
  );
}

export async function getCodexMessagesPage(input: {
  threadId?: string;
  cursor?: string | null;
  limit?: number;
} = {}): Promise<CodexTranscriptPageResponse> {
  const threadId = input.threadId ?? "recovered-thread";
  const search = new URLSearchParams();
  if (input.cursor) {
    search.set("cursor", input.cursor);
  }
  if (typeof input.limit === "number") {
    search.set("limit", String(input.limit));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return readOrFallback(
    buildThreadApiPath(threadId, `/messages${suffix}`),
    () => buildTranscript(threadId)
  );
}

export async function getCodexOverview(input?: {
  includeArchived?: boolean;
}): Promise<CodexOverviewResponse> {
  const search = new URLSearchParams();
  if (input?.includeArchived) {
    search.set("include_archived", "1");
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return readOrFallback(`/overview${suffix}`, buildOverview);
}

export async function getCodexSharedSettings(): Promise<CodexSharedSettingsResponse> {
  return readOrFallback("/settings/shared", buildSettings);
}

export async function getCodexDiagnosticsSummary(): Promise<CodexDiagnosticsSummaryResponse> {
  return readOrFallback("/diagnostics/summary", () => ({
    account: null,
    requires_openai_auth: false,
    rate_limits: null,
    rate_limits_by_limit_id: {},
    mcp_servers: [],
    errors: {}
  }));
}

export async function updateCodexSharedSettings(
  input: UpdateCodexSharedSettingsBody
): Promise<UpdateCodexSharedSettingsResponse> {
  return requestJson<UpdateCodexSharedSettingsResponse>("/settings/shared", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function getCodexTimeline(threadId: string): Promise<CodexTimelineResponse> {
  return readOrFallback(buildThreadApiPath(threadId, "/timeline"), () =>
    buildTimeline(threadId)
  );
}

export async function getThreadSkills(threadId: string): Promise<
  CodexThreadSkillsResponse["skills"]
> {
  const response = await readOrFallback<CodexThreadSkillsResponse>(
    buildThreadApiPath(threadId, "/skills"),
    () => ({
      cwd: "",
      skills: [],
      errors: []
    })
  );
  return response.skills;
}

export async function interruptSharedRun(runId: string) {
  return requestJson(buildRunApiPath(runId, "/interrupt"), {
    method: "POST",
    body: JSON.stringify({
      actor_id: "mobile_web",
      request_id: requestId("interrupt-run")
    })
  });
}

export async function renameSharedThread(threadId: string, name: string) {
  return requestJson(buildThreadApiPath(threadId, "/name"), {
    method: "POST",
    body: JSON.stringify({
      actor_id: "mobile_web",
      request_id: requestId("rename-thread"),
      name
    })
  });
}

export async function respondNativeRequest(input: {
  nativeRequestId: string;
  action?: "respond" | "cancel";
  responsePayload?: unknown;
}): Promise<NativeRequestRecord | null> {
  const response = await requestJson<{
    native_request?: NativeRequestRecord;
  }>(buildNativeRequestApiPath(input.nativeRequestId), {
    method: "POST",
    body: JSON.stringify({
      actor_id: "mobile_web",
      request_id: requestId("respond-native-request"),
      action: input.action ?? "respond",
      response_payload: input.responsePayload
    })
  });
  return response.native_request ?? null;
}

export async function resolveApproval(
  approvalId: string,
  approved: boolean,
  options?: {
    confirmed?: boolean;
    nativeDecision?: unknown;
  }
): Promise<ApprovalRequest | null> {
  const response = await requestJson<{
    approval?: ApprovalRequest;
  }>(buildApprovalApiPath(approvalId, approved ? "approve" : "reject"), {
    method: "POST",
    body: JSON.stringify({
      actor_id: "mobile_web",
      request_id: requestId(approved ? "approve" : "reject"),
      confirmed: options?.confirmed ?? approved,
      native_decision: options?.nativeDecision
    })
  });
  return response.approval ?? null;
}

export async function rollbackSharedThread(threadId: string, numTurns?: number) {
  return requestJson(buildThreadApiPath(threadId, "/rollback"), {
    method: "POST",
    body: JSON.stringify({
      actor_id: "mobile_web",
      request_id: requestId("rollback-thread"),
      num_turns: numTurns
    })
  });
}

export async function startSharedReview(
  input: CodexReviewStartBody
): Promise<CodexReviewStartResponse> {
  const threadId = input.thread_id ?? input.threadId;
  if (!threadId) {
    throw new GatewayRequestError("A thread id is required to start a review.", 400);
  }

  return requestJson<CodexReviewStartResponse>(
    buildThreadApiPath(threadId, "/reviews"),
    {
      method: "POST",
      body: JSON.stringify({
        actor_id: input.actor_id ?? "mobile_web",
        request_id: input.request_id ?? requestId("start-review"),
        target: input.target,
        delivery: input.delivery
      })
    }
  );
}

export async function startSharedRun(
  threadId: string,
  prompt: string,
  inputItems?: SharedRunInputItem[],
  collaborationMode?: "default" | "plan"
) {
  return requestJson(buildThreadApiPath(threadId, "/runs"), {
    method: "POST",
    body: JSON.stringify({
      actor_id: "mobile_web",
      request_id: requestId("start-run"),
      prompt,
      input_items: inputItems,
      collaboration_mode: collaborationMode
    })
  });
}

export function subscribeToThreadStream(input: {
  threadId: string;
  lastSeenSeq: number;
  onEvent(event: GatewayEvent): void;
  onTransport(state: TransportState): void;
  onError?(message: string): void;
}) {
  window.queueMicrotask(() => {
    input.onTransport("idle");
  });

  let closed = false;
  let eventSource: EventSource | null = null;
  let socket: WebSocket | null = null;
  let fallbackStarted = false;
  let socketOpened = false;

  const cleanupSocket = () => {
    if (!socket) {
      return;
    }
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    socket.onopen = null;
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close();
    }
    socket = null;
  };

  const cleanupEventSource = () => {
    if (!eventSource) {
      return;
    }
    eventSource.onopen = null;
    eventSource.onerror = null;
    eventSource.onmessage = null;
    eventSource.close();
    eventSource = null;
  };

  const handlePayload = (payload: string) => {
    if (!payload) {
      return;
    }

    try {
      input.onEvent(JSON.parse(payload) as GatewayEvent);
    } catch {
      input.onError?.("Received an invalid realtime event payload.");
    }
  };

  const startSse = (message?: string) => {
    if (closed || fallbackStarted) {
      return;
    }

    fallbackStarted = true;
    cleanupSocket();

    if (typeof window.EventSource !== "function") {
      input.onTransport("idle");
      input.onError?.(message ?? "Realtime streaming is unavailable on this device.");
      return;
    }

    const sseUrl = new URL(
      buildGatewayHttpUrl(gatewayBase, "/events"),
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "http://127.0.0.1:3000"
    );
    sseUrl.searchParams.set("thread_id", input.threadId);
    sseUrl.searchParams.set("last_seen_seq", String(Math.max(0, input.lastSeenSeq)));

    if (message) {
      input.onError?.(message);
    }

    eventSource = new window.EventSource(sseUrl.toString());
    eventSource.onopen = () => {
      if (closed) {
        return;
      }
      input.onTransport("sse");
    };
    eventSource.onmessage = (event) => {
      handlePayload(event.data);
    };
    eventSource.onerror = () => {
      if (closed) {
        return;
      }
      input.onTransport("idle");
      input.onError?.("Realtime stream interrupted. Retrying with SSE.");
    };
  };

  if (typeof window.WebSocket === "function") {
    const wsUrl = new URL(websocketUrlFor("/ws"));
    wsUrl.searchParams.set("thread_id", input.threadId);
    wsUrl.searchParams.set("last_seen_seq", String(Math.max(0, input.lastSeenSeq)));

    socket = new window.WebSocket(wsUrl.toString());
    socket.onopen = () => {
      if (closed) {
        cleanupSocket();
        return;
      }
      socketOpened = true;
      input.onTransport("websocket");
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        handlePayload(event.data);
        return;
      }

      if (event.data instanceof Blob) {
        void event.data.text().then(handlePayload);
      }
    };
    socket.onerror = () => {
      if (closed) {
        return;
      }
      if (!socketOpened) {
        startSse("WebSocket unavailable. Falling back to SSE.");
      }
    };
    socket.onclose = () => {
      if (closed) {
        return;
      }
      startSse(
        socketOpened ? "WebSocket closed. Falling back to SSE." : undefined
      );
    };
  } else {
    startSse();
  }

  return () => {
    closed = true;
    cleanupSocket();
    cleanupEventSource();
    input.onTransport("idle");
  };
}

export async function unarchiveSharedThread(threadId: string) {
  return requestJson(buildThreadApiPath(threadId, "/unarchive"), {
    method: "POST",
    body: JSON.stringify({
      actor_id: "mobile_web",
      request_id: requestId("unarchive-thread")
    })
  });
}

export async function uploadSharedThreadImage(
  threadId: string,
  file: File
): Promise<UploadedImageAttachment> {
  const formData = new FormData();
  formData.set("file", file);

  return requestJson<UploadedImageAttachment>(
    buildThreadApiPath(threadId, "/attachments/images"),
    {
      method: "POST",
      body: formData
    }
  );
}
