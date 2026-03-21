import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { ApprovalKind, PatchChange, PatchFileSummary } from "@codex-remote/protocol";

import {
  JsonLineFramer,
  encodeJsonLineMessage
} from "../lib/rpc-framer";
import { resolveCodexAppServerEnvironment } from "../lib/system-proxy";
import type { CodexAttachmentStore } from "../runtime/codex-attachment-store";
import type { CodexSettingsBridge } from "../runtime/codex-settings-bridge";
import type {
  Adapter,
  AdapterCallbacks,
  AdapterExecution,
  AdapterTurnContext,
  PatchDecision
} from "./types";

type JsonRpcId = number | string;

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcRequestMessage {
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
  jsonrpc?: string;
}

interface JsonRpcResponseMessage {
  id: JsonRpcId;
  result?: Record<string, unknown>;
  error?: JsonRpcError;
  jsonrpc?: string;
}

interface JsonRpcNotificationMessage {
  method: string;
  params?: Record<string, unknown>;
  id?: undefined;
  jsonrpc?: string;
}

type JsonRpcMessage =
  | JsonRpcRequestMessage
  | JsonRpcResponseMessage
  | JsonRpcNotificationMessage;

interface PendingRpcRequest {
  method: string;
  resolve: (value: Record<string, unknown> | undefined) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
}

type AppServerFileChange =
  | {
      type: "add";
      content: string;
    }
  | {
      type: "delete";
      content: string;
    }
  | {
      type: "update";
      unified_diff: string;
      move_path?: string | null;
    };

interface RemotePatchState {
  action?: PatchDecision["action"];
  callId: string;
  changes: PatchChange[];
  files: PatchFileSummary[];
  grantRoot?: string | null;
  patchId?: string;
  patchReadyPromise?: Promise<PatchDecision>;
  reason?: string | null;
  resolved?: boolean;
  turnId: string;
}

export interface CodexAppServerAdapterOptions {
  command?: string;
  args?: string[];
  codexHome?: string;
  requestTimeoutMs?: number;
  startupRetries?: number;
  attachmentStore?: CodexAttachmentStore;
  settingsBridge?: CodexSettingsBridge;
}

interface ResolvedCodexAppServerAdapterOptions {
  command: string;
  args: string[];
  codexHome?: string;
  requestTimeoutMs: number;
  startupRetries: number;
  attachmentStore?: CodexAttachmentStore;
  settingsBridge?: CodexSettingsBridge;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function isServerRequest(message: JsonRpcMessage): message is JsonRpcRequestMessage {
  return typeof (message as JsonRpcRequestMessage).id !== "undefined" &&
    typeof (message as JsonRpcRequestMessage).method === "string";
}

function isNotification(message: JsonRpcMessage): message is JsonRpcNotificationMessage {
  return typeof (message as JsonRpcNotificationMessage).method === "string" &&
    typeof (message as JsonRpcRequestMessage).id === "undefined";
}

function countTextLines(value: string) {
  if (!value) {
    return 0;
  }

  return value.endsWith("\n")
    ? value.slice(0, -1).split("\n").length
    : value.split("\n").length;
}

function countUnifiedDiffLines(diff: string) {
  let added = 0;
  let removed = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+")) {
      added += 1;
    } else if (line.startsWith("-")) {
      removed += 1;
    }
  }

  return {
    added,
    removed
  };
}

function normalizePatchPath(pathname: string, movePath?: string | null) {
  if (typeof movePath === "string" && movePath.trim().length > 0) {
    return movePath.trim();
  }
  return pathname;
}

function summarizeFileChange(pathname: string, change: AppServerFileChange): PatchFileSummary {
  if (change.type === "add") {
    return {
      path: pathname,
      added_lines: countTextLines(change.content),
      removed_lines: 0
    };
  }

  if (change.type === "delete") {
    return {
      path: pathname,
      added_lines: 0,
      removed_lines: countTextLines(change.content)
    };
  }

  const { added, removed } = countUnifiedDiffLines(change.unified_diff);
  return {
    path: normalizePatchPath(pathname, change.move_path),
    added_lines: added,
    removed_lines: removed
  };
}

function convertFileChange(pathname: string, change: AppServerFileChange): PatchChange {
  if (change.type === "add") {
    return {
      path: pathname,
      before_content: null,
      after_content: change.content
    };
  }

  if (change.type === "delete") {
    return {
      path: pathname,
      before_content: change.content,
      after_content: null
    };
  }

  return {
    path: normalizePatchPath(pathname, change.move_path),
    before_content: null,
    after_content: null,
    unified_diff: change.unified_diff
  };
}

function buildPatchSummary(files: PatchFileSummary[], reason?: string | null) {
  if (files.length === 1) {
    return `Review changes for ${files[0].path}.`;
  }
  if (files.length > 1) {
    return `Review patch touching ${files.length} files.`;
  }
  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason.trim();
  }
  return "Review pending file changes.";
}

