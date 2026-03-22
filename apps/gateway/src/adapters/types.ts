import type {
  ApprovalKind,
  NativeRequestKind,
  PatchChange,
  PatchFileSummary,
  ProjectSummary,
  TestRunStatus,
  ThreadSnapshot,
  TurnInputItem,
  TurnProgressChannel,
  TurnRecord
} from "@codex-remote/protocol";

export interface AdapterTurnInput {
  prompt: string;
  input_items?: TurnInputItem[];
}

export interface AdapterTurnContext {
  project: ProjectSummary;
  thread: ThreadSnapshot;
  turn: TurnRecord;
  worktreePath: string;
  turnInput?: AdapterTurnInput;
}

export interface ApprovalResolution {
  approval_id: string;
  status: "approved" | "rejected" | "expired" | "canceled";
  native_decision?: unknown;
}

export interface NativeRequestResolution {
  native_request_id: string;
  status: "responded" | "resolved" | "failed" | "canceled";
  response_payload?: unknown;
}

export interface PatchDecision {
  patch_id: string;
  action: "apply" | "discard";
}

export interface AdapterCallbacks {
  onProgress(input: {
    message: string;
    step?: string;
    resumed?: boolean;
    channel?: TurnProgressChannel;
  }): Promise<void>;
  onThreadBinding(input: {
    kind: "mock" | "codex-app-server";
    thread_ref: string;
  }): Promise<void>;
  onApprovalRequest(input: {
    kind: ApprovalKind;
    reason: string;
    native_ref?: string;
    expires_at?: string;
    command?: string;
    cwd?: string;
    permissions?: Record<string, unknown>;
    available_decisions?: unknown[];
  }): Promise<ApprovalResolution>;
  onNativeRequest(input: {
    kind: NativeRequestKind;
    title: string;
    prompt?: string;
    native_ref: string;
    thread_id?: string;
    turn_id?: string;
    item_id?: string;
    payload?: Record<string, unknown>;
  }): Promise<NativeRequestResolution>;
  onNativeThreadUpdated(input?: {
    reason?: string;
    title?: string;
    archived?: boolean;
    native_status_type?: string;
    native_active_flags?: string[];
    native_token_usage?: Record<string, unknown>;
  }): Promise<void>;
  onNativeApprovalResolved(input: {
    native_ref: string;
    status: ApprovalResolution["status"];
  }): Promise<void>;
  onTestsFinished(input: {
    status: TestRunStatus;
    summary: string;
    duration_ms?: number;
  }): Promise<void>;
  onPatchReady(input: {
    summary: string;
    files: PatchFileSummary[];
    changes: PatchChange[];
    test_summary?: string;
    managed_by_adapter?: boolean;
  }): Promise<PatchDecision>;
  onPatchResolved(input: {
    patch_id: string;
    action: "apply" | "discard";
    changes?: PatchChange[];
    rollback_available?: boolean;
  }): Promise<void>;
  onCompleted(summary: string): Promise<void>;
  onFailed(input: {
    code: string;
    message: string;
    retryable?: boolean;
    interrupted?: boolean;
  }): Promise<void>;
  onDiagnostic(input: {
    message: string;
    details?: Record<string, unknown>;
  }): Promise<void>;
}

export interface AdapterExecution {
  interrupt(reason?: string): Promise<void>;
}

export interface Adapter {
  readonly kind: "mock" | "codex-app-server";
  runTurn(
    context: AdapterTurnContext,
    callbacks: AdapterCallbacks
  ): Promise<AdapterExecution>;
}
