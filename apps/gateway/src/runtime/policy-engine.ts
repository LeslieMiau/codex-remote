import type { ApprovalRequest, SecurityPolicy } from "@codex-remote/protocol";
import { DEFAULT_DELIVERY_POLICY, DEFAULT_SECURITY_POLICY } from "@codex-remote/protocol";

import { addMinutes, nowIso } from "../lib/time";

interface ApprovalResolutionCommand {
  command_type?: string;
  confirmed?: boolean;
}

function resolveApprovalDecision(command: ApprovalResolutionCommand): string | null {
  if (command.command_type === "approvals.approve") {
    return "approved";
  }
  if (command.command_type === "approvals.reject") {
    return "rejected";
  }
  return null;
}

export class PolicyEngine {
  constructor(
    readonly securityPolicy: SecurityPolicy = DEFAULT_SECURITY_POLICY
  ) {}

  buildApprovalExpiry(requestedAt: string) {
    return addMinutes(requestedAt, DEFAULT_DELIVERY_POLICY.approval_ttl_minutes);
  }

  assertApprovalResolution(
    approval: ApprovalRequest,
    command: ApprovalResolutionCommand
  ) {
    if (approval.status !== "requested") {
      throw new Error("approval_not_pending");
    }

    if (approval.expires_at && Date.parse(approval.expires_at) <= Date.parse(nowIso())) {
      throw new Error("approval_expired");
    }

    const decision = resolveApprovalDecision(command);
    if (!decision) {
      return;
    }

    const allowedDecisions = new Set(
      (approval.available_decisions ?? ["approved", "rejected"]).map((value) =>
        value.toLowerCase()
      )
    );
    if (!allowedDecisions.has(decision)) {
      throw new Error("approval_decision_not_allowed");
    }

    if (
      decision === "approved" &&
      approval.kind === "destructive" &&
      this.securityPolicy.requires_second_confirmation_for_destructive_commands &&
      command.confirmed !== true
    ) {
      throw new Error("approval_confirmation_required");
    }
  }
}
