import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SharedThreadApprovalActionList } from "./shared-thread-approval-action-list";

describe("shared thread approval action list", () => {
  it("renders extension approval options with technical detail", () => {
    const markup = renderToStaticMarkup(
      createElement(SharedThreadApprovalActionList, {
        actions: [
          {
            approved: true,
            buttonClassName: "primary-button",
            confirmationBody: "Confirm the high-risk action.",
            confirmationTitle: "Approve this high-risk request?",
            detail: "Approve this action and add the command below to the allowlist.",
            id: "remember",
            kind: "acceptWithExecpolicyAmendment",
            label: "Approve + remember",
            nativeDecision: {
              acceptWithExecpolicyAmendment: {
                execpolicy_amendment: ["git", "status"]
              }
            },
            technicalDetail: "git status"
          }
        ],
        isMutating: false,
        onSelectAction() {}
      })
    );

    expect(markup).toContain("Approve + remember");
    expect(markup).toContain(
      "Approve this action and add the command below to the allowlist."
    );
    expect(markup).toContain("git status");
  });
});
