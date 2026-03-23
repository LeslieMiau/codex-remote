"use client";

import { SharedThreadWorkspace } from "./shared-thread-workspace-refreshed";

interface ThreadWorkspaceProps {
  threadId: string;
}

export function ThreadWorkspace({ threadId }: ThreadWorkspaceProps) {
  return <SharedThreadWorkspace threadId={threadId} />;
}

export default ThreadWorkspace;
