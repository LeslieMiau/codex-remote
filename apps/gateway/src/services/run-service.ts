import type {
  ApplyPatchCommand,
  ApproveCommand,
  DiscardPatchCommand,
  RejectCommand,
  RespondNativeRequestCommand,
  RollbackPatchCommand,
  SharedRunRequestBody,
  StartTurnResponse
} from "@codex-remote/protocol";

import type { GatewayRepositories } from "../repositories/gateway-repositories";
import type { ThreadRuntimeManager } from "../runtime/thread-runtime-manager";
import { GatewayReadModelService } from "./read-model-service";

function localThreadActionConflict(
  repositories: GatewayRepositories,
  threadId: string
) {
  const thread = repositories.threads.get(threadId);
  if (!thread) {
    return null;
  }

  const pendingApprovals = repositories.approvals
    .listByThread(threadId)
    .filter((approval) => approval.status === "requested").length;
  if (pendingApprovals > 0) {
    return "approval_required";
  }

  const pendingNativeRequests = repositories.nativeRequests
    .listByThread(threadId)
    .filter((nativeRequest) => nativeRequest.status === "requested").length;
  if (pendingNativeRequests > 0) {
    return "input_required";
  }

  const pendingPatches = repositories.patches
    .listByThread(threadId)
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

export class GatewayRunService {
  constructor(
    private readonly repositories: GatewayRepositories,
    private readonly readModels: GatewayReadModelService,
    private readonly manager: ThreadRuntimeManager
  ) {}

  async startTurn(input: {
    threadId: string;
    body: SharedRunRequestBody;
  }): Promise<StartTurnResponse> {
    const codexThread = await this.readModels.getThread(input.threadId);
    if (!codexThread) {
      throw new Error("unknown_thread");
    }

    if (codexThread.archived) {
      throw new Error("archived_thread");
    }

    const conflict = localThreadActionConflict(this.repositories, codexThread.thread_id);
    if (conflict) {
      throw new Error(conflict);
    }

    return this.manager.startTurn({
      actor_id: input.body.actor_id,
      request_id: input.body.request_id,
      prompt: input.body.prompt,
      input_items: input.body.input_items,
      collaboration_mode: input.body.collaboration_mode,
      thread_id: codexThread.thread_id,
      command_type: "turns.start"
    });
  }

  resolveApproval(command: ApproveCommand | RejectCommand) {
    return this.manager.resolveApproval(command);
  }

  resolvePatch(command: ApplyPatchCommand | DiscardPatchCommand) {
    return this.manager.resolvePatch(command);
  }

  resolveNativeRequest(command: RespondNativeRequestCommand) {
    return this.manager.resolveNativeRequest(command);
  }

  rollbackPatch(command: RollbackPatchCommand) {
    return this.manager.rollbackPatch(command);
  }
}
