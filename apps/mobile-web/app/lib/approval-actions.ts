import type { ApprovalRequest } from "@codex-remote/protocol";

import {
  buildApprovalDecisionPresentation,
  type ApprovalDecisionPresentation
} from "./approval-decisions";
import { localize, type Locale } from "./locale";

export interface ApprovalActionOption extends ApprovalDecisionPresentation {
  confirmationBody: string | null;
  confirmationTitle: string | null;
}

function normalizeApprovalDecisions(approval: ApprovalRequest) {
  const rawDecisions =
    approval.available_decisions && approval.available_decisions.length > 0
      ? approval.available_decisions
      : ["approved", "rejected"];

  const deduped = new Set<string>();
  const normalized: string[] = [];
  for (const value of rawDecisions) {
    const trimmed = value.trim();
    if (!trimmed || deduped.has(trimmed)) {
      continue;
    }
    deduped.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized.length > 0 ? normalized : ["approved", "rejected"];
}

function buildConfirmationCopy(
  locale: Locale,
  approval: ApprovalRequest,
  decision: ApprovalDecisionPresentation
) {
  if (decision.approved && approval.kind === "destructive") {
    return {
      confirmationBody: localize(locale, {
        zh: "批准后，Codex 会继续执行这条高风险操作。请确认你确实要继续。",
        en: "Approving will let Codex continue with this high-risk action. Confirm that you want to proceed."
      }),
      confirmationTitle: localize(locale, {
        zh: "确认批准这条高风险请求？",
        en: "Approve this high-risk request?"
      })
    };
  }

  if (!decision.approved) {
    return {
      confirmationBody:
        decision.kind === "cancel"
          ? localize(locale, {
              zh: "取消后，Codex 不会继续这条待审批操作，本次请求也会结束等待。",
              en: "Canceling will stop this approval from continuing and end the current wait."
            })
          : localize(locale, {
              zh: "拒绝后，Codex 不会继续执行这条需要批准的操作。",
              en: "Rejecting means Codex will not continue with this approval-gated action."
            }),
      confirmationTitle:
        decision.kind === "cancel"
          ? localize(locale, {
              zh: "取消这条批准请求？",
              en: "Cancel this approval request?"
            })
          : localize(locale, {
              zh: "拒绝这条批准请求？",
              en: "Reject this approval request?"
            })
    };
  }

  return {
    confirmationBody: null,
    confirmationTitle: null
  };
}

export function buildApprovalActionOptions(
  locale: Locale,
  approval: ApprovalRequest | null
): ApprovalActionOption[] {
  if (!approval) {
    return [];
  }

  return normalizeApprovalDecisions(approval).map((rawDecision) => {
    const decision = buildApprovalDecisionPresentation(locale, rawDecision);
    return {
      ...decision,
      ...buildConfirmationCopy(locale, approval, decision)
    };
  });
}
