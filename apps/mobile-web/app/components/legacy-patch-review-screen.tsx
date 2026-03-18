"use client";

import { SharedPatchReviewScreen } from "./shared-patch-review-screen";

interface LegacyPatchReviewScreenProps {
  patchId: string;
  threadId: string;
}

export function LegacyPatchReviewScreen({
  patchId,
  threadId
}: LegacyPatchReviewScreenProps) {
  return <SharedPatchReviewScreen patchId={patchId} threadId={threadId} />;
}

export default LegacyPatchReviewScreen;
