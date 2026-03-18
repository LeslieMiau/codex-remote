"use client";

import { SharedThreadWorkspace } from "./shared-thread-workspace";

interface ThreadWorkspaceProps {
  threadId: string;
}

export function ThreadWorkspace({ threadId }: ThreadWorkspaceProps) {
  return <SharedThreadWorkspace threadId={threadId} />;
}

export default ThreadWorkspace;