function extractFileChangeMap(value: unknown): Record<string, AppServerFileChange> {
  const source = asRecord(value);
  if (!source) {
    return {};
  }

  const result: Record<string, AppServerFileChange> = {};
  for (const [pathname, rawChange] of Object.entries(source)) {
    const change = asRecord(rawChange);
    if (!change || typeof change.type !== "string") {
      continue;
    }

    if (change.type === "add" && typeof change.content === "string") {
      result[pathname] = {
        type: "add",
        content: change.content
      };
      continue;
    }

    if (change.type === "delete" && typeof change.content === "string") {
      result[pathname] = {
        type: "delete",
        content: change.content
      };
      continue;
    }

    if (change.type === "update" && typeof change.unified_diff === "string") {
      result[pathname] = {
        type: "update",
        unified_diff: change.unified_diff,
        move_path:
          typeof change.move_path === "string" ? change.move_path : null
      };
    }
  }

  return result;
}

function classifyApprovalKind(input: {
  command?: string | null;
  network?: boolean;
  permissions?: Record<string, unknown> | null;
  reason?: string | null;
}): ApprovalKind {
  const combined = `${input.reason ?? ""} ${input.command ?? ""}`.toLowerCase();
  if (
    input.network ||
    combined.includes("network") ||
    combined.includes("internet") ||
    combined.includes("curl") ||
    combined.includes("wget")
  ) {
    return "network";
  }
  if (
    combined.includes("delete") ||
    combined.includes("rm ") ||
    combined.includes("truncate") ||
    combined.includes("drop ")
  ) {
    return "destructive";
  }
  if (input.permissions?.fileSystem || combined.includes("write") || combined.includes("file")) {
    return "filesystem";
  }
  return "command";
}

function extractCodexErrorCode(error: Record<string, unknown> | null): string {
  if (!error) {
    return "adapter_failure";
  }

  const info = error.codexErrorInfo;
  if (typeof info === "string" && info.trim().length > 0) {
    return info.trim();
  }

  const infoRecord = asRecord(info);
  if (infoRecord) {
    const key = Object.keys(infoRecord)[0];
    if (typeof key === "string" && key.length > 0) {
      return key;
    }
  }

  return "adapter_failure";
}

function defaultCommandApprovalDecision(
  status: "approved" | "rejected" | "expired" | "canceled"
) {
  return status === "approved" ? "accept" : status === "canceled" ? "cancel" : "decline";
}

function defaultLegacyReviewDecision(
  status: "approved" | "rejected" | "expired" | "canceled"
) {
  return status === "approved"
    ? "approved"
    : status === "canceled"
      ? "abort"
      : "denied";
}

function fileChangeDecisionFromAction(action: PatchDecision["action"]) {
  return action === "apply" ? "accept" : "decline";
}

function reviewDecisionFromAction(action: PatchDecision["action"]) {
  return action === "apply" ? "approved" : "denied";
}

async function buildPromptInputs(
  context: AdapterTurnContext,
  attachmentStore?: CodexAttachmentStore
) {
  const prompt = context.turnInput?.prompt ?? context.turn.prompt;
  const inputItems = context.turnInput?.input_items ?? [];
  const inputs: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: prompt,
      text_elements: []
    }
  ];

  for (const item of inputItems) {
    if (item.type === "skill") {
      inputs.push({
        type: "skill",
        name: item.name,
        path: item.path
      });
      continue;
    }

    if (item.type === "image_attachment") {
      const attachmentId =
        typeof item.attachment_id === "string" ? item.attachment_id : "";
      if (!attachmentId) {
        throw new Error("Invalid image attachment.");
      }
      if (!attachmentStore) {
        throw new Error("Image attachments are unavailable on this host.");
      }

      const attachment = await attachmentStore.resolveImageAttachment(attachmentId);
      if (!attachment) {
        throw new Error(`Image attachment is unavailable: ${attachmentId}`);
      }

      inputs.push({
        type: "localImage",
        path: attachment.local_path
      });
    }
  }

  return inputs;
}

function extractCollaborationMode(context: AdapterTurnContext) {
  const candidate = (context.turn as Record<string, unknown>).collaboration_mode;
  return candidate === "plan" || candidate === "default" ? candidate : undefined;
}

function threadStatusSnapshot(status: unknown) {
  const record = asRecord(status);
  if (!record) {
    return {
      native_status_type: undefined,
      native_active_flags: undefined as string[] | undefined
    };
  }

  const activeFlags = Array.isArray(record.activeFlags)
    ? record.activeFlags.filter((flag): flag is string => typeof flag === "string")
    : undefined;

  return {
    native_status_type:
      typeof record.type === "string" ? record.type : undefined,
    native_active_flags: activeFlags
  };
}

function shouldReportAsTestCommand(value: string) {
  return /\b(test|pytest|vitest|jest|cargo test|go test|pnpm test|npm test)\b/i.test(
    value
  );
}

