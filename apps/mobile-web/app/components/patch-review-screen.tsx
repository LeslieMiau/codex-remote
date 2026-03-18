"use client";

import { SharedPatchReviewScreen } from "./shared-patch-review-screen";

interface PatchReviewScreenProps {
  patchId: string;
  threadId: string;
}

export function PatchReviewScreen({ patchId, threadId }: PatchReviewScreenProps) {
  return <SharedPatchReviewScreen patchId={patchId} threadId={threadId} />;
}

export default PatchReviewScreen;
