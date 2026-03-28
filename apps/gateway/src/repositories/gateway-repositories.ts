import type {
  ApprovalRequest,
  CodexLiveState,
  DeduplicationKey,
  GatewayEvent,
  NativeRequestRecord,
  PatchRecord,
  ProjectSummary,
  ThreadSnapshot,
  TurnRecord
} from "@codex-remote/protocol";

import { GatewayStore } from "../lib/store";

export interface ProjectRepository {
  get(projectId: string): ProjectSummary | undefined;
  save(project: ProjectSummary): ProjectSummary;
}

export interface ThreadRepository {
  get(threadId: string): ThreadSnapshot | undefined;
  getByExternalId(threadId: string): ThreadSnapshot | undefined;
  list(projectId?: string): ThreadSnapshot[];
  save(thread: ThreadSnapshot): ThreadSnapshot;
  delete(threadId: string): void;
}

export interface TurnRepository {
  get(turnId: string): TurnRecord | undefined;
  listByThread(threadId: string): TurnRecord[];
  save(turn: TurnRecord): TurnRecord;
}

export interface ApprovalRepository {
  get(approvalId: string): ApprovalRequest | undefined;
  listByThread(threadId: string): ApprovalRequest[];
  save(approval: ApprovalRequest): ApprovalRequest;
}

export interface PatchRepository {
  get(patchId: string): PatchRecord | undefined;
  listByThread(threadId: string): PatchRecord[];
  save(patch: PatchRecord): PatchRecord;
}

export interface NativeRequestRepository {
  get(nativeRequestId: string): NativeRequestRecord | undefined;
  listByThread(threadId: string): NativeRequestRecord[];
  save(request: NativeRequestRecord): NativeRequestRecord;
}

export interface EventRepository {
  listByThread(threadId: string, afterSeq?: number, limit?: number): GatewayEvent[];
  append(event: GatewayEvent): void;
  nextStreamSeq(threadId: string): number;
}

export interface LiveStateRepository {
  get(threadId: string): CodexLiveState | undefined;
  save(threadId: string, state: CodexLiveState): CodexLiveState;
  clear(threadId: string): void;
}

export interface CommandResultRepository {
  get<T>(key: DeduplicationKey): T | undefined;
  save<T>(key: DeduplicationKey, result: T): void;
}

export interface AuditRepository {
  append(input: Parameters<GatewayStore["appendAudit"]>[0]): void;
}

export interface GatewayRepositories {
  projects: ProjectRepository;
  threads: ThreadRepository;
  turns: TurnRepository;
  approvals: ApprovalRepository;
  patches: PatchRepository;
  nativeRequests: NativeRequestRepository;
  events: EventRepository;
  liveState: LiveStateRepository;
  commandResults: CommandResultRepository;
  audit: AuditRepository;
}

export function createGatewayRepositories(
  store: GatewayStore
): GatewayRepositories {
  return {
    projects: {
      get(projectId) {
        return store.getProject(projectId);
      },
      save(project) {
        return store.saveProject(project);
      }
    },
    threads: {
      get(threadId) {
        return store.getThread(threadId);
      },
      getByExternalId(threadId) {
        return store.getThread(threadId) ?? store.findThreadByAdapterRef(threadId);
      },
      list(projectId) {
        return store.listThreads(projectId);
      },
      save(thread) {
        return store.saveThread(thread);
      },
      delete(threadId) {
        store.deleteThread(threadId);
      }
    },
    turns: {
      get(turnId) {
        return store.getTurn(turnId);
      },
      listByThread(threadId) {
        return store.listTurns(threadId);
      },
      save(turn) {
        return store.saveTurn(turn);
      }
    },
    approvals: {
      get(approvalId) {
        return store.getApproval(approvalId);
      },
      listByThread(threadId) {
        return store.listApprovals(threadId);
      },
      save(approval) {
        return store.saveApproval(approval);
      }
    },
    patches: {
      get(patchId) {
        return store.getPatch(patchId);
      },
      listByThread(threadId) {
        return store.listPatches(threadId);
      },
      save(patch) {
        return store.savePatch(patch);
      }
    },
    nativeRequests: {
      get(nativeRequestId) {
        return store.getNativeRequest(nativeRequestId);
      },
      listByThread(threadId) {
        return store.listNativeRequests(threadId);
      },
      save(request) {
        return store.saveNativeRequest(request);
      }
    },
    events: {
      listByThread(threadId, afterSeq = 0, limit = 500) {
        return store.listEvents(threadId, afterSeq, limit);
      },
      append(event) {
        store.appendEvent(event);
      },
      nextStreamSeq(threadId) {
        return store.nextStreamSeq(threadId);
      }
    },
    liveState: {
      get(threadId) {
        return store.getLiveState(threadId);
      },
      save(threadId, state) {
        return store.saveLiveState(threadId, state);
      },
      clear(threadId) {
        store.clearLiveState(threadId);
      }
    },
    commandResults: {
      get(key) {
        return store.getCommandResult(key);
      },
      save(key, result) {
        store.saveCommandResult(key, result);
      }
    },
    audit: {
      append(input) {
        store.appendAudit(input);
      }
    }
  };
}
