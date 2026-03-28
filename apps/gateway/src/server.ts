import { promises as fs } from "node:fs";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import { Readable } from "node:stream";
import path from "node:path";
import { URL } from "node:url";

import Fastify, { type FastifyInstance, type RouteHandlerMethod } from "fastify";
import type { FastifyReply } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";

import { requiresMaterializedThreadControl } from "@codex-remote/core";
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
import { createUlid } from "./lib/ulid";
import { GatewayReadModelService } from "./services/read-model-service";
import { GatewayRunService } from "./services/run-service";
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

function sendThreadSyncPending(reply: FastifyReply) {
  reply.code(409);
  return {
    error: "thread_sync_pending"
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
    message === "patch_not_pending" ||
    message === "archived_thread" ||
    message === "approval_required" ||
    message === "input_required" ||
    message === "patch_review_required" ||
    message === "active_run_in_progress"
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
  const readModels = new GatewayReadModelService(store, bridge);
  const runService = new GatewayRunService(store, readModels, manager);

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
    return readModels.getOverview({
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
    const timeline = await readModels.getTimeline(threadId);
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
      const thread = await readModels.getThread(threadId);
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
      const thread = await readModels.getThread(threadId);
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
    const transcript = await readModels.getTranscriptPage({
      threadId,
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

  registerGet("/threads/:threadId/messages", async (request, reply) => {
    const threadId = (request.params as { threadId: string }).threadId;
    const query = request.query as { cursor?: string; limit?: string };
    const transcript = await readModels.getTranscriptPage({
      threadId,
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
      const initialThread = store.saveThread({
        project_id: project.project_id,
        thread_id: `shared_pending_${createUlid()}`,
        state: "ready",
        active_turn_id: null,
        pending_turn_ids: [],
        pending_approval_ids: [],
        worktree_path: input.repo_root,
        adapter_kind: "codex-app-server",
        native_title: input.prompt ? undefined : "New chat",
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
      return await runService.startTurn({
        threadId,
        body
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(routeErrorStatus(message));
      return {
        error: message
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
          inputItems: body.input_items,
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

      return await runService.startTurn({
        threadId: run.thread_id,
        body
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
        (thread && (await readModels.getThread(thread.thread_id))) ||
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

      const result = await runService.resolveApproval(command);
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

      const result = await runService.resolveApproval(command);
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

      const result = await runService.resolvePatch(command);
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

      const result = await runService.resolvePatch(command);
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
        await runService.rollbackPatch(command)
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

      const result = await runService.resolveNativeRequest(command);
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

      const thread = await readModels.getThread(threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      if (thread.title !== command.name) {
        const shouldRenameLocally =
          !thread.adapter_thread_ref ||
          thread.thread_id.startsWith("shared_pending_") ||
          thread.sync_state === "sync_pending";

        if (!shouldRenameLocally) {
          try {
            await commandBridge.renameSharedThread({
              threadId: thread.adapter_thread_ref ?? thread.thread_id,
              name: command.name
            });
            await bridge.syncThreadNow(thread.thread_id);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!/thread not found/i.test(message)) {
              throw error;
            }
          }
        }

        const mirroredThread =
          store.getThread(thread.thread_id) ??
          (thread.adapter_thread_ref
            ? store.findThreadByAdapterRef(thread.adapter_thread_ref)
            : undefined);
        if (mirroredThread) {
          store.saveThread({
            ...mirroredThread,
            native_title: command.name,
            updated_at: nowIso()
          });
        }
      }

      const updatedThread =
        (await readModels.getThread(thread.thread_id)) ??
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

      const thread = await readModels.getThread(threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      if (requiresMaterializedThreadControl(thread)) {
        return sendThreadSyncPending(reply);
      }

      await commandBridge.archiveSharedThread({
        threadId: thread.adapter_thread_ref ?? thread.thread_id
      });
      await bridge.syncThreadNow(thread.thread_id);

      const updatedThread =
        (await readModels.getThread(thread.thread_id)) ??
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

      const thread = await readModels.getThread(threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      if (requiresMaterializedThreadControl(thread)) {
        return sendThreadSyncPending(reply);
      }

      await commandBridge.unarchiveSharedThread({
        threadId: thread.adapter_thread_ref ?? thread.thread_id
      });
      await bridge.syncThreadNow(thread.thread_id);

      const updatedThread =
        (await readModels.getThread(thread.thread_id)) ??
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

      const thread = await readModels.getThread(threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      if (requiresMaterializedThreadControl(thread)) {
        return sendThreadSyncPending(reply);
      }

      await commandBridge.compactSharedThread({
        threadId: thread.adapter_thread_ref ?? thread.thread_id
      });
      await bridge.syncThreadNow(thread.thread_id);

      const updatedThread = (await readModels.getThread(thread.thread_id)) ?? thread;
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

      const thread = await readModels.getThread(threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      if (requiresMaterializedThreadControl(thread)) {
        return sendThreadSyncPending(reply);
      }

      const forked = await commandBridge.forkSharedThread({
        threadId: thread.adapter_thread_ref ?? thread.thread_id
      });
      let forkedThread: CodexThread | null = null;
      try {
        await bridge.syncThreadNow(forked.thread_id);
        forkedThread = (await readModels.getThread(forked.thread_id)) ?? null;
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

      const thread = await readModels.getThread(threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      if (requiresMaterializedThreadControl(thread)) {
        return sendThreadSyncPending(reply);
      }

      await commandBridge.rollbackSharedThread({
        threadId: thread.adapter_thread_ref ?? thread.thread_id,
        numTurns: command.num_turns
      });
      await bridge.syncThreadNow(thread.thread_id);

      const updatedThread = (await readModels.getThread(thread.thread_id)) ?? thread;
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

      const thread = await readModels.getThread(threadId);
      if (!thread) {
        reply.code(404);
        return {
          error: "unknown_thread"
        };
      }

      if (requiresMaterializedThreadControl(thread)) {
        return sendThreadSyncPending(reply);
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
