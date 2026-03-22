import { promises as fs } from "node:fs";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import { Readable } from "node:stream";
import path from "node:path";
import { URL } from "node:url";

import Fastify, { type FastifyInstance, type RouteHandlerMethod } from "fastify";
import type { FastifyReply } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";

import {
  ApplyPatchCommandSchema,
  ApproveCommandSchema,
  ArchiveThreadCommandSchema,
  CodexDiagnosticsSummaryResponseSchema,
  CodexReviewStartResponseSchema,
  CodexThreadSkillsResponseSchema,
  CompactThreadCommandSchema,
  CodexThreadForkResponseSchema,
  DEFAULT_DELIVERY_POLICY,
  DEFAULT_SECURITY_POLICY,
  DiscardPatchCommandSchema,
  InterruptTurnCommandSchema,
  RenameThreadCommandSchema,
  RejectCommandSchema,
  RespondNativeRequestCommandSchema,
  RollbackPatchCommandSchema,
  RollbackPatchResponseSchema,
  RollbackThreadCommandSchema,
  SharedRunRequestBodySchema,
  StartReviewCommandSchema,
  UpdateCodexSharedSettingsBodySchema,
  UploadedImageAttachmentSchema,
  UnarchiveThreadCommandSchema,
  type ApprovalActionResponse,
  type CodexDiagnosticsSummaryResponse,
  type CodexMessage,
  type CodexThreadSkill,
  type CodexThreadSkillsResponse,
  type NativeRequestActionResponse,
  type PatchActionResponse,
  type CodexReviewStartResponse,
  type CodexThread,
  type CodexThreadActionResponse,
  type CodexThreadForkResponse,
  type CommandType,
  type RollbackPatchResponse,
  type StartTurnResponse
} from "@codex-remote/protocol";

import {
  CodexAppServerAdapter,
  type CodexAppServerAdapterOptions
} from "./adapters/codex-app-server-adapter";
import { slugify } from "./lib/path";
import { GatewayStore } from "./lib/store";
import { evaluateTailscaleAccess, type TailscaleAuthConfig } from "./lib/tailscale-auth";
import { nowIso } from "./lib/time";
import {
  CodexCommandBridge,
  type CodexCommandBridgeOptions
} from "./runtime/codex-command-bridge";
import { CodexAttachmentStore } from "./runtime/codex-attachment-store";
import { CodexNativeThreadMarker } from "./runtime/codex-native-thread-marker";
import { CodexSettingsBridge } from "./runtime/codex-settings-bridge";
import { CodexStateBridge } from "./runtime/codex-state-bridge";
import { PolicyEngine } from "./runtime/policy-engine";
import { SessionHub } from "./runtime/session-hub";
import { ThreadRuntimeManager } from "./runtime/thread-runtime-manager";

export interface GatewayRuntime {
  app: FastifyInstance;
  bridge: CodexStateBridge;
  store: GatewayStore;
  manager: ThreadRuntimeManager;
}

export interface CreateGatewayServerOptions {
  databasePath?: string;
  adapterKind?: "codex-app-server";
  codexAdapterOptions?: CodexAppServerAdapterOptions;
  codexCommandBridgeOptions?: CodexCommandBridgeOptions;
  codexHome?: string;
  tailscaleAuth?: TailscaleAuthConfig;
}

const HTTP_ROUTE_PREFIXES = ["", "/api"] as const;
const WS_ROUTE_PATHS = new Set(["/ws", "/api/ws"]);
const PUBLIC_ROUTE_PATHS = new Set(["/health", "/api/health"]);

async function ensureParentDirectory(databasePath: string) {
  if (databasePath === ":memory:") {
    return;
  }

  await fs.mkdir(path.dirname(databasePath), { recursive: true });
}

function getPathname(url: string) {
  return new URL(url, "http://127.0.0.1").pathname;
}

function queryBoolean(value: unknown) {
  if (typeof value !== "string") {
    return false;
  }

  return value === "1" || value.toLowerCase() === "true";
}

function toRequestHeaders(
  headers: IncomingMessage["headers"]
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      next[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      next[key] = value.join(", ");
    }
  }
  return next;
}

async function parseMultipartFileUpload(request: IncomingMessage) {
  const requestInit = {
    method: "POST",
    headers: toRequestHeaders(request.headers),
    body: Readable.toWeb(request) as unknown as BodyInit,
    duplex: "half"
  } as RequestInit & {
    duplex: "half";
  };

  const formData = await new Request("http://127.0.0.1/upload", requestInit).formData();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new Error("missing_file");
  }

  return file;
}

function sendSseEvent(reply: FastifyReply, event: object, streamSeq: number) {
  reply.raw.write(`id: ${streamSeq}\n`);
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

function parseSharedThreadCreateCommand(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid thread payload.");
  }

  const candidate = body as Record<string, unknown>;
  const actorId = typeof candidate.actor_id === "string" ? candidate.actor_id.trim() : "";
  const requestId =
    typeof candidate.request_id === "string" ? candidate.request_id.trim() : "";
  const repoRoot =
    typeof candidate.repo_root === "string" ? candidate.repo_root.trim() : "";
  const prompt =
    typeof candidate.prompt === "string" ? candidate.prompt.trim() : undefined;

  if (!actorId) {
    throw new Error("actor_id is required.");
  }
  if (requestId.length < 8) {
    throw new Error("request_id must be at least 8 characters.");
  }
  if (!repoRoot) {
    throw new Error("repo_root is required.");
  }

  return {
    actor_id: actorId,
    request_id: requestId,
    repo_root: repoRoot,
    prompt
  };
}

function dedupKey(input: {
  actor_id: string;
  request_id: string;
  command_type: CommandType;
}) {
  return {
    actor_id: input.actor_id,
    request_id: input.request_id,
    command_type: input.command_type
  };
}

