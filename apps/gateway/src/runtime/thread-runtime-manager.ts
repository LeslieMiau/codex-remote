import type {
  ApplyPatchCommand,
  CodexLiveState,
  DiscardPatchCommand,
  GatewayEvent,
  RespondNativeRequestCommand,
  RollbackPatchCommand,
  RollbackPatchResponse,
  StartTurnResponse,
  ThreadSnapshot,
  TurnInputItem,
  TurnRecord,
  ApproveCommand,
  RejectCommand,
  PatchRecord
} from "@codex-remote/protocol";
import { CURRENT_SCHEMA_VERSION } from "@codex-remote/protocol";

import type {
  Adapter,
  AdapterCallbacks,
  AdapterTurnInput,
  ApprovalResolution,
  NativeRequestResolution,
  PatchDecision
} from "../adapters/types";
import { createUlid } from "../lib/ulid";
import { nowIso } from "../lib/time";
import { GatewayStore } from "../lib/store";
import { CodexNativeThreadMarker } from "./codex-native-thread-marker";
import { PolicyEngine } from "./policy-engine";
import { SessionHub } from "./session-hub";
import { WorktreeManager } from "./worktree-manager";

interface StartTurnInput {
  actor_id: string;
  request_id: string;
  thread_id: string;
  prompt: string;
  input_items?: TurnInputItem[];
  collaboration_mode?: "default" | "plan";
  command_type: "turns.start";
}

interface ThreadRuntimeManagerOptions {
  store: GatewayStore;
  sessionHub: SessionHub;
  adapter: Adapter;
  policyEngine?: PolicyEngine;
  commandBridge?: unknown;
  syncThreadNow?: (threadId: string) => Promise<void>;
  worktreeManager?: WorktreeManager;
  nativeThreadMarker?: CodexNativeThreadMarker;
}

interface Deferred<T> {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    reject,
    resolve
  };
}

function appendPendingTurn(thread: ThreadSnapshot, turnId: string): ThreadSnapshot {
  const pending = thread.pending_turn_ids.includes(turnId)
    ? thread.pending_turn_ids
    : [...thread.pending_turn_ids, turnId];

  return {
    ...thread,
    pending_turn_ids: pending
  };
}

function removePendingTurn(thread: ThreadSnapshot, turnId: string) {
  return thread.pending_turn_ids.filter((candidate) => candidate !== turnId);
}

function isTerminalTurnState(state: TurnRecord["state"]) {
  return state === "completed" || state === "failed" || state === "interrupted";
}

function progressToTurnState(
  current: TurnRecord["state"],
  input: { resumed?: boolean }
): TurnRecord["state"] {
  if (input.resumed) {
    return "resumed";
  }
  if (current === "queued") {
    return "started";
  }
  if (
    current === "started" ||
    current === "resumed" ||
    current === "waiting_approval" ||
    current === "waiting_input"
  ) {
    return "streaming";
  }
  return current;
}

function approvalStatusFromCommand(
  command: ApproveCommand | RejectCommand
): ApprovalResolution["status"] {
  return command.command_type === "approvals.approve" ? "approved" : "rejected";
}

function patchStatusFromAction(action: PatchDecision["action"]): PatchRecord["status"] {
  return action === "apply" ? "applied" : "discarded";
}

function nativeRequestStatusFromAction(
  command: RespondNativeRequestCommand
): NativeRequestResolution["status"] {
  return command.action === "cancel" ? "canceled" : "responded";
}

export class ThreadRuntimeManager {
  private readonly store: GatewayStore;
  private readonly sessionHub: SessionHub;
  private readonly adapter: Adapter;
  private readonly policyEngine: PolicyEngine;
  private readonly syncThreadNow?: (threadId: string) => Promise<void>;
  private readonly worktreeManager: WorktreeManager;
  private readonly nativeThreadMarker?: CodexNativeThreadMarker;
  private readonly executions = new Map<string, { interrupt(reason?: string): Promise<void> }>();
  private readonly approvalBindings = new Map<string, Deferred<ApprovalResolution>>();
  private readonly nativeRequestBindings = new Map<
    string,
    Deferred<NativeRequestResolution>
  >();
  private readonly patchBindings = new Map<string, Deferred<PatchDecision>>();
  private readonly turnInputs = new Map<string, AdapterTurnInput>();

