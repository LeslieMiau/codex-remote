import {
  buildMirroredCodexThread,
  type PendingThreadCounts
} from "@codex-remote/core";
import type {
  CodexMessage,
  CodexOverviewResponse,
  CodexThread,
  CodexTimelineResponse,
  CodexTranscriptPageResponse
} from "@codex-remote/protocol";

import { GatewayStore } from "../lib/store";

interface ReadBridge {
  getOverview(input?: { includeArchived?: boolean }): Promise<CodexOverviewResponse>;
  getThread(threadId: string): Promise<CodexThread | null>;
  getTimeline(threadId: string): Promise<CodexTimelineResponse | null>;
  getTranscriptPage(input: {
    threadId: string;
    cursor?: string;
    limit?: number;
  }): Promise<CodexTranscriptPageResponse | null>;
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

function pendingCounts(store: GatewayStore, threadId: string): PendingThreadCounts {
  return {
    approvals: store
      .listApprovals(threadId)
      .filter((approval) => approval.status === "requested").length,
    native_requests: store
      .listNativeRequests(threadId)
      .filter((nativeRequest) => nativeRequest.status === "requested").length,
    patches: store
      .listPatches(threadId)
      .filter((patch) => patch.status !== "applied" && patch.status !== "discarded").length
  };
}

export class GatewayReadModelService {
  constructor(
    private readonly store: GatewayStore,
    private readonly bridge: ReadBridge
  ) {}

  async getOverview(input?: {
    includeArchived?: boolean;
  }): Promise<CodexOverviewResponse> {
    return this.bridge.getOverview(input);
  }

  async getThread(threadId: string): Promise<CodexThread | null> {
    return (await this.bridge.getThread(threadId)) ?? this.getFallbackThread(threadId);
  }

  async getTimeline(threadId: string): Promise<CodexTimelineResponse | null> {
    return (await this.bridge.getTimeline(threadId)) ?? this.buildFallbackTimeline(threadId);
  }

  async getTranscriptPage(input: {
    threadId: string;
    cursor?: string;
    limit?: number;
  }): Promise<CodexTranscriptPageResponse | null> {
    return (
      (await this.bridge.getTranscriptPage(input)) ??
      this.buildFallbackTranscript(input.threadId, input)
    );
  }

  getFallbackThread(threadId: string): CodexThread | null {
    const thread = this.store.getThread(threadId) ?? this.store.findThreadByAdapterRef(threadId);
    if (!thread) {
      return null;
    }

    const project = this.store.getProject(thread.project_id);
    if (!project) {
      return null;
    }

    const turns = this.store.listTurns(thread.thread_id);
    const state = buildMirroredCodexThread({
      thread,
      projectLabel: projectLabelFromRepoRoot(project.repo_root),
      repoRoot: project.repo_root,
      source: thread.adapter_kind ?? "gateway_fallback",
      syncState: thread.active_turn_id ? "sync_pending" : "sync_failed",
      title: truncateTitle(thread.native_title ?? turns.at(0)?.prompt ?? thread.thread_id),
      pending: pendingCounts(this.store, thread.thread_id),
      degraded: true,
      degradedReason: "recovery_fallback"
    });

    return state;
  }

  private buildFallbackTimeline(threadId: string): CodexTimelineResponse | null {
    const thread = this.getFallbackThread(threadId);
    if (!thread) {
      return null;
    }

    const turns = this.store.listTurns(thread.thread_id);
    const approvals = this.store.listApprovals(thread.thread_id);
    const nativeRequests = this.store.listNativeRequests(thread.thread_id);
    const patches = this.store.listPatches(thread.thread_id);
    const events = this.store.listEvents(thread.thread_id, 0, 2_000);

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

  private buildFallbackTranscript(
    threadId: string,
    input: {
      cursor?: string;
      limit?: number;
    } = {}
  ): CodexTranscriptPageResponse | null {
    const timeline = this.buildFallbackTimeline(threadId);
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
      live_state: this.store.getLiveState(timeline.thread.thread_id),
      next_cursor: hasMore ? messages[startIndex].message_id : undefined,
      has_more: hasMore
    };
  }
}
