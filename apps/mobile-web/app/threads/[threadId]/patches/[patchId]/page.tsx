import { PatchReviewScreen } from "../../../../components/patch-review-screen";

interface PatchPageProps {
  params: Promise<{ patchId: string; threadId: string }>;
}

export default async function PatchPage({ params }: PatchPageProps) {
  const { patchId, threadId } = await params;
  return <PatchReviewScreen patchId={patchId} threadId={threadId} />;
}
