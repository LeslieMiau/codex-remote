"use client";

import { SharedThreadWorkspace } from "./shared-thread-workspace-refreshed";

interface LegacyThreadWorkspaceProps {
  threadId: string;
}

export function LegacyThreadWorkspace({ threadId }: LegacyThreadWorkspaceProps) {
  return <SharedThreadWorkspace threadId={threadId} />;
}

export default LegacyThreadWorkspace;