function itemTitle(item: Record<string, unknown>) {
  const type = typeof item.type === "string" ? item.type : "unknown";
  if (type === "commandExecution") {
    return typeof item.command === "string" ? item.command : "Running command";
  }
  if (type === "fileChange") {
    return "Preparing file changes";
  }
  if (type === "reasoning") {
    return "Reasoning";
  }
  if (type === "plan") {
    return "Updating plan";
  }
  if (type === "dynamicToolCall") {
    return typeof item.tool === "string" ? item.tool : "Dynamic tool call";
  }
  if (type === "mcpToolCall") {
    const server = typeof item.server === "string" ? item.server : "mcp";
    const tool = typeof item.tool === "string" ? item.tool : "tool";
    return `${server}:${tool}`;
  }
  if (type === "webSearch") {
    return typeof item.query === "string" ? item.query : "Searching";
  }
  if (type === "agentMessage") {
    return "Streaming response";
  }
  return type;
}

function itemChannel(item: Record<string, unknown>) {
  const type = typeof item.type === "string" ? item.type : "";
  if (type === "commandExecution" || type === "dynamicToolCall" || type === "mcpToolCall") {
    return "tool_call" as const;
  }
  if (type === "fileChange") {
    return "editing" as const;
  }
  if (type === "reasoning" || type === "plan" || type === "agentMessage") {
    return "thinking" as const;
  }
  return "status" as const;
}

class JsonRpcStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly framer = new JsonLineFramer();
  private readonly pending = new Map<JsonRpcId, PendingRpcRequest>();
  private nextId = 1;
  private closing = false;

  constructor(
    private readonly options: ResolvedCodexAppServerAdapterOptions,
    private readonly onMessage: (message: JsonRpcMessage) => Promise<void>,
    private readonly onMessageError: (error: unknown) => Promise<void>,
    private readonly onExit: (
      code: number | null,
      signal: NodeJS.Signals | null
    ) => Promise<void>
  ) {}

  async start() {
    const envResolution = await resolveCodexAppServerEnvironment(process.env);
    if (this.options.codexHome) {
      envResolution.env.CODEX_HOME = this.options.codexHome;
    }

    const child = spawn(this.options.command, this.options.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: envResolution.env
    });
    this.child = child;

    child.stdout.on("data", (chunk) => {
      for (const line of this.framer.push(chunk)) {
        let message: JsonRpcMessage;
        try {
          message = JSON.parse(line) as JsonRpcMessage;
        } catch {
          continue;
        }

        if (!isServerRequest(message) && !isNotification(message)) {
          const pending = this.pending.get(message.id);
          if (!pending) {
            continue;
          }
          clearTimeout(pending.timeout);
          this.pending.delete(message.id);
          if (message.error) {
            pending.reject(
              new Error(
                `${message.error.code ?? -1}: ${message.error.message ?? pending.method}`
              )
            );
          } else {
            pending.resolve(message.result);
          }
          continue;
        }

        void Promise.resolve(this.onMessage(message)).catch((error) => {
          void this.onMessageError(error);
        });
      }
    });

    child.stderr.on("data", () => {
      // Keep app-server stderr out of the gateway surface.
    });

    child.once("error", (error) => {
      this.rejectPending(error);
      void this.onExit(null, null);
    });

    child.once("exit", (code, signal) => {
      this.rejectPending(
        new Error(`codex app-server exited unexpectedly (code=${code}, signal=${signal})`)
      );
      void this.onExit(code, signal);
    });
  }

  request(method: string, params?: Record<string, unknown>) {
    const child = this.child;
    if (!child) {
      return Promise.reject(new Error("app_server_not_started"));
    }

    const id = this.nextId;
    this.nextId += 1;
    child.stdin.write(
      encodeJsonLineMessage(
        JSON.stringify({
          id,
          method,
          params
        })
      ),
      "utf8"
    );

    return new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, this.options.requestTimeoutMs);
      this.pending.set(id, {
        method,
        resolve,
        reject,
        timeout
      });
    });
  }

  notify(method: string, params?: Record<string, unknown>) {
    if (!this.child) {
      return;
    }

    this.child.stdin.write(
      encodeJsonLineMessage(
        JSON.stringify({
          method,
          params
        })
      ),
      "utf8"
    );
  }

  respond(id: JsonRpcId, result?: Record<string, unknown>) {
    if (!this.child) {
      return;
    }

    this.child.stdin.write(
      encodeJsonLineMessage(
        JSON.stringify({
          id,
          result
        })
      ),
      "utf8"
    );
  }

  respondError(id: JsonRpcId, error: JsonRpcError) {
    if (!this.child) {
      return;
    }

    this.child.stdin.write(
      encodeJsonLineMessage(
        JSON.stringify({
          id,
          error
        })
      ),
      "utf8"
    );
  }

  async stop() {
    const child = this.child;
    if (!child || this.closing) {
      return;
    }

    this.closing = true;
    this.rejectPending(new Error("app_server_closed"));
    child.kill();
    this.child = null;
  }

  private rejectPending(error: Error) {
    for (const current of this.pending.values()) {
      clearTimeout(current.timeout);
      current.reject(error);
    }
    this.pending.clear();
  }
}

