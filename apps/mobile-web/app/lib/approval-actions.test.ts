import type { ApprovalRequest } from "@codex-remote/protocol";
import { describe, expect, it } from "vitest";

import { buildApprovalActionOptions } from "./approval-actions";

function buildApproval(
  overrides: Partial<ApprovalRequest> = {}
): ApprovalRequest {
  return {
    approval_id: overrides.approval_id ?? "approval-demo",
    kind: overrides.kind ?? "command",
    source: overrides.source ?? "native",
    status: overrides.status ?? "requested",
    reason: overrides.reason ?? "Approval required",
    requested_at: overrides.requested_at ?? "2026-03-31T07:00:00.000Z",
    recoverable: overrides.recoverable ?? true,
    available_decisions: overrides.available_decisions ?? ["approved", "rejected"],
    ...overrides
  };
}

describe("buildApprovalActionOptions", () => {
  it("falls back to approved and rejected for legacy approvals", () => {
    const options = buildApprovalActionOptions(
      "en",
      buildApproval({
        available_decisions: []
      })
    );

    expect(options.map((option) => option.kind)).toEqual(["approved", "rejected"]);
    expect(options[0]?.confirmationTitle).toBeNull();
    expect(options[1]?.confirmationTitle).toBe("Reject this approval request?");
  });

  it("keeps extension decisions and exposes technical detail", () => {
    const options = buildApprovalActionOptions(
      "en",
      buildApproval({
        available_decisions: [
          "{\"acceptWithExecpolicyAmendment\":{\"execpolicy_amendment\":[\"git\",\"status\"]}}",
          "reject"
        ]
      })
    );

    expect(options[0]).toMatchObject({
      approved: true,
      kind: "acceptWithExecpolicyAmendment",
      label: "Approve + remember",
      technicalDetail: "git status"
    });
    expect(options[1]).toMatchObject({
      approved: false,
      kind: "reject"
    });
  });

  it("requires explicit confirmation for destructive approvals before approve-like actions", () => {
    const options = buildApprovalActionOptions(
      "en",
      buildApproval({
        kind: "destructive",
        available_decisions: ["acceptForSession", "reject"]
      })
    );

    expect(options[0]?.confirmationTitle).toBe("Approve this high-risk request?");
    expect(options[0]?.confirmationBody).toContain("high-risk action");
    expect(options[1]?.confirmationTitle).toBe("Reject this approval request?");
  });

  it("deduplicates repeated decision entries", () => {
    const options = buildApprovalActionOptions(
      "en",
      buildApproval({
        available_decisions: ["approved", "approved", "rejected", "rejected"]
      })
    );

    expect(options.map((option) => option.id)).toEqual(["approved", "rejected"]);
  });
});
