"use client";

import * as React from "react";
import type { ApprovalActionOption } from "../lib/approval-actions";

interface SharedThreadApprovalActionListProps {
  actions: ApprovalActionOption[];
  isMutating: boolean;
  onSelectAction(action: ApprovalActionOption): void;
}

export function SharedThreadApprovalActionList({
  actions,
  isMutating,
  onSelectAction
}: SharedThreadApprovalActionListProps) {
  return (
    <div className="codex-page-stack">
      {actions.map((action) => (
        <article key={action.id} className="codex-side-item">
          <div className="feed-actions">
            <button
              className={action.buttonClassName}
              disabled={isMutating}
              onClick={() => onSelectAction(action)}
              type="button"
            >
              {action.label}
            </button>
          </div>
          {action.detail ? <p className="codex-inline-note">{action.detail}</p> : null}
          {action.technicalDetail ? (
            <pre className="codex-mono-block">{action.technicalDetail}</pre>
          ) : null}
        </article>
      ))}
    </div>
  );
}