  constructor(options: ThreadRuntimeManagerOptions) {
    this.store = options.store;
    this.sessionHub = options.sessionHub;
    this.adapter = options.adapter;
    this.policyEngine = options.policyEngine ?? new PolicyEngine();
    this.syncThreadNow = options.syncThreadNow;
    this.worktreeManager = options.worktreeManager ?? new WorktreeManager();
    this.nativeThreadMarker = options.nativeThreadMarker;
    void options.commandBridge;
  }

  startBackgroundWorkers() {
    void this.policyEngine;
    void this.adapter;
  }

  hasLiveApprovalBinding(approvalId: string) {
    return this.approvalBindings.has(approvalId);
  }

  hasActiveExecution(turnId: string) {
    return this.executions.has(turnId);
  }

  async startTurn(input: StartTurnInput): Promise<StartTurnResponse> {
    const dedupKey = {
      actor_id: input.actor_id,
      request_id: input.request_id,
      command_type: input.command_type
    };
    const existing = this.store.getCommandResult<StartTurnResponse>(dedupKey);
    if (existing) {
      return {
        ...existing,
        deduplicated: true
      };
    }

    const thread = this.store.getThread(input.thread_id);
    if (!thread) {
      throw new Error("unknown_thread");
    }

    if (!this.store.getProject(thread.project_id)) {
      throw new Error("unknown_project");
    }

    const timestamp = nowIso();
    const turn: TurnRecord = {
      project_id: thread.project_id,
      thread_id: thread.thread_id,
      turn_id: createUlid(),
      prompt: input.prompt,
      state: "queued",
      created_at: timestamp,
      updated_at: timestamp
    };

    const savedTurn = this.store.saveTurn(
      Object.assign(turn, {
        collaboration_mode: input.collaboration_mode
      }) as TurnRecord
    );
    const savedThread = this.store.saveThread({
      ...appendPendingTurn(thread, savedTurn.turn_id),
      state: thread.state === "archived" ? thread.state : "ready",
      updated_at: timestamp
    });
    this.turnInputs.set(savedTurn.turn_id, {
      prompt: input.prompt,
      input_items: input.input_items
    });

    await this.publishEvent({
      threadId: savedThread.thread_id,
      turnId: savedTurn.turn_id,
      timestamp,
      eventType: "turn.queued",
      payload: {
        prompt: input.prompt,
        collaboration_mode: input.collaboration_mode ?? "default"
      }
    });

    void this.executeTurn(savedTurn.turn_id).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.store.appendAudit({
        category: "adapter_lifecycle",
        project_id: savedTurn.project_id,
        thread_id: savedTurn.thread_id,
        turn_id: savedTurn.turn_id,
        message: "turn_execution_crashed",
        details: {
          error: message
        }
      });
    });

    if (this.syncThreadNow) {
      void this.syncThreadNow(savedThread.thread_id);
    }

    const response: StartTurnResponse = {
      deduplicated: false,
      thread: this.store.getThread(savedThread.thread_id) ?? savedThread,
      turn: this.store.getTurn(savedTurn.turn_id) ?? savedTurn
    };
    this.store.saveCommandResult(dedupKey, response);
    return response;
  }

  async resolveApproval(command: ApproveCommand | RejectCommand) {
    const approval = this.store.getApproval(command.approval_id);
    if (!approval) {
      throw new Error("unknown_approval");
    }

    this.policyEngine.assertApprovalResolution(approval, command);

    const binding = this.approvalBindings.get(approval.approval_id);
    if (approval.source === "native" && !binding) {
      throw new Error("native_approval_unrecoverable");
    }

    const timestamp = nowIso();
    const resolvedStatus = approvalStatusFromCommand(command);
    const updated = this.store.saveApproval({
      ...approval,
      actor_id: command.actor_id,
      resolved_at: timestamp,
      status: resolvedStatus
    });
    const thread = this.refreshThreadState(updated.thread_id ?? approval.thread_id ?? "", {
      updatedAt: timestamp
    });

    await this.publishEvent({
      threadId: thread.thread_id,
      turnId: updated.turn_id,
      timestamp,
      eventType: "approval.resolved",
      payload: {
        approval_id: updated.approval_id,
        status: updated.status
      }
    });

    if (binding) {
      binding.resolve({
        approval_id: updated.approval_id,
        status: resolvedStatus,
        native_decision: command.native_decision
      });
    }

    await this.maybeSyncThread(thread.thread_id);

    return {
      approval: updated,
      thread
    };
  }

  async resolveNativeRequest(command: RespondNativeRequestCommand) {
    const request = this.store.getNativeRequest(command.native_request_id);
    if (!request) {
      throw new Error("unknown_native_request");
    }
    if (request.status !== "requested") {
      throw new Error("native_request_not_pending");
    }

    const binding = this.nativeRequestBindings.get(request.native_request_id);
    if (!binding) {
      throw new Error("native_request_unrecoverable");
    }

    const timestamp = nowIso();
    const updated = this.store.saveNativeRequest({
      ...request,
      actor_id: command.actor_id,
      resolved_at: timestamp,
      response_payload: command.response_payload,
      status: nativeRequestStatusFromAction(command)
    });
    const thread = this.refreshThreadState(updated.thread_id ?? request.thread_id ?? "", {
      updatedAt: timestamp
    });

    await this.publishEvent({
      threadId: thread.thread_id,
      turnId: updated.turn_id,
      timestamp,
      eventType: "native_request.resolved",
      payload: {
        native_request_id: updated.native_request_id,
        status: updated.status
      }
    });

    binding.resolve({
      native_request_id: updated.native_request_id,
      status:
        updated.status === "canceled"
          ? "canceled"
          : updated.status === "failed"
            ? "failed"
            : "responded",
      response_payload: command.response_payload
    });

    await this.maybeSyncThread(thread.thread_id);

    return {
      native_request: updated,
      thread
    };
  }

  async resolvePatch(command: ApplyPatchCommand | DiscardPatchCommand) {
    const patch = this.store.getPatch(command.patch_id);
    if (!patch) {
      throw new Error("unknown_patch");
    }
    if (patch.status === "applied" || patch.status === "discarded") {
      throw new Error("patch_not_pending");
    }

    const thread = this.store.getThread(patch.thread_id);
    const project = thread ? this.store.getProject(thread.project_id) : undefined;
    if (!thread || !project) {
      throw new Error("unknown_thread");
    }

    const timestamp = nowIso();
    const worktreePath =
      thread.worktree_path ??
      (await this.worktreeManager.ensureThreadWorktree(project, thread));
    let updatedThread = thread.worktree_path
      ? thread
      : this.store.saveThread({
          ...thread,
          worktree_path: worktreePath,
          updated_at: timestamp
        });

    let nextPatch: PatchRecord;
    if (command.command_type === "patches.apply") {
      const appliedChanges = await this.worktreeManager.applyPatch(worktreePath, patch.changes);
      nextPatch = this.store.savePatch({
        ...patch,
        applied_at: timestamp,
        changes: appliedChanges,
        rollback_available: true,
        status: "applied",
        updated_at: timestamp
      });
    } else {
      nextPatch = this.store.savePatch({
        ...patch,
        discarded_at: timestamp,
        status: "discarded",
        updated_at: timestamp
      });
    }

    updatedThread = this.refreshThreadState(updatedThread.thread_id, {
      updatedAt: timestamp
    });

    await this.publishEvent({
      threadId: updatedThread.thread_id,
      turnId: nextPatch.turn_id,
      timestamp,
      eventType: "patch.resolved",
      payload: {
        patch_id: nextPatch.patch_id,
        status: nextPatch.status
      }
    });

    const binding = this.patchBindings.get(nextPatch.patch_id);
    if (binding) {
      binding.resolve({
        patch_id: nextPatch.patch_id,
        action: command.command_type === "patches.apply" ? "apply" : "discard"
      });
    }

    await this.maybeSyncThread(updatedThread.thread_id);

    return {
      patch: nextPatch,
      thread: updatedThread
    };
  }

  async rollbackPatch(command: RollbackPatchCommand): Promise<RollbackPatchResponse> {
    const patch = this.store.getPatch(command.patch_id);
    if (!patch) {
      throw new Error("unknown_patch");
    }
    if (patch.status !== "applied" || !patch.rollback_available) {
      throw new Error("patch_not_rollbackable");
    }

    const thread = this.store.getThread(patch.thread_id);
    if (!thread) {
      throw new Error("unknown_thread");
    }
    if (!thread.worktree_path) {
      throw new Error("patch_worktree_unavailable");
    }

    await this.worktreeManager.rollbackPatch(thread.worktree_path, patch.changes);
    const updatedPatch = this.store.savePatch({
      ...patch,
      rollback_available: false,
      updated_at: nowIso()
    });
    this.store.appendAudit({
      category: "patch_rollback",
      project_id: updatedPatch.project_id,
      thread_id: updatedPatch.thread_id,
      turn_id: updatedPatch.turn_id,
      message: `Rolled back patch ${updatedPatch.patch_id}.`
    });
    await this.touchNativeThread(thread, {
      markUserEvent: true,
      force: true
    });
    await this.maybeSyncThread(thread.thread_id);

    return {
      deduplicated: false,
      patch: updatedPatch
    };
  }

  private async executeTurn(turnId: string) {
    const turn = this.store.getTurn(turnId);
    if (!turn || this.executions.has(turnId)) {
      return;
    }

    const thread = this.store.getThread(turn.thread_id);
    const project = thread ? this.store.getProject(thread.project_id) : undefined;
    if (!thread || !project) {
      await this.failTurn(turn, {
        code: "runtime_state_missing",
        message: "The gateway could not load the thread runtime context.",
        retryable: true
      });
      return;
    }

    const timestamp = nowIso();
    const worktreePath =
      thread.worktree_path ??
      (await this.worktreeManager.ensureThreadWorktree(project, thread));
    const startedThread = this.store.saveThread({
      ...thread,
      active_turn_id: turn.turn_id,
      pending_turn_ids: removePendingTurn(thread, turn.turn_id),
      state: "running",
      worktree_path: worktreePath,
      updated_at: timestamp
    });
    const startedTurn = this.store.saveTurn({
      ...turn,
      state: "started",
      updated_at: timestamp
    });
    this.store.saveLiveState(startedThread.thread_id, {
      turn_id: startedTurn.turn_id,
      status: "running",
      detail: "Turn started",
      assistant_text: "",
      details: [],
      updated_at: timestamp,
      awaiting_native_commit: false
    });
    this.store.appendAudit({
      category: "adapter_lifecycle",
      project_id: startedTurn.project_id,
      thread_id: startedTurn.thread_id,
      turn_id: startedTurn.turn_id,
      message: "turn_execution_started",
      details: {
        adapter: this.adapter.kind,
        worktree_path: worktreePath
      }
    });
    await this.publishEvent({
      threadId: startedThread.thread_id,
      turnId: startedTurn.turn_id,
      timestamp,
      eventType: "turn.started",
      payload: {
        worktree_path: worktreePath
      }
    });

    const executionPromise = this.adapter.runTurn(
      {
        project,
        thread: startedThread,
        turn: startedTurn,
        worktreePath,
        turnInput: this.turnInputs.get(turnId)
      },
      this.createAdapterCallbacks(startedThread.thread_id, startedTurn.turn_id)
    );

    this.executions.set(turnId, {
      interrupt: async (reason?: string) => {
        try {
          const execution = await executionPromise;
          await execution.interrupt(reason);
        } catch {
          // The adapter failed before exposing an interrupt handle.
        }
      }
    });

    try {
      const execution = await executionPromise;
      const currentTurn = this.store.getTurn(turnId);
      if (currentTurn && !isTerminalTurnState(currentTurn.state)) {
        this.executions.set(turnId, execution);
      } else {
        this.executions.delete(turnId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failTurn(startedTurn, {
        code: "adapter_exception",
        message,
        retryable: true
      });
    }
  }

  private createAdapterCallbacks(
    threadId: string,
    turnId: string
  ): AdapterCallbacks {
    return {
      onProgress: async (input) => {
        const turn = this.store.getTurn(turnId);
        if (!turn || isTerminalTurnState(turn.state)) {
          return;
        }

        const timestamp = nowIso();
        const updatedTurn = this.store.saveTurn({
          ...turn,
          state: progressToTurnState(turn.state, input),
          updated_at: timestamp
        });
        const thread = this.refreshThreadState(threadId, {
          forceState: "running",
          updatedAt: timestamp
        });
        this.updateLiveState(thread.thread_id, {
          assistantText: input.step === "assistant_message" ? input.message : undefined,
          detail: input.message,
          status: input.channel ?? "running",
          timestamp,
          turnId,
          detailKind: input.channel ?? "status",
          title: input.step,
          body: input.message
        });
        await this.publishEvent({
          threadId: thread.thread_id,
          turnId,
          timestamp,
          eventType: "turn.progress",
          payload: {
            channel: input.channel ?? "status",
            message: input.message,
            resumed: input.resumed ?? false,
            step: input.step,
            turn_state: updatedTurn.state
          }
        });
      },
      onThreadBinding: async (input) => {
        const thread = this.store.getThread(threadId);
        if (!thread) {
          return;
        }
        this.store.saveThread({
          ...thread,
          adapter_kind: input.kind === "mock" ? thread.adapter_kind : "codex-app-server",
          adapter_thread_ref: input.thread_ref,
          updated_at: nowIso()
        });
      },
      onApprovalRequest: async (input) => {
        const thread = this.store.getThread(threadId);
        if (!thread) {
          throw new Error("unknown_thread");
        }

        const timestamp = nowIso();
        const approvalId = createUlid();
        const deferred = createDeferred<ApprovalResolution>();
        this.approvalBindings.set(approvalId, deferred);

        const approval = this.store.saveApproval({
          approval_id: approvalId,
          project_id: thread.project_id,
          thread_id: thread.thread_id,
          turn_id: turnId,
          kind: input.kind,
          source: input.native_ref ? "native" : "legacy_gateway",
          native_ref: input.native_ref,
          title: input.command,
          status: "requested",
          reason: input.reason,
          requested_at: timestamp,
          expires_at: input.expires_at ?? this.policyEngine.buildApprovalExpiry(timestamp),
          recoverable: true,
          command: input.command,
          cwd: input.cwd,
          permissions: input.permissions,
          available_decisions: (() => {
            const decisions = input.available_decisions?.flatMap((value) =>
              typeof value === "string" ? [value] : []
            );
            return decisions && decisions.length > 0
              ? decisions
              : ["approved", "rejected"];
          })()
        });

        this.store.saveTurn({
          ...(this.store.getTurn(turnId) ?? {
            project_id: thread.project_id,
            thread_id: thread.thread_id,
            turn_id: turnId,
            prompt: "",
            state: "waiting_approval",
            created_at: timestamp,
            updated_at: timestamp
          }),
          state: "waiting_approval",
          updated_at: timestamp
        });
        const nextThread = this.refreshThreadState(thread.thread_id, {
          forceState: "waiting_approval",
          updatedAt: timestamp
        });
        this.updateLiveState(thread.thread_id, {
          detail: input.reason,
          status: "waiting_approval",
          timestamp,
          turnId,
          detailKind: "status",
          title: "Approval required",
          body: input.reason
        });
        await this.publishEvent({
          threadId: nextThread.thread_id,
          turnId,
          timestamp,
          eventType: "approval.required",
          payload: {
            approval_id: approval.approval_id,
            kind: approval.kind,
            native_ref: approval.native_ref,
            reason: approval.reason
          }
        });

        try {
          return await deferred.promise;
        } finally {
          this.approvalBindings.delete(approvalId);
        }
      },
      onNativeRequest: async (input) => {
        const thread = this.store.getThread(threadId);
        if (!thread) {
          throw new Error("unknown_thread");
        }

        const timestamp = nowIso();
        const requestId = createUlid();
        const deferred = createDeferred<NativeRequestResolution>();
        this.nativeRequestBindings.set(requestId, deferred);

        const request = this.store.saveNativeRequest({
          native_request_id: requestId,
          project_id: thread.project_id,
          thread_id: thread.thread_id,
          turn_id: turnId,
          item_id: input.item_id,
          kind: input.kind,
          source: "native",
          native_ref: input.native_ref,
          title: input.title,
          prompt: input.prompt,
          status: "requested",
          payload: input.payload,
          requested_at: timestamp
        });

        this.store.saveTurn({
          ...(this.store.getTurn(turnId) ?? {
            project_id: thread.project_id,
            thread_id: thread.thread_id,
            turn_id: turnId,
            prompt: "",
            state: "waiting_input",
            created_at: timestamp,
            updated_at: timestamp
          }),
          state: "waiting_input",
          updated_at: timestamp
        });
        const nextThread = this.refreshThreadState(thread.thread_id, {
          forceState: "waiting_input",
          updatedAt: timestamp
        });
        this.updateLiveState(thread.thread_id, {
          detail: request.prompt ?? request.title ?? "Native request pending",
          status: "waiting_input",
          timestamp,
          turnId,
          detailKind: "status",
          title: request.title ?? "Native request",
          body: request.prompt
        });
        await this.publishEvent({
          threadId: nextThread.thread_id,
          turnId,
          timestamp,
          eventType: "native_request.required",
          payload: {
            kind: request.kind,
            native_ref: request.native_ref,
            native_request_id: request.native_request_id,
            title: request.title
          }
        });

        try {
          return await deferred.promise;
        } finally {
          this.nativeRequestBindings.delete(requestId);
        }
      },
      onNativeThreadUpdated: async (input) => {
        const thread = this.store.getThread(threadId);
        if (!thread) {
          return;
        }

        this.store.saveThread({
          ...thread,
          native_archived:
            typeof input?.archived === "boolean" ? input.archived : thread.native_archived,
          native_title: input?.title ?? thread.native_title,
          native_status_type: input?.native_status_type ?? thread.native_status_type,
          native_active_flags: input?.native_active_flags ?? thread.native_active_flags,
          native_token_usage: input?.native_token_usage ?? thread.native_token_usage,
          updated_at: nowIso()
        });
      },
      onNativeApprovalResolved: async (input) => {
        const approval = this.store
          .listApprovals(threadId)
          .find((candidate) => candidate.native_ref === input.native_ref);
        if (!approval || approval.status !== "requested") {
          return;
        }

        this.store.saveApproval({
          ...approval,
          resolved_at: nowIso(),
          status: input.status
        });
        this.refreshThreadState(threadId);
      },
      onTestsFinished: async (input) => {
        const timestamp = nowIso();
        this.updateLiveState(threadId, {
          detail: input.summary,
          status: "testing",
          timestamp,
          turnId,
          detailKind: "testing",
          title: "Tests",
          body: input.summary
        });
        await this.publishEvent({
          threadId,
          turnId,
          timestamp,
          eventType: "turn.tests_finished",
          payload: {
            duration_ms: input.duration_ms,
            status: input.status,
            summary: input.summary
          }
        });
      },
      onPatchReady: async (input) => {
        const thread = this.store.getThread(threadId);
        if (!thread) {
          throw new Error("unknown_thread");
        }

        const timestamp = nowIso();
        const patchId = createUlid();
        const deferred = createDeferred<PatchDecision>();
        this.patchBindings.set(patchId, deferred);

        const patch = this.store.savePatch({
          patch_id: patchId,
          project_id: thread.project_id,
          thread_id: thread.thread_id,
          turn_id: turnId,
          status: "generated",
          summary: input.summary,
          files: input.files,
          test_summary: input.test_summary ?? undefined,
          changes: input.changes,
          rollback_available: false,
          created_at: timestamp,
          updated_at: timestamp
        });
        const nextThread = this.refreshThreadState(thread.thread_id, {
          forceState: "needs_review",
          updatedAt: timestamp
        });
        this.updateLiveState(thread.thread_id, {
          detail: input.summary,
          status: "needs_review",
          timestamp,
          turnId,
          detailKind: "editing",
          title: "Patch ready",
          body: input.summary
        });
        await this.publishEvent({
          threadId: nextThread.thread_id,
          turnId,
          timestamp,
          eventType: "patch.ready",
          payload: {
            managed_by_adapter: input.managed_by_adapter ?? false,
            patch_id: patch.patch_id,
            summary: patch.summary
          }
        });

        try {
          return await deferred.promise;
        } finally {
          this.patchBindings.delete(patchId);
        }
      },
      onPatchResolved: async (input) => {
        const patch = this.store.getPatch(input.patch_id);
        if (!patch) {
          return;
        }

        this.store.savePatch({
          ...patch,
          changes: input.changes ?? patch.changes,
          rollback_available: input.rollback_available ?? patch.rollback_available,
          status: patchStatusFromAction(input.action),
          updated_at: nowIso()
        });
        this.refreshThreadState(threadId);
      },
      onCompleted: async (summary) => {
        const timestamp = nowIso();
        const turn = this.store.getTurn(turnId);
        if (!turn) {
          return;
        }

        this.store.saveTurn({
          ...turn,
          state: "completed",
          summary,
          updated_at: timestamp
        });
        const thread = this.refreshThreadState(threadId, {
          clearActiveTurn: true,
          forceState: "completed",
          updatedAt: timestamp
        });
        this.store.saveLiveState(thread.thread_id, {
          turn_id: turnId,
          status: "completed",
          detail: summary,
          assistant_text: "",
          details: this.store.getLiveState(thread.thread_id)?.details ?? [],
          updated_at: timestamp,
          awaiting_native_commit: false
        });
        this.executions.delete(turnId);
        this.turnInputs.delete(turnId);
        await this.publishEvent({
          threadId: thread.thread_id,
          turnId,
          timestamp,
          eventType: "turn.completed",
          payload: {
            summary
          }
        });
        await this.maybeSyncThread(thread.thread_id);
      },
      onFailed: async (input) => {
        const turn = this.store.getTurn(turnId);
        if (!turn) {
          return;
        }
        await this.failTurn(turn, input);
      },
      onDiagnostic: async (input) => {
        this.store.appendAudit({
          category: "adapter_diagnostic",
          thread_id: threadId,
          turn_id: turnId,
          message: input.message,
          details: input.details
        });
      }
    };
  }

  private async failTurn(
    turn: TurnRecord,
    input: {
      code: string;
      message: string;
      retryable?: boolean;
      interrupted?: boolean;
    }
  ) {
    const timestamp = nowIso();
    const status = input.interrupted ? "interrupted" : "failed";

    this.store.saveTurn({
      ...turn,
      state: status,
      updated_at: timestamp
    });
    const thread = this.refreshThreadState(turn.thread_id, {
      clearActiveTurn: true,
      forceState: status === "interrupted" ? "interrupted" : "failed",
      updatedAt: timestamp
    });
    this.store.saveLiveState(thread.thread_id, {
      turn_id: turn.turn_id,
      status,
      detail: input.message,
      assistant_text: "",
      details: this.store.getLiveState(thread.thread_id)?.details ?? [],
      updated_at: timestamp,
      awaiting_native_commit: false
    });
    this.store.appendAudit({
      category: "adapter_lifecycle",
      project_id: turn.project_id,
      thread_id: turn.thread_id,
      turn_id: turn.turn_id,
      message: "turn_failed",
      details: {
        code: input.code,
        interrupted: input.interrupted ?? false,
        message: input.message,
        retryable: input.retryable ?? false
      }
    });
    this.executions.delete(turn.turn_id);
    this.turnInputs.delete(turn.turn_id);
    await this.publishEvent({
      threadId: thread.thread_id,
      turnId: turn.turn_id,
      timestamp,
      eventType: "turn.failed",
      payload: {
        error_code: input.code,
        interrupted: input.interrupted ?? false,
        message: input.message,
        retryable: input.retryable ?? false
      }
    });
    await this.maybeSyncThread(thread.thread_id);
  }

  private refreshThreadState(
    threadId: string,
    input: {
      clearActiveTurn?: boolean;
      forceState?: ThreadSnapshot["state"];
      updatedAt?: string;
    } = {}
  ) {
    const thread = this.store.getThread(threadId);
    if (!thread) {
      throw new Error("unknown_thread");
    }

    const pendingApprovals = this.store
      .listApprovals(threadId)
      .filter((approval) => approval.status === "requested");
    const pendingNativeRequests = this.store
      .listNativeRequests(threadId)
      .filter((request) => request.status === "requested");
    const pendingPatches = this.store
      .listPatches(threadId)
      .filter((patch) => patch.status !== "applied" && patch.status !== "discarded");

    const activeTurnId = input.clearActiveTurn ? null : thread.active_turn_id;
    const activeTurn = activeTurnId ? this.store.getTurn(activeTurnId) : undefined;

    let state: ThreadSnapshot["state"];
    if (thread.state === "archived" || thread.native_archived) {
      state = "archived";
    } else if (input.forceState) {
      state = input.forceState;
    } else if (pendingNativeRequests.length > 0) {
      state = "waiting_input";
    } else if (pendingApprovals.length > 0) {
      state = "waiting_approval";
    } else if (pendingPatches.length > 0) {
      state = "needs_review";
    } else if (activeTurnId && this.executions.has(activeTurnId)) {
      state = "running";
    } else if (activeTurn?.state === "interrupted") {
      state = "interrupted";
    } else if (activeTurn?.state === "failed") {
      state = "failed";
    } else if (activeTurn?.state === "completed") {
      state = "completed";
    } else {
      const turns = this.store.listTurns(threadId);
      const latestTurn = turns.at(-1);
      if (latestTurn?.state === "failed") {
        state = "failed";
      } else if (latestTurn?.state === "interrupted") {
        state = "interrupted";
      } else if (latestTurn?.state === "completed") {
        state = "completed";
      } else {
        state = "ready";
      }
    }

    return this.store.saveThread({
      ...thread,
      active_turn_id: activeTurnId,
      pending_approval_ids: pendingApprovals.map((approval) => approval.approval_id),
      state,
      updated_at: input.updatedAt ?? nowIso()
    });
  }

  private updateLiveState(
    threadId: string,
    input: {
      assistantText?: string;
      body?: string;
      detail?: string;
      detailKind:
        | "editing"
        | "status"
        | "testing"
        | "thinking"
        | "tool_call"
        | "tool_result";
      status: string;
      timestamp: string;
      title?: string;
      turnId: string;
    }
  ) {
    const current = this.store.getLiveState(threadId);
    const details = [
      ...(current?.details ?? []),
      {
        detail_id: createUlid(),
        timestamp: input.timestamp,
        kind: input.detailKind,
        title: input.title,
        body: input.body ?? input.detail,
        status: input.status,
        mono: false
      }
    ].slice(-24);

    const nextState: CodexLiveState = {
      turn_id: input.turnId,
      status: input.status,
      detail: input.detail,
      assistant_text: input.assistantText ?? current?.assistant_text ?? "",
      details,
      updated_at: input.timestamp,
      awaiting_native_commit: false
    };
    this.store.saveLiveState(threadId, nextState);
    return nextState;
  }

  private async publishEvent(input: {
    eventType: string;
    payload: Record<string, unknown>;
    threadId: string;
    timestamp?: string;
    turnId?: string;
  }) {
    const thread = this.store.getThread(input.threadId);
    if (!thread) {
      throw new Error("unknown_thread");
    }

    const eventTimestamp = input.timestamp ?? nowIso();
    const event: GatewayEvent = {
      event_id: createUlid(),
      stream_seq: this.store.nextStreamSeq(thread.thread_id),
      schema_version: CURRENT_SCHEMA_VERSION,
      event_type: input.eventType,
      project_id: thread.project_id,
      thread_id: thread.thread_id,
      turn_id: input.turnId,
      timestamp: eventTimestamp,
      payload: input.payload
    };
    this.store.appendEvent(event);
    this.store.saveThread({
      ...thread,
      last_stream_seq: event.stream_seq,
      updated_at: eventTimestamp
    });
    this.sessionHub.publish(event);
    return event;
  }

  private async maybeSyncThread(threadId: string) {
    if (!this.syncThreadNow) {
      return;
    }

    try {
      await this.syncThreadNow(threadId);
    } catch {
      // Native sync is best-effort while recovery is still in progress.
    }
  }

  private async touchNativeThread(
    thread: ThreadSnapshot | undefined,
    input: {
      markUserEvent?: boolean;
      force?: boolean;
    } = {}
  ) {
    if (!thread || !this.nativeThreadMarker) {
      return false;
    }

    const nativeThreadId = thread.adapter_thread_ref ?? thread.thread_id;
    if (!nativeThreadId) {
      return false;
    }

    try {
      return await this.nativeThreadMarker.touchThread(nativeThreadId, input);
    } catch {
      return false;
    }
  }
}