class CodexAppServerExecution implements AdapterExecution {
  constructor(
    private readonly interruptTurn: (reason?: string) => Promise<void>
  ) {}

  async interrupt(reason?: string) {
    await this.interruptTurn(reason);
  }
}

export class CodexAppServerAdapter implements Adapter {
  readonly kind = "codex-app-server" as const;
  readonly options: ResolvedCodexAppServerAdapterOptions;

  constructor(options: CodexAppServerAdapterOptions = {}) {
    this.options = {
      command: options.command ?? "codex",
      args: options.args ?? ["app-server", "--listen", "stdio://"],
      codexHome: options.codexHome,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      startupRetries: options.startupRetries ?? 1,
      attachmentStore: options.attachmentStore,
      settingsBridge: options.settingsBridge
    };
  }

  async runTurn(
    context: AdapterTurnContext,
    callbacks: AdapterCallbacks
  ): Promise<AdapterExecution> {
    let client: JsonRpcStdioClient | null = null;
    let remoteThreadId = context.thread.adapter_thread_ref ?? null;
    let remoteTurnId = context.thread.native_turn_ref ?? null;
    let startupComplete = false;
    let settled = false;
    let closedByCaller = false;
    let assistantBuffer = "";
    let lastAgentMessage = "";
    let lastFinalAnswer = "";
    let lastAssistantDelta = "";
    let lastAssistantDeltaAt = 0;
    const patchStates = new Map<string, RemotePatchState>();

    const bindRemoteThread = async (threadId: string) => {
      const changed = remoteThreadId !== threadId;
      remoteThreadId = threadId;
      if (changed) {
        await callbacks.onThreadBinding({
          kind: "codex-app-server",
          thread_ref: threadId
        });
      }
    };

    const settleFailure = async (input: {
      code: string;
      interrupted?: boolean;
      message: string;
      retryable?: boolean;
    }) => {
      if (settled) {
        return;
      }

      settled = true;
      await callbacks.onFailed(input);
      await client?.stop();
    };

    const emitAssistantProgress = async (delta: string) => {
      if (!delta) {
        return;
      }

      const now = Date.now();
      if (delta === lastAssistantDelta && now - lastAssistantDeltaAt < 100) {
        return;
      }

      lastAssistantDelta = delta;
      lastAssistantDeltaAt = now;
      assistantBuffer += delta;
      lastAgentMessage = assistantBuffer;
      await callbacks.onProgress({
        channel: "thinking",
        message: assistantBuffer,
        step: "assistant_message"
      });
    };

    const emitThinkingProgress = async (message: string, step: string) => {
      if (!message) {
        return;
      }
      await callbacks.onProgress({
        channel: "thinking",
        message,
        step
      });
    };

    const emitToolResultProgress = async (message: string, step: string) => {
      if (!message) {
        return;
      }
      await callbacks.onProgress({
        channel: "tool_result",
        message,
        step
      });
    };

    const patchStateFor = (callId: string, turnId: string) => {
      const existing = patchStates.get(callId);
      if (existing) {
        return existing;
      }

      const created: RemotePatchState = {
        callId,
        changes: [],
        files: [],
        turnId
      };
      patchStates.set(callId, created);
      return created;
    };

    const updatePatchFromChanges = (state: RemotePatchState, value: unknown) => {
      const fileChanges = extractFileChangeMap(value);
      const files = Object.entries(fileChanges).map(([pathname, change]) =>
        summarizeFileChange(pathname, change)
      );
      const changes = Object.entries(fileChanges).map(([pathname, change]) =>
        convertFileChange(pathname, change)
      );
      if (files.length > 0) {
        state.files = files;
      }
      if (changes.length > 0) {
        state.changes = changes;
      }
    };

    const getPatchDecision = (state: RemotePatchState) => {
      if (!state.patchReadyPromise) {
        state.patchReadyPromise = callbacks
          .onPatchReady({
            summary: buildPatchSummary(state.files, state.reason),
            files: state.files,
            changes: state.changes,
            managed_by_adapter: true
          })
          .then((decision) => {
            state.patchId = decision.patch_id;
            state.action = decision.action;
            return decision;
          });
      }
      return state.patchReadyPromise;
    };

    const interruptRemoteTurn = async (reason?: string) => {
      void reason;
      const activeClient = client;
      if (!activeClient || !remoteThreadId) {
        return;
      }

      try {
        await activeClient.request("turn/interrupt", {
          threadId: remoteThreadId,
          turnId: remoteTurnId ?? context.turn.turn_id
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await callbacks.onDiagnostic({
          message: "app_server_interrupt_failed",
          details: {
            error: message,
            thread_id: remoteThreadId,
            turn_id: remoteTurnId ?? context.turn.turn_id
          }
        });
      }
    };

    const handleServerRequest = async (message: JsonRpcRequestMessage) => {
      const params = message.params ?? {};

      if (message.method === "item/commandExecution/requestApproval") {
        const command =
          typeof params.command === "string"
            ? params.command
            : Array.isArray(params.commandActions)
              ? JSON.stringify(params.commandActions)
              : null;
        const permissions = asRecord(params.additionalPermissions);
        const approval = await callbacks.onApprovalRequest({
          kind: classifyApprovalKind({
            command,
            network: Boolean(params.networkApprovalContext),
            permissions,
            reason: typeof params.reason === "string" ? params.reason : null
          }),
          reason:
            typeof params.reason === "string" && params.reason.trim().length > 0
              ? params.reason
              : command
                ? `Approval required for command: ${command}`
                : "Approval required for command execution.",
          native_ref: String(message.id),
          command: command ?? undefined,
          cwd: typeof params.cwd === "string" ? params.cwd : undefined,
          permissions: permissions ?? undefined,
          available_decisions: Array.isArray(params.availableDecisions)
            ? params.availableDecisions
            : undefined
        });
        client?.respond(message.id, {
          decision:
            approval.native_decision ?? defaultCommandApprovalDecision(approval.status)
        });
        return;
      }

      if (message.method === "execCommandApproval") {
        const command = Array.isArray(params.command)
          ? params.command
              .filter((part): part is string => typeof part === "string")
              .join(" ")
          : null;
        const approval = await callbacks.onApprovalRequest({
          kind: classifyApprovalKind({
            command,
            reason: typeof params.reason === "string" ? params.reason : null
          }),
          reason:
            typeof params.reason === "string" && params.reason.trim().length > 0
              ? params.reason
              : command
                ? `Approval required for command: ${command}`
                : "Approval required for command execution.",
          native_ref: String(message.id),
          command: command ?? undefined,
          cwd: typeof params.cwd === "string" ? params.cwd : undefined
        });
        client?.respond(message.id, {
          decision:
            approval.native_decision ?? defaultLegacyReviewDecision(approval.status)
        });
        return;
      }

      if (message.method === "item/fileChange/requestApproval") {
        const turnId =
          typeof params.turnId === "string" ? params.turnId : remoteTurnId ?? context.turn.turn_id;
        const callId =
          typeof params.itemId === "string" ? params.itemId : `patch-${String(message.id)}`;
        const state = patchStateFor(callId, turnId);
        state.reason =
          typeof params.reason === "string" ? params.reason : state.reason ?? null;
        state.grantRoot =
          typeof params.grantRoot === "string" ? params.grantRoot : state.grantRoot ?? null;
        const decision = await getPatchDecision(state);
        client?.respond(message.id, {
          decision: fileChangeDecisionFromAction(decision.action)
        });
        return;
      }

      if (message.method === "applyPatchApproval") {
        const conversationId =
          typeof params.conversationId === "string"
            ? params.conversationId
            : remoteThreadId ?? context.thread.thread_id;
        const state = patchStateFor(
          typeof params.callId === "string" ? params.callId : `patch-${String(message.id)}`,
          remoteTurnId ?? context.turn.turn_id
        );
        state.reason =
          typeof params.reason === "string" ? params.reason : state.reason ?? null;
        state.grantRoot =
          typeof params.grantRoot === "string" ? params.grantRoot : state.grantRoot ?? null;
        updatePatchFromChanges(state, params.fileChanges);
        const decision = await getPatchDecision(state);
        client?.respond(message.id, {
          conversationId,
          decision: reviewDecisionFromAction(decision.action)
        });
        return;
      }

      if (message.method === "item/permissions/requestApproval") {
        const permissions = asRecord(params.permissions);
        const approval = await callbacks.onApprovalRequest({
          kind: classifyApprovalKind({
            permissions,
            reason: typeof params.reason === "string" ? params.reason : null
          }),
          reason:
            typeof params.reason === "string" && params.reason.trim().length > 0
              ? params.reason
              : "Additional permissions requested.",
          native_ref: String(message.id),
          permissions: permissions ?? undefined
        });

        if (approval.status !== "approved") {
          client?.respondError(message.id, {
            code: -32800,
            message: "Permission request denied."
          });
          return;
        }

        client?.respond(message.id, {
          permissions: permissions ?? {},
          scope: "turn"
        });
        return;
      }

      if (message.method === "item/tool/requestUserInput") {
        const questions = Array.isArray(params.questions) ? params.questions : [];
        const resolution = await callbacks.onNativeRequest({
          kind: "user_input",
          title: "Input requested",
          prompt:
            questions.length > 0
              ? questions
                  .map((question) => {
                    const record = asRecord(question);
                    return typeof record?.question === "string" ? record.question : "";
                  })
                  .filter(Boolean)
                  .join("\n")
              : "Codex requested user input.",
          native_ref: String(message.id),
          thread_id: typeof params.threadId === "string" ? params.threadId : undefined,
          turn_id: typeof params.turnId === "string" ? params.turnId : undefined,
          item_id: typeof params.itemId === "string" ? params.itemId : undefined,
          payload: params
        });

        if (resolution.status === "canceled") {
          client?.respondError(message.id, {
            code: -32800,
            message: "User input request canceled."
          });
          return;
        }

        client?.respond(
          message.id,
          (asRecord(resolution.response_payload) ?? {
            answers: {}
          }) as Record<string, unknown>
        );
        return;
      }

      if (message.method === "mcpServer/elicitation/request") {
        const resolution = await callbacks.onNativeRequest({
          kind: "user_input",
          title: "MCP elicitation requested",
          prompt:
            typeof params.message === "string" && params.message.trim().length > 0
              ? params.message
              : "MCP server requested additional input.",
          native_ref: String(message.id),
          thread_id: typeof params.threadId === "string" ? params.threadId : undefined,
          turn_id: typeof params.turnId === "string" ? params.turnId : undefined,
          payload: params
        });

        if (resolution.status === "canceled") {
          client?.respondError(message.id, {
            code: -32800,
            message: "MCP elicitation canceled."
          });
          return;
        }

        client?.respond(message.id, asRecord(resolution.response_payload) ?? {});
        return;
      }

      if (message.method === "item/tool/call") {
        const resolution = await callbacks.onNativeRequest({
          kind: "dynamic_tool",
          title:
            typeof params.tool === "string"
              ? `Dynamic tool call: ${params.tool}`
              : "Dynamic tool call",
          prompt:
            typeof params.tool === "string"
              ? `Respond to dynamic tool ${params.tool}.`
              : "Respond to the dynamic tool call.",
          native_ref: String(message.id),
          thread_id: typeof params.threadId === "string" ? params.threadId : undefined,
          turn_id: typeof params.turnId === "string" ? params.turnId : undefined,
          item_id: typeof params.callId === "string" ? params.callId : undefined,
          payload: params
        });

        if (resolution.status === "canceled") {
          client?.respondError(message.id, {
            code: -32800,
            message: "Dynamic tool call canceled."
          });
          return;
        }

        client?.respond(
          message.id,
          (asRecord(resolution.response_payload) ?? {
            success: false,
            contentItems: []
          }) as Record<string, unknown>
        );
        return;
      }

      if (message.method === "account/chatgptAuthTokens/refresh") {
        const resolution = await callbacks.onNativeRequest({
          kind: "auth_refresh",
          title: "Authentication refresh requested",
          prompt:
            typeof params.reason === "string"
              ? `Refresh ChatGPT auth tokens (${params.reason}).`
              : "Refresh ChatGPT auth tokens.",
          native_ref: String(message.id),
          payload: params
        });

        if (resolution.status === "canceled") {
          client?.respondError(message.id, {
            code: -32800,
            message: "Auth refresh canceled."
          });
          return;
        }

        client?.respond(
          message.id,
          (asRecord(resolution.response_payload) ?? {
            accessToken: "",
            chatgptAccountId:
              typeof params.previousAccountId === "string" ? params.previousAccountId : "",
            chatgptPlanType: null
          }) as Record<string, unknown>
        );
        return;
      }

      client?.respondError(message.id, {
        code: -32601,
        message: `Unsupported server request: ${message.method}`
      });
    };

    const handleNotification = async (message: JsonRpcNotificationMessage) => {
      const params = message.params ?? {};

      if (message.method === "thread/started") {
        const thread = asRecord(params.thread);
        if (typeof thread?.id === "string") {
          await bindRemoteThread(thread.id);
        }
        return;
      }

      if (message.method === "thread/name/updated") {
        await callbacks.onNativeThreadUpdated({
          reason: message.method,
          title:
            typeof params.threadName === "string" ? params.threadName : undefined
        });
        return;
      }

      if (message.method === "thread/archived") {
        await callbacks.onNativeThreadUpdated({
          archived: true,
          native_status_type: "archived",
          reason: message.method
        });
        return;
      }

      if (message.method === "thread/unarchived") {
        await callbacks.onNativeThreadUpdated({
          archived: false,
          reason: message.method
        });
        return;
      }

      if (message.method === "thread/closed") {
        await callbacks.onNativeThreadUpdated({
          native_status_type: "closed",
          reason: message.method
        });
        return;
      }

      if (message.method === "thread/status/changed") {
        const snapshot = threadStatusSnapshot(params.status);
        await callbacks.onNativeThreadUpdated({
          reason: message.method,
          native_active_flags: snapshot.native_active_flags,
          native_status_type: snapshot.native_status_type
        });
        return;
      }

      if (message.method === "thread/tokenUsage/updated") {
        await callbacks.onNativeThreadUpdated({
          reason: message.method,
          native_token_usage: asRecord(params.tokenUsage) ?? undefined
        });
        return;
      }

      if (message.method === "turn/started") {
        const turn = asRecord(params.turn);
        if (typeof turn?.id === "string") {
          remoteTurnId = turn.id;
        }
        return;
      }

      if (message.method === "item/started") {
        const item = asRecord(params.item);
        if (!item) {
          return;
        }
        await callbacks.onProgress({
          channel: itemChannel(item),
          message: itemTitle(item),
          step: typeof item.type === "string" ? item.type : undefined
        });
        return;
      }

      if (message.method === "item/agentMessage/delta") {
        await emitAssistantProgress(typeof params.delta === "string" ? params.delta : "");
        return;
      }

      if (message.method === "item/reasoning/summaryTextDelta") {
        await emitThinkingProgress(
          typeof params.delta === "string" ? params.delta : "",
          "reasoning"
        );
        return;
      }

      if (message.method === "item/reasoning/textDelta") {
        await emitThinkingProgress(
          typeof params.delta === "string" ? params.delta : "",
          "reasoning"
        );
        return;
      }

      if (message.method === "item/reasoning/summaryPartAdded") {
        const index = typeof params.summaryIndex === "number" ? params.summaryIndex + 1 : 1;
        await emitThinkingProgress(`Reasoning summary part ${index}`, "reasoning");
        return;
      }

      if (message.method === "turn/plan/updated") {
        const lines = [
          typeof params.explanation === "string" ? params.explanation : undefined,
          ...(Array.isArray(params.plan)
            ? params.plan
                .map((entry) => {
                  const record = asRecord(entry);
                  const status =
                    typeof record?.status === "string" ? record.status : undefined;
                  const step = typeof record?.step === "string" ? record.step : undefined;
                  return status && step ? `${status}: ${step}` : undefined;
                })
                .filter((value): value is string => Boolean(value))
            : [])
        ].filter((value): value is string => Boolean(value));
        await emitThinkingProgress(lines.join("\n"), "plan");
        return;
      }

      if (message.method === "item/plan/delta") {
        await emitThinkingProgress(
          typeof params.delta === "string" ? params.delta : "",
          "plan"
        );
        return;
      }

      if (message.method === "command/exec/outputDelta") {
        await emitToolResultProgress(
          typeof params.delta === "string" ? params.delta : "",
          "commandExecution"
        );
        return;
      }

      if (message.method === "item/commandExecution/outputDelta") {
        await emitToolResultProgress(
          typeof params.delta === "string" ? params.delta : "",
          "commandExecution"
        );
        return;
      }

      if (message.method === "item/fileChange/outputDelta") {
        await emitToolResultProgress(
          typeof params.delta === "string" ? params.delta : "",
          "fileChange"
        );
        return;
      }

      if (message.method === "item/commandExecution/terminalInteraction") {
        await emitToolResultProgress(
          typeof params.stdin === "string" ? params.stdin : "",
          "terminal"
        );
        return;
      }

      if (message.method === "item/completed") {
        const item = asRecord(params.item);
        if (!item) {
          return;
        }

        if (item.type === "agentMessage" && typeof item.text === "string") {
          assistantBuffer = item.text;
          lastAgentMessage = item.text;
          if (item.phase === "final_answer") {
            lastFinalAnswer = item.text;
          }
          return;
        }

        if (item.type === "commandExecution") {
          const commandText =
            typeof item.command === "string"
              ? item.command
              : Array.isArray(item.commandActions)
                ? JSON.stringify(item.commandActions)
                : "";
          if (shouldReportAsTestCommand(commandText)) {
            await callbacks.onTestsFinished({
              status: Number(item.exitCode ?? 1) === 0 ? "passed" : "failed",
              summary:
                typeof item.aggregatedOutput === "string" && item.aggregatedOutput.length > 0
                  ? item.aggregatedOutput
                  : `Command finished with exit code ${item.exitCode ?? "unknown"}.`,
              duration_ms:
                typeof item.durationMs === "number" ? item.durationMs : undefined
            });
          }
          return;
        }

        if (item.type === "fileChange" && typeof item.id === "string") {
          const state = patchStates.get(item.id);
          if (!state || state.resolved || !state.patchId) {
            return;
          }

          updatePatchFromChanges(state, item.changes);
          if (item.status === "accepted") {
            state.resolved = true;
            await callbacks.onPatchResolved({
              patch_id: state.patchId,
              action: "apply",
              changes: state.changes,
              rollback_available: true
            });
          } else if (item.status === "declined") {
            state.resolved = true;
            await callbacks.onPatchResolved({
              patch_id: state.patchId,
              action: "discard",
              changes: state.changes
            });
          }
        }
        return;
      }

      if (message.method === "serverRequest/resolved") {
        return;
      }

      if (message.method === "turn/completed") {
        if (settled) {
          return;
        }

        const turn = asRecord(params.turn);
        const status =
          typeof turn?.status === "string"
            ? turn.status
            : typeof params.status === "string"
              ? params.status
              : "completed";
        const error = asRecord(turn?.error ?? params.error);

        if (status === "completed") {
          settled = true;
          await callbacks.onCompleted(lastFinalAnswer || lastAgentMessage || "Turn completed.");
          await client?.stop();
          return;
        }

        await settleFailure({
          code: status === "interrupted" ? "interrupted" : extractCodexErrorCode(error),
          interrupted: status === "interrupted",
          message:
            typeof error?.message === "string"
              ? error.message
              : lastAgentMessage || `Turn ${status}.`,
          retryable: false
        });
        return;
      }

      if (message.method === "error") {
        await callbacks.onDiagnostic({
          message: "app_server_error_notification",
          details: params
        });
        return;
      }

      await callbacks.onDiagnostic({
        message: "app_server_notification_ignored",
        details: {
          method: message.method
        }
      });
    };

    const sharedSettings = await this.options.settingsBridge
      ?.getSettings()
      .catch(() => null);

    for (let attempt = 0; attempt <= this.options.startupRetries; attempt += 1) {
      client = new JsonRpcStdioClient(
        this.options,
        async (message) => {
          if (isServerRequest(message)) {
            await handleServerRequest(message);
            return;
          }

          if (isNotification(message)) {
            await handleNotification(message);
          }
        },
        async (error) => {
          const message = error instanceof Error ? error.message : String(error);
          await settleFailure({
            code: "adapter_protocol_error",
            message
          });
        },
        async (code, signal) => {
          if (settled || closedByCaller || !startupComplete) {
            return;
          }

          await settleFailure({
            code: "adapter_crash",
            message: `codex app-server exited unexpectedly (code=${code}, signal=${signal}).`,
            retryable: false
          });
        }
      );

      try {
        await client.start();
        await client.request("initialize", {
          clientInfo: {
            name: "codex-remote",
            version: "0.1.0"
          },
          capabilities: {
            experimentalApi: true
          }
        });
        client.notify("initialized");

        if (remoteThreadId) {
          try {
            const resumed = await client.request("thread/resume", {
              threadId: remoteThreadId
            });
            const resumedThread = asRecord(resumed?.thread);
            if (typeof resumedThread?.id === "string" && resumedThread.id !== remoteThreadId) {
              await bindRemoteThread(resumedThread.id);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!/no rollout found for thread id/i.test(message)) {
              throw error;
            }

            await callbacks.onDiagnostic({
              message: "app_server_thread_resume_skipped",
              details: {
                reason: message,
                thread_id: remoteThreadId
              }
            });
            remoteThreadId = null;
          }
        }

        if (!remoteThreadId) {
          const params: Record<string, unknown> = {
            approvalPolicy: "on-request",
            cwd: context.worktreePath,
            experimentalRawEvents: false,
            persistExtendedHistory: true,
            sandbox: "read-only"
          };
          if (typeof sharedSettings?.model === "string" && sharedSettings.model.length > 0) {
            params.model = sharedSettings.model;
          }

          const started = await client.request("thread/start", params);
          const thread = asRecord(started?.thread);
          if (typeof thread?.id !== "string" || thread.id.length === 0) {
            throw new Error("codex app-server did not return a thread id");
          }
          await bindRemoteThread(thread.id);
        }

        const turnParams: Record<string, unknown> = {
          cwd: context.worktreePath,
          threadId: remoteThreadId,
          input: await buildPromptInputs(context, this.options.attachmentStore)
        };
        if (
          typeof sharedSettings?.model_reasoning_effort === "string" &&
          sharedSettings.model_reasoning_effort.length > 0
        ) {
          turnParams.effort = sharedSettings.model_reasoning_effort;
        }
        if (typeof sharedSettings?.model === "string" && sharedSettings.model.length > 0) {
          turnParams.model = sharedSettings.model;
        }

        const collaborationMode = extractCollaborationMode(context);
        if (collaborationMode) {
          turnParams.collaborationMode = collaborationMode;
        }

        const startedTurn = await client.request("turn/start", turnParams);
        const turn = asRecord(startedTurn?.turn);
        if (typeof turn?.id === "string") {
          remoteTurnId = turn.id;
        }

        startupComplete = true;
        return new CodexAppServerExecution(async (reason) => {
          void reason;
          await interruptRemoteTurn(reason);
        });
      } catch (error) {
        await client.stop();
        client = null;

        if (attempt < this.options.startupRetries) {
          await callbacks.onDiagnostic({
            message: "app_server_startup_retry",
            details: {
              attempt: attempt + 1,
              error: error instanceof Error ? error.message : String(error)
            }
          });
          await delay((attempt + 1) * 200);
          continue;
        }

        throw error;
      }
    }

    closedByCaller = true;
    throw new Error("codex app-server failed to start");
  }
}
