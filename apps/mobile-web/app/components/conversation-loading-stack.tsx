"use client";

import type { ReactNode } from "react";

interface ConversationLoadingStackProps {
  actions?: ReactNode;
  note?: string | null;
  status: string;
}

export function ConversationLoadingStack({
  actions,
  note,
  status
}: ConversationLoadingStackProps) {
  return (
    <div className="codex-page-card">
      <p className="section-label">{status}</p>
      {note ? <p>{note}</p> : null}
      {actions ? <div className="composer-row">{actions}</div> : null}
    </div>
  );
}