function projectLabelFromRepoRoot(repoRoot: string) {
  const normalized = repoRoot.split(/[\\/]/).filter(Boolean);
  return normalized.at(-1) ?? repoRoot;
}

function truncateTitle(value: string, max = 96) {
  const normalized = value.trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 3)}...`;
}

function localThreadActionConflict(store: GatewayStore, threadId: string) {
  const thread = store.getThread(threadId);
  if (!thread) {
    return null;
  }

  const pendingApprovals = store
    .listApprovals(threadId)
    .filter((approval) => approval.status === "requested").length;
  if (pendingApprovals > 0) {
    return "approval_required";
  }

  const pendingNativeRequests = store
    .listNativeRequests(threadId)
    .filter((nativeRequest) => nativeRequest.status === "requested").length;
  if (pendingNativeRequests > 0) {
    return "input_required";
  }

  const pendingPatches = store
    .listPatches(threadId)
    .filter((patch) => patch.status !== "applied" && patch.status !== "discarded").length;
  if (pendingPatches > 0) {
    return "patch_review_required";
  }

  if (
    thread.active_turn_id &&
    (thread.state === "running" || thread.state === "waiting_approval")
  ) {
    return "active_run_in_progress";
  }

  return null;
}

function fallbackThreadFromStore(store: GatewayStore, threadId: string): CodexThread | null {
  const thread = store.getThread(threadId) ?? store.findThreadByAdapterRef(threadId);
  if (!thread) {
    return null;
  }

  const project = store.getProject(thread.project_id);
  if (!project) {
    return null;
  }

  const turns = store.listTurns(thread.thread_id);
  const pendingApprovals = store
    .listApprovals(thread.thread_id)
    .filter((approval) => approval.status === "requested");
  const pendingNativeRequests = store
    .listNativeRequests(thread.thread_id)
    .filter((nativeRequest) => nativeRequest.status === "requested");
  const pendingPatches = store
    .listPatches(thread.thread_id)
    .filter((patch) => patch.status !== "applied" && patch.status !== "discarded");

  let state: CodexThread["state"] = "ready";
  if (thread.state === "archived" || thread.native_archived) {
    state = "archived";
  } else if (thread.state === "failed") {
    state = "failed";
  } else if (thread.state === "interrupted") {
    state = "interrupted";
  } else if (pendingNativeRequests.length > 0) {
    state = "waiting_input";
  } else if (pendingApprovals.length > 0) {
    state = "waiting_approval";
  } else if (pendingPatches.length > 0) {
    state = "needs_review";
  } else if (thread.active_turn_id || thread.state === "running") {
    state = "running";
  } else if (thread.state === "completed") {
    state = "completed";
  }

  return {
    thread_id: thread.thread_id,
    project_id: thread.project_id,
    title: truncateTitle(thread.native_title ?? turns.at(0)?.prompt ?? thread.thread_id),
    project_label: projectLabelFromRepoRoot(project.repo_root),
    repo_root: project.repo_root,
    source: thread.adapter_kind,
    state,
    archived: Boolean(thread.native_archived || thread.state === "archived"),
    has_active_run: Boolean(thread.active_turn_id),
    pending_approvals: pendingApprovals.length,
    pending_patches: pendingPatches.length,
    pending_native_requests: pendingNativeRequests.length,
    worktree_path: thread.worktree_path,
    active_turn_id: thread.active_turn_id,
    last_stream_seq: thread.last_stream_seq,
    sync_state: thread.active_turn_id ? "sync_pending" : "sync_failed",
    adapter_thread_ref: thread.adapter_thread_ref,
    native_status_type: thread.native_status_type,
    native_active_flags: thread.native_active_flags,
    native_token_usage: thread.native_token_usage,
    created_at: thread.created_at ?? thread.updated_at,
    updated_at: thread.updated_at
  };
}

function buildFallbackTimeline(store: GatewayStore, threadId: string) {
  const thread = fallbackThreadFromStore(store, threadId);
  if (!thread) {
    return null;
  }

  const turns = store.listTurns(thread.thread_id);
  const approvals = store.listApprovals(thread.thread_id);
  const nativeRequests = store.listNativeRequests(thread.thread_id);
  const patches = store.listPatches(thread.thread_id);
  const events = store.listEvents(thread.thread_id, 0, 2_000);

  const items = [
    ...turns.map((turn) => ({
      item_id: `turn-${turn.turn_id}`,
      thread_id: thread.thread_id,
      timestamp: turn.created_at,
      origin: "gateway_fallback" as const,
      kind: "user_message" as const,
      title: "You",
      body: turn.prompt,
      turn_id: turn.turn_id,
      action_required: false,
      mono: false
    })),
    ...events.map((event) => ({
      item_id: event.event_id ?? `event-${event.stream_seq}`,
      thread_id: thread.thread_id,
      timestamp: event.timestamp ?? thread.updated_at,
      origin: "gateway_fallback" as const,
      kind:
        event.event_type === "turn.progress"
          ? ("assistant_message" as const)
          : ("status" as const),
      title:
        typeof event.payload.step === "string"
          ? String(event.payload.step)
          : String(event.event_type),
      body:
        typeof event.payload.message === "string"
          ? String(event.payload.message)
          : typeof event.payload.summary === "string"
            ? String(event.payload.summary)
            : undefined,
      turn_id: event.turn_id,
      action_required: false,
      mono: false
    })),
    ...approvals.map((approval) => ({
      item_id: `approval-${approval.approval_id}`,
      thread_id: thread.thread_id,
      timestamp: approval.resolved_at ?? approval.requested_at,
      origin: "gateway_fallback" as const,
      kind: "approval" as const,
      title:
        approval.status === "requested"
          ? "Waiting for approval"
          : `Approval ${approval.status}`,
      body: approval.reason,
      status: approval.status,
      turn_id: approval.turn_id,
      approval_id: approval.approval_id,
      action_required: approval.status === "requested",
      mono: false
    })),
    ...patches.map((patch) => ({
      item_id: `patch-${patch.patch_id}`,
      thread_id: thread.thread_id,
      timestamp: patch.updated_at,
      origin: "gateway_fallback" as const,
      kind: "patch" as const,
      title: patch.summary,
      body: patch.files.map((file) => file.path).join(", "),
      status: patch.status,
      turn_id: patch.turn_id,
      patch_id: patch.patch_id,
      action_required: patch.status !== "applied" && patch.status !== "discarded",
      mono: false
    }))
  ].sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  return {
    thread,
    items,
    approvals,
    patches,
    native_requests: nativeRequests
  };
}

function buildFallbackTranscript(
  store: GatewayStore,
  threadId: string,
  input: {
    cursor?: string;
    limit?: number;
  } = {}
) {
  const timeline = buildFallbackTimeline(store, threadId);
  if (!timeline) {
    return null;
  }

  const messages: CodexMessage[] = timeline.items.map((item) => ({
    message_id: item.item_id,
    thread_id: item.thread_id,
    timestamp: item.timestamp,
    role:
      item.kind === "user_message"
        ? "user"
        : item.kind === "assistant_message"
          ? "assistant"
          : "system_action",
    body: item.body,
    title: item.title,
    turn_id: item.turn_id,
    origin: item.origin,
    status: "status" in item ? item.status : undefined,
    approval_id: "approval_id" in item ? item.approval_id : undefined,
    patch_id: "patch_id" in item ? item.patch_id : undefined,
    action_required: item.action_required,
    details: []
  }));

  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const endIndex =
    typeof input.cursor === "string"
      ? Math.max(
          0,
          messages.findIndex((message) => message.message_id === input.cursor)
        )
      : messages.length;
  const startIndex = Math.max(0, endIndex - limit);
  const pageItems = messages.slice(startIndex, endIndex === -1 ? messages.length : endIndex);
  const hasMore = startIndex > 0;

  return {
    thread: timeline.thread,
    items: pageItems,
    approvals: timeline.approvals.filter((approval) => approval.source === "native"),
    patches: timeline.patches,
    native_requests: timeline.native_requests,
    live_state: store.getLiveState(timeline.thread.thread_id),
    next_cursor: hasMore ? messages[startIndex].message_id : undefined,
    has_more: hasMore
  };
}

function sendForbidden(
  reply: FastifyReply,
  decision: ReturnType<typeof evaluateTailscaleAccess>
) {
  reply.code(403).send({
    error: decision.code ?? "forbidden",
    message: decision.message ?? "Access denied."
  });
}

function routeErrorStatus(message: string) {
  if (
    message === "unknown_approval" ||
    message === "unknown_patch" ||
    message === "unknown_native_request" ||
    message === "unknown_thread"
  ) {
    return 404;
  }

  if (
    message === "native_approval_unrecoverable" ||
    message === "approval_not_pending" ||
    message === "approval_expired" ||
    message === "approval_confirmation_required" ||
    message === "approval_decision_not_allowed" ||
    message === "native_request_not_pending" ||
    message === "native_request_unrecoverable" ||
    message === "patch_not_pending"
  ) {
    return 409;
  }

  return 400;
}

export async function createGatewayServer(
  options: CreateGatewayServerOptions = {}
): Promise<GatewayRuntime> {
  const databasePath =
    options.databasePath ??
    path.join(process.cwd(), ".codex-remote", "gateway.sqlite");
  await ensureParentDirectory(databasePath);

  const store = await GatewayStore.open(databasePath);
  const sessionHub = new SessionHub();
  const policyEngine = new PolicyEngine(DEFAULT_SECURITY_POLICY);
  const resolvedCodexHome =
    options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const commandBridge = new CodexCommandBridge({
    codexHome: resolvedCodexHome,
    ...options.codexCommandBridgeOptions
  });
  const attachmentStore = new CodexAttachmentStore({
    codexHome: resolvedCodexHome
  });
  const nativeThreadMarker = new CodexNativeThreadMarker({
    codexHome: resolvedCodexHome
  });
  const settingsBridge = new CodexSettingsBridge({
    codexHome: resolvedCodexHome,
    commandBridge
  });
  const codexAdapter = new CodexAppServerAdapter({
    codexHome: resolvedCodexHome,
    attachmentStore,
    settingsBridge,
    ...options.codexAdapterOptions
  });
  const configuredAdapterKind = options.adapterKind ?? "codex-app-server";
  let bridge!: CodexStateBridge;
  const manager = new ThreadRuntimeManager({
    store,
    sessionHub,
    adapter: codexAdapter,
    policyEngine,
    commandBridge,
    syncThreadNow: async (threadId) => {
      await bridge.syncThreadNow(threadId);
    },
    nativeThreadMarker
  });
  manager.startBackgroundWorkers();
  bridge = new CodexStateBridge({
    store,
    adapterKind: configuredAdapterKind,
    codexHome: resolvedCodexHome,
    hasApprovalBinding: (approvalId) => manager.hasLiveApprovalBinding(approvalId),
    sessionHub,
    settingsBridge,
    isTurnActive: (turnId) => manager.hasActiveExecution(turnId)
  });
  await bridge.start();

  const tailscaleAuth = options.tailscaleAuth ?? {
    mode: "off" as const,
    allowedUserLogins: []
  };

  const app = Fastify({
    logger: false
  });
  app.addContentTypeParser(/^multipart\/form-data/i, (_request, payload, done) => {
    done(null, payload);
  });

  const registerGet = (routePath: string, handler: RouteHandlerMethod) => {
    for (const prefix of HTTP_ROUTE_PREFIXES) {
      app.get(`${prefix}${routePath}`, handler);
    }
  };

  const registerPost = (routePath: string, handler: RouteHandlerMethod) => {
    for (const prefix of HTTP_ROUTE_PREFIXES) {
      app.post(`${prefix}${routePath}`, handler);
    }
  };

  const registerPatch = (routePath: string, handler: RouteHandlerMethod) => {
    for (const prefix of HTTP_ROUTE_PREFIXES) {
      app.patch(`${prefix}${routePath}`, handler);
    }
  };

  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Headers", "content-type,last-event-id");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");

    if (request.method === "OPTIONS") {
      reply.code(204).send();
      return;
    }

    const pathname = getPathname(request.url);
    if (!PUBLIC_ROUTE_PATHS.has(pathname)) {
      const decision = evaluateTailscaleAccess({
        config: tailscaleAuth,
        headers: {
          host: request.headers.host,
          "tailscale-user-login": request.headers["tailscale-user-login"]
        }
      });

      if (!decision.allowed) {
        sendForbidden(reply, decision);
        return;
      }
    }
  });

  registerGet("/health", async () => ({
    ok: true,
    adapter: configuredAdapterKind
  }));

  registerGet("/config", async () => ({
    schema_version: "1.0.0",
    delivery_policy: DEFAULT_DELIVERY_POLICY,
    security_policy: DEFAULT_SECURITY_POLICY
  }));

  registerGet("/overview", async (request) => {
    const query = request.query as { include_archived?: string } | undefined;
    return bridge.getOverview({
      includeArchived: queryBoolean(query?.include_archived)
    });
  });

  registerGet("/queue", async () => ({
    entries: await bridge.getQueue()
  }));

  registerGet("/capabilities", async () => bridge.getCapabilities());

  registerGet("/settings/shared", async (_request, reply) => {
    try {
      return await settingsBridge.getSettings();
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  registerPatch("/settings/shared", async (request, reply) => {
    try {
      const input = UpdateCodexSharedSettingsBodySchema.parse(request.body ?? {});
      return await settingsBridge.updateSettings(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(message === "settings_conflict" ? 409 : 400);
      return {
        error: message
      };
    }
  });

  registerGet("/diagnostics/summary", async (_request, reply) => {
    try {
      const response: CodexDiagnosticsSummaryResponse =
        CodexDiagnosticsSummaryResponseSchema.parse(
          await settingsBridge.getDiagnosticsSummary()
        );
      return response;
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  registerGet("/threads/:threadId/timeline", async (request, reply) => {
    const threadId = (request.params as { threadId: string }).threadId;
    const timeline = (await bridge.getTimeline(threadId)) ?? buildFallbackTimeline(store, threadId);
    if (!timeline) {
      reply.code(404);
      return {
        error: "not_found"
      };
    }
    return timeline;
  });

  registerGet("/threads/:threadId/skills", async (request, reply) => {
    try {
      const { threadId } = request.params as { threadId: string };
      const thread =
        (await bridge.getThread(threadId)) ?? fallbackThreadFromStore(store, threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      const skills = await commandBridge.listSkills({
        cwd: thread.repo_root,
        forceReload: false
      });
      const threadSkills: CodexThreadSkill[] = [];
      for (const skill of skills) {
        if (typeof skill.name !== "string" || typeof skill.path !== "string") {
          continue;
        }

        threadSkills.push({
          name: skill.name,
          description:
            typeof skill.description === "string"
              ? skill.description
              : typeof skill.shortDescription === "string"
                ? skill.shortDescription
                : skill.name,
          short_description:
            typeof skill.shortDescription === "string"
              ? skill.shortDescription
              : undefined,
          display_name:
            typeof skill.displayName === "string" ? skill.displayName : undefined,
          path: skill.path
        });
      }

      const response: CodexThreadSkillsResponse = CodexThreadSkillsResponseSchema.parse({
        cwd: thread.repo_root,
        skills: threadSkills,
        errors: []
      });
      return response;
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  registerPost("/threads/:threadId/attachments/images", async (request, reply) => {
    try {
      const { threadId } = request.params as { threadId: string };
      const thread =
        (await bridge.getThread(threadId)) ?? fallbackThreadFromStore(store, threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      const file = await parseMultipartFileUpload(request.raw);
      if (!file.type.startsWith("image/")) {
        reply.code(400);
        return {
          error: "invalid_image_type"
        };
      }

      const uploaded = await attachmentStore.saveImage({
        threadId: thread.thread_id,
        fileName: file.name || `image-${nowIso()}.bin`,
        contentType: file.type || "application/octet-stream",
        bytes: new Uint8Array(await file.arrayBuffer())
      });
      return UploadedImageAttachmentSchema.parse(uploaded);
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  registerGet("/threads/:threadId/messages/latest", async (request, reply) => {
    const threadId = (request.params as { threadId: string }).threadId;
    const query = request.query as { limit?: string };
    const transcript =
      (await bridge.getTranscriptPage({
        threadId,
        limit: Number(query.limit ?? 20)
      })) ?? buildFallbackTranscript(store, threadId, { limit: Number(query.limit ?? 20) });
    if (!transcript) {
      reply.code(404);
      return {
        error: "not_found"
      };
    }
    return transcript;
  });

  registerGet("/threads/:threadId/messages", async (request, reply) => {
    const threadId = (request.params as { threadId: string }).threadId;
    const query = request.query as { cursor?: string; limit?: string };
    const transcript =
      (await bridge.getTranscriptPage({
        threadId,
        cursor: typeof query.cursor === "string" ? query.cursor : undefined,
        limit: Number(query.limit ?? 20)
      })) ??
      buildFallbackTranscript(store, threadId, {
        cursor: typeof query.cursor === "string" ? query.cursor : undefined,
        limit: Number(query.limit ?? 20)
      });
    if (!transcript) {
      reply.code(404);
      return {
        error: "not_found"
      };
    }
    return transcript;
  });

  registerGet("/threads/:threadId/events", async (request, reply) => {
    const threadId = (request.params as { threadId: string }).threadId;
    const query = request.query as { after_seq?: string; limit?: string };
    const thread = store.getThread(threadId) ?? store.findThreadByAdapterRef(threadId);
    if (!thread) {
      reply.code(404);
      return {
        error: "not_found"
      };
    }

    return {
      events: store.listEvents(
        thread.thread_id,
        Number(query.after_seq ?? 0),
        Number(query.limit ?? 500)
      )
    };
  });

  registerGet("/events", async (request, reply) => {
    const query = request.query as {
      thread_id?: string;
      last_seen_seq?: string;
    };
    const threadId = query.thread_id;
    const thread = threadId
      ? store.getThread(threadId) ?? store.findThreadByAdapterRef(threadId)
      : null;
    if (!thread) {
      reply.code(404);
      return {
        error: "unknown_thread"
      };
    }

    const lastEventId = request.headers["last-event-id"];
    const afterSeq = Math.max(
      0,
      Number(query.last_seen_seq ?? lastEventId ?? 0) || 0
    );

    reply.hijack();
    reply.raw.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream"
    });

    for (const event of store.listEvents(thread.thread_id, afterSeq)) {
      sendSseEvent(reply, event, event.stream_seq);
    }

    const unsubscribe = sessionHub.subscribe(thread.thread_id, (event) => {
      sendSseEvent(reply, event, event.stream_seq);
    });
    const heartbeat = setInterval(() => {
      reply.raw.write(`: heartbeat ${Date.now()}\n\n`);
    }, DEFAULT_DELIVERY_POLICY.heartbeat_seconds * 1_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });

  registerGet("/metrics", async () => {
    const threads = store.listThreads();
    const approvals = threads.flatMap((thread) => store.listApprovals(thread.thread_id));
    const restartCount = store
      .listAuditLogs()
      .filter((log) => log.message === "app_server_startup_retry").length;

    return {
      active_threads: store.getCapacity().active_threads,
      queued_threads: store.getCapacity().queued_threads,
      adapter_restarts: restartCount,
      turn_duration_ms: 0,
      approval_wait_ms: approvals
        .filter((approval) => approval.resolved_at)
        .reduce((total, approval) => {
          return total + (Date.parse(approval.resolved_at!) - Date.parse(approval.requested_at));
        }, 0),
      reconnect_resume_success_rate: 1
    };
  });

  registerPost("/threads/shared", async (request, reply) => {
    try {
      const input = parseSharedThreadCreateCommand(request.body);
      const projectId = `project_${slugify(input.repo_root)}`;
      const timestamp = new Date().toISOString();
      const project = store.saveProject({
        project_id: projectId,
        repo_root: input.repo_root,
        created_at: timestamp,
        updated_at: timestamp
      });
      const sharedThread = await commandBridge.startSharedThread({
        repoRoot: input.repo_root
      });
      const initialThread = store.saveThread({
        project_id: project.project_id,
        thread_id: sharedThread.thread_id,
        state: "ready",
        active_turn_id: null,
        pending_turn_ids: [],
        pending_approval_ids: [],
        worktree_path: input.repo_root,
        adapter_kind: "codex-app-server",
        adapter_thread_ref: sharedThread.thread_id,
        last_stream_seq: 0,
        created_at: timestamp,
        updated_at: timestamp
      });

      if (input.prompt) {
        const started = await manager.startTurn({
          actor_id: input.actor_id,
          request_id: input.request_id,
          prompt: input.prompt,
          thread_id: initialThread.thread_id,
          command_type: "turns.start"
        });

        return {
          deduplicated: false,
          project,
          thread: started.thread,
          turn: started.turn
        };
      }

      return {
        deduplicated: false,
        project,
        thread: initialThread
      };
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  registerPost("/threads/:threadId/runs", async (request, reply) => {
    try {
      await bridge.syncStore();
      const body = SharedRunRequestBodySchema.parse(request.body ?? {});
      const { threadId } = request.params as { threadId: string };
      const codexThread =
        (await bridge.getThread(threadId)) ?? fallbackThreadFromStore(store, threadId);
      if (!codexThread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      if (codexThread.archived) {
        reply.code(409);
        return {
          error: "archived_thread"
        };
      }

      const conflict = localThreadActionConflict(store, codexThread.thread_id);
      if (conflict) {
        reply.code(409);
        return {
          error: conflict
        };
      }

      return await manager.startTurn({
        actor_id: body.actor_id,
        request_id: body.request_id,
        prompt: body.prompt,
        input_items: body.input_items,
        collaboration_mode: body.collaboration_mode,
        thread_id: codexThread.thread_id,
        command_type: "turns.start"
      });
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  registerPost("/runs/:runId/follow-ups", async (request, reply) => {
    try {
      await bridge.syncStore();
      const body = SharedRunRequestBodySchema.parse(request.body ?? {});
      const { runId } = request.params as { runId: string };
      const run = store.getTurn(runId);
      if (!run) {
        reply.code(404);
        return {
          error: "unknown_run"
        };
      }

      const capabilities = await bridge.getCapabilities();
      const liveTurn =
        run.state === "started" ||
        run.state === "streaming" ||
        run.state === "resumed" ||
        run.state === "waiting_approval";

      if (liveTurn && !capabilities.live_follow_up) {
        reply.code(409);
        return {
          error: capabilities.reason ?? "live_follow_up_unavailable"
        };
      }

      if (liveTurn && capabilities.live_follow_up) {
        if (body.collaboration_mode === "plan") {
          reply.code(409);
          return {
            error: "collaboration_mode_requires_new_turn"
          };
        }

        const thread = store.getThread(run.thread_id);
        const remoteThreadId = thread?.adapter_thread_ref ?? run.thread_id;
        await commandBridge.steerSharedTurn({
          threadId: remoteThreadId,
          turnId: run.turn_id,
          prompt: body.prompt
        });
        return {
          deduplicated: false,
          thread,
          turn: run
        };
      }

      return await manager.startTurn({
        actor_id: body.actor_id,
        request_id: body.request_id,
        prompt: body.prompt,
        input_items: body.input_items,
        collaboration_mode: body.collaboration_mode,
        thread_id: run.thread_id,
        command_type: "turns.start"
      });
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  registerPost("/runs/:runId/interrupt", async (request, reply) => {
    try {
      const capabilities = await bridge.getCapabilities();
      if (!capabilities.interrupt) {
        reply.code(409);
        return {
          error: capabilities.reason ?? "interrupt_unavailable"
        };
      }

      const { runId } = request.params as { runId: string };
      const turn = store.getTurn(runId);
      if (!turn) {
        reply.code(404);
        return {
          error: "unknown_run"
        };
      }

      const command = InterruptTurnCommandSchema.parse({
        ...(request.body as Record<string, unknown>),
        thread_id: turn.thread_id,
        turn_id: runId,
        command_type: "turns.interrupt"
      });
      const existing = store.getCommandResult<CodexThreadActionResponse>(dedupKey(command));
      if (existing) {
        return {
          ...existing,
          deduplicated: true
        };
      }

      const thread = store.getThread(turn.thread_id);
      const remoteThreadId = thread?.adapter_thread_ref ?? turn.thread_id;
      await commandBridge.interruptSharedTurn({
        threadId: remoteThreadId,
        turnId: turn.turn_id
      });
      store.saveTurn({
        ...turn,
        state: "interrupted",
        updated_at: new Date().toISOString()
      });
      if (thread) {
        store.saveThread({
          ...thread,
          active_turn_id: null,
          state: "interrupted",
          updated_at: new Date().toISOString()
        });
      }
      if (thread) {
        await bridge.syncThreadNow(thread.thread_id);
      }

      const updatedThread =
        (thread && ((await bridge.getThread(thread.thread_id)) ?? fallbackThreadFromStore(store, thread.thread_id))) ||
        null;
      if (!updatedThread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      const response: CodexThreadActionResponse = {
        deduplicated: false,
        thread: updatedThread
      };
      store.saveCommandResult(dedupKey(command), response);
      return response;
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  registerPost("/approvals/:approvalId/approve", async (request, reply) => {
    try {
      const { approvalId } = request.params as { approvalId: string };
      const command = ApproveCommandSchema.parse({
        ...(request.body as Record<string, unknown>),
        approval_id: approvalId,
        command_type: "approvals.approve"
      });
      const existing = store.getCommandResult<ApprovalActionResponse>(dedupKey(command));
      if (existing) {
        return {
          ...existing,
          deduplicated: true
        };
      }

      const result = await manager.resolveApproval(command);
      const response: ApprovalActionResponse = {
        deduplicated: false,
        approval: {
          approval_id: result.approval.approval_id,
          status: result.approval.status
        },
        thread: result.thread
      };
      store.saveCommandResult(dedupKey(command), response);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(routeErrorStatus(message));
      return {
        error: message
      };
    }
  });

  registerPost("/approvals/:approvalId/reject", async (request, reply) => {
    try {
      const { approvalId } = request.params as { approvalId: string };
      const command = RejectCommandSchema.parse({
        ...(request.body as Record<string, unknown>),
        approval_id: approvalId,
        command_type: "approvals.reject"
      });
      const existing = store.getCommandResult<ApprovalActionResponse>(dedupKey(command));
      if (existing) {
        return {
          ...existing,
          deduplicated: true
        };
      }

      const result = await manager.resolveApproval(command);
      const response: ApprovalActionResponse = {
        deduplicated: false,
        approval: {
          approval_id: result.approval.approval_id,
          status: result.approval.status
        },
        thread: result.thread
      };
      store.saveCommandResult(dedupKey(command), response);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(routeErrorStatus(message));
      return {
        error: message
      };
    }
  });

  registerPost("/patches/:patchId/apply", async (request, reply) => {
    try {
      const { patchId } = request.params as { patchId: string };
      const command = ApplyPatchCommandSchema.parse({
        ...(request.body as Record<string, unknown>),
        patch_id: patchId,
        command_type: "patches.apply"
      });
      const existing = store.getCommandResult<PatchActionResponse>(dedupKey(command));
      if (existing) {
        return {
          ...existing,
          deduplicated: true
        };
      }

      const result = await manager.resolvePatch(command);
      const response: PatchActionResponse = {
        deduplicated: false,
        patch: result.patch,
        thread: result.thread
      };
      store.saveCommandResult(dedupKey(command), response);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(routeErrorStatus(message));
      return {
        error: message
      };
    }
  });

  registerPost("/patches/:patchId/discard", async (request, reply) => {
    try {
      const { patchId } = request.params as { patchId: string };
      const command = DiscardPatchCommandSchema.parse({
        ...(request.body as Record<string, unknown>),
        patch_id: patchId,
        command_type: "patches.discard"
      });
      const existing = store.getCommandResult<PatchActionResponse>(dedupKey(command));
      if (existing) {
        return {
          ...existing,
          deduplicated: true
        };
      }

      const result = await manager.resolvePatch(command);
      const response: PatchActionResponse = {
        deduplicated: false,
        patch: result.patch,
        thread: result.thread
      };
      store.saveCommandResult(dedupKey(command), response);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(routeErrorStatus(message));
      return {
        error: message
      };
    }
  });

  registerPost("/patches/:patchId/rollback", async (request, reply) => {
    try {
      const { patchId } = request.params as { patchId: string };
      const command = RollbackPatchCommandSchema.parse({
        ...(request.body as Record<string, unknown>),
        patch_id: patchId,
        command_type: "patches.rollback"
      });
      const existing = store.getCommandResult<RollbackPatchResponse>(dedupKey(command));
      if (existing) {
        return {
          ...existing,
          deduplicated: true
        };
      }

      const response = RollbackPatchResponseSchema.parse(
        await manager.rollbackPatch(command)
      );
      store.saveCommandResult(dedupKey(command), response);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(routeErrorStatus(message));
      return {
        error: message
      };
    }
  });

  const respondNativeRequestHandler: RouteHandlerMethod = async (request, reply) => {
    try {
      const { nativeRequestId } = request.params as { nativeRequestId: string };
      const command = RespondNativeRequestCommandSchema.parse({
        ...(request.body as Record<string, unknown>),
        native_request_id: nativeRequestId,
        command_type: "native_requests.respond"
      });
      const existing = store.getCommandResult<NativeRequestActionResponse>(dedupKey(command));
      if (existing) {
        return {
          ...existing,
          deduplicated: true
        };
      }

      const result = await manager.resolveNativeRequest(command);
      const response: NativeRequestActionResponse = {
        deduplicated: false,
        native_request: result.native_request,
        thread: result.thread
      };
      store.saveCommandResult(dedupKey(command), response);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(routeErrorStatus(message));
      return {
        error: message
      };
    }
  };

  registerPost("/native-requests/:nativeRequestId/respond", respondNativeRequestHandler);
  registerPost("/native_requests/:nativeRequestId/respond", respondNativeRequestHandler);

  registerPost("/threads/:threadId/name", async (request, reply) => {
    try {
      const { threadId } = request.params as { threadId: string };
      const command = RenameThreadCommandSchema.parse({
        ...(request.body as Record<string, unknown>),
        thread_id: threadId,
        command_type: "threads.rename"
      });
      const existing = store.getCommandResult<CodexThreadActionResponse>(dedupKey(command));
      if (existing) {
        return {
          ...existing,
          deduplicated: true
        };
      }

      const thread =
        (await bridge.getThread(threadId)) ?? fallbackThreadFromStore(store, threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      if (thread.title !== command.name) {
        await commandBridge.renameSharedThread({
          threadId: thread.adapter_thread_ref ?? thread.thread_id,
          name: command.name
        });
        await bridge.syncThreadNow(thread.thread_id);
      }

      const updatedThread =
        (await bridge.getThread(thread.thread_id)) ??
        ({
          ...thread,
          title: command.name
        } as CodexThread);
      const response: CodexThreadActionResponse = {
        deduplicated: false,
        thread: updatedThread
      };
      store.saveCommandResult(dedupKey(command), response);
      return response;
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  registerPost("/threads/:threadId/archive", async (request, reply) => {
    try {
      const { threadId } = request.params as { threadId: string };
      const command = ArchiveThreadCommandSchema.parse({
        ...(request.body as Record<string, unknown>),
        thread_id: threadId,
        command_type: "threads.archive"
      });
      const existing = store.getCommandResult<CodexThreadActionResponse>(dedupKey(command));
      if (existing) {
        return {
          ...existing,
          deduplicated: true
        };
      }

      const thread =
        (await bridge.getThread(threadId)) ?? fallbackThreadFromStore(store, threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      await commandBridge.archiveSharedThread({
        threadId: thread.adapter_thread_ref ?? thread.thread_id
      });
      await bridge.syncThreadNow(thread.thread_id);

      const updatedThread =
        (await bridge.getThread(thread.thread_id)) ??
        ({
          ...thread,
          archived: true,
          state: "archived"
        } as CodexThread);
      const response: CodexThreadActionResponse = {
        deduplicated: false,
        thread: updatedThread
      };
      store.saveCommandResult(dedupKey(command), response);
      return response;
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  registerPost("/threads/:threadId/unarchive", async (request, reply) => {
    try {
      const { threadId } = request.params as { threadId: string };
      const command = UnarchiveThreadCommandSchema.parse({
        ...(request.body as Record<string, unknown>),
        thread_id: threadId,
        command_type: "threads.unarchive"
      });
      const existing = store.getCommandResult<CodexThreadActionResponse>(dedupKey(command));
      if (existing) {
        return {
          ...existing,
          deduplicated: true
        };
      }

      const thread =
        (await bridge.getThread(threadId)) ?? fallbackThreadFromStore(store, threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      await commandBridge.unarchiveSharedThread({
        threadId: thread.adapter_thread_ref ?? thread.thread_id
      });
      await bridge.syncThreadNow(thread.thread_id);

      const updatedThread =
        (await bridge.getThread(thread.thread_id)) ??
        ({
          ...thread,
          archived: false,
          state: "ready"
        } as CodexThread);
      const response: CodexThreadActionResponse = {
        deduplicated: false,
        thread: updatedThread
      };
      store.saveCommandResult(dedupKey(command), response);
      return response;
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  registerPost("/threads/:threadId/compact", async (request, reply) => {
    try {
      const { threadId } = request.params as { threadId: string };
      const command = CompactThreadCommandSchema.parse({
        ...(request.body as Record<string, unknown>),
        thread_id: threadId,
        command_type: "threads.compact"
      });
      const existing = store.getCommandResult<CodexThreadActionResponse>(dedupKey(command));
      if (existing) {
        return {
          ...existing,
          deduplicated: true
        };
      }

      const thread =
        (await bridge.getThread(threadId)) ?? fallbackThreadFromStore(store, threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      await commandBridge.compactSharedThread({
        threadId: thread.adapter_thread_ref ?? thread.thread_id
      });
      await bridge.syncThreadNow(thread.thread_id);

      const updatedThread = (await bridge.getThread(thread.thread_id)) ?? thread;
      const response: CodexThreadActionResponse = {
        deduplicated: false,
        thread: updatedThread
      };
      store.saveCommandResult(dedupKey(command), response);
      return response;
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  registerPost("/threads/:threadId/fork", async (request, reply) => {
    try {
      const { threadId } = request.params as { threadId: string };
      const command = {
        actor_id: typeof (request.body as Record<string, unknown> | undefined)?.actor_id === "string"
          ? String((request.body as Record<string, unknown>).actor_id)
          : "unknown",
        request_id: typeof (request.body as Record<string, unknown> | undefined)?.request_id === "string"
          ? String((request.body as Record<string, unknown>).request_id)
          : createFallbackRequestId(),
        thread_id: threadId,
        command_type: "threads.fork" as const
      };
      const existing = store.getCommandResult<CodexThreadForkResponse>(dedupKey(command));
      if (existing) {
        return {
          ...existing,
          deduplicated: true
        };
      }

      const thread =
        (await bridge.getThread(threadId)) ?? fallbackThreadFromStore(store, threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      const forked = await commandBridge.forkSharedThread({
        threadId: thread.adapter_thread_ref ?? thread.thread_id
      });
      let forkedThread: CodexThread | null = null;
      try {
        await bridge.syncThreadNow(forked.thread_id);
        forkedThread = (await bridge.getThread(forked.thread_id)) ?? null;
      } catch {
        forkedThread = null;
      }

      if (!forkedThread) {
        const now = new Date().toISOString();
        forkedThread = {
          ...thread,
          thread_id: forked.thread_id,
          title: `${thread.title} (fork)`,
          archived: false,
          has_active_run: false,
          pending_approvals: 0,
          pending_patches: 0,
          pending_native_requests: 0,
          active_turn_id: null,
          sync_state: "sync_pending",
          created_at: now,
          updated_at: now
        };
      }

      const response: CodexThreadForkResponse = {
        deduplicated: false,
        thread: forkedThread
      };
      store.saveCommandResult(dedupKey(command), response);
      return CodexThreadForkResponseSchema.parse(response);
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  registerPost("/threads/:threadId/rollback", async (request, reply) => {
    try {
      const { threadId } = request.params as { threadId: string };
      const command = RollbackThreadCommandSchema.parse({
        ...(request.body as Record<string, unknown>),
        thread_id: threadId,
        command_type: "threads.rollback"
      });
      const existing = store.getCommandResult<CodexThreadActionResponse>(dedupKey(command));
      if (existing) {
        return {
          ...existing,
          deduplicated: true
        };
      }

      const thread =
        (await bridge.getThread(threadId)) ?? fallbackThreadFromStore(store, threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      await commandBridge.rollbackSharedThread({
        threadId: thread.adapter_thread_ref ?? thread.thread_id,
        numTurns: command.num_turns
      });
      await bridge.syncThreadNow(thread.thread_id);

      const updatedThread = (await bridge.getThread(thread.thread_id)) ?? thread;
      const response: CodexThreadActionResponse = {
        deduplicated: false,
        thread: updatedThread
      };
      store.saveCommandResult(dedupKey(command), response);
      return response;
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  registerPost("/threads/:threadId/reviews", async (request, reply) => {
    try {
      const { threadId } = request.params as { threadId: string };
      const command = StartReviewCommandSchema.parse({
        ...(request.body as Record<string, unknown>),
        thread_id: threadId,
        command_type: "reviews.start"
      });
      const existing = store.getCommandResult<CodexReviewStartResponse>(dedupKey(command));
      if (existing) {
        return {
          ...existing,
          deduplicated: true
        };
      }

      const thread =
        (await bridge.getThread(threadId)) ?? fallbackThreadFromStore(store, threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      const started = await commandBridge.startReview({
        threadId: thread.adapter_thread_ref ?? thread.thread_id,
        target: command.target,
        delivery: command.delivery ?? "detached"
      });
      await bridge.syncThreadNow(started.review_thread_id);

      const response: CodexReviewStartResponse = {
        deduplicated: false,
        review_thread_id: started.review_thread_id,
        review_turn_id: started.review_turn_id
      };
      store.saveCommandResult(dedupKey(command), response);
      return CodexReviewStartResponseSchema.parse(response);
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  const wsServer = new WebSocketServer({
    noServer: true
  });

  wsServer.on(
    "connection",
    (
      socket: WebSocket,
      _request: IncomingMessage,
      params: { afterSeq: string; threadId: string }
    ) => {
      const thread =
        store.getThread(params.threadId) ?? store.findThreadByAdapterRef(params.threadId);
      if (!thread) {
        socket.close();
        return;
      }

      const afterSeq = Math.max(0, Number(params.afterSeq ?? 0) || 0);
      for (const event of store.listEvents(thread.thread_id, afterSeq)) {
        socket.send(JSON.stringify(event));
      }

      const unsubscribe = sessionHub.subscribe(thread.thread_id, (event) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(event));
        }
      });
      const heartbeat = setInterval(() => {
        if (socket.readyState === socket.OPEN) {
          socket.ping();
        }
      }, DEFAULT_DELIVERY_POLICY.heartbeat_seconds * 1_000);

      socket.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    }
  );

  app.server.on("upgrade", (request, socket, head) => {
    const decision = evaluateTailscaleAccess({
      config: tailscaleAuth,
      headers: request.headers
    });
    if (!decision.allowed) {
      socket.destroy();
      return;
    }

    const url = new URL(request.url ?? "/ws", "http://127.0.0.1");
    if (!WS_ROUTE_PATHS.has(url.pathname)) {
      socket.destroy();
      return;
    }

    const requestedThreadId = url.searchParams.get("thread_id");
    const thread = requestedThreadId
      ? store.getThread(requestedThreadId) ?? store.findThreadByAdapterRef(requestedThreadId)
      : null;
    if (!thread) {
      socket.destroy();
      return;
    }

    const afterSeq = url.searchParams.get("last_seen_seq") ?? "0";
    wsServer.handleUpgrade(request, socket, head, (upgraded: WebSocket) => {
      wsServer.emit("connection", upgraded, request, {
        afterSeq,
        threadId: thread.thread_id
      });
    });
  });

  app.addHook("onClose", async () => {
    wsServer.close();
    await manager.close();
    await nativeThreadMarker.close();
    await bridge.stop();
    store.close();
  });

  return {
    app,
    bridge,
    store,
    manager
  };
}

function createFallbackRequestId() {
  return `request_${Date.now()}`;
}
