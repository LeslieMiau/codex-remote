import { ThreadWorkspace } from "../../components/thread-workspace";

interface ThreadPageProps {
  params: Promise<{ threadId: string }>;
}

export default async function ThreadPage({ params }: ThreadPageProps) {
  const { threadId } = await params;
  return <ThreadWorkspace threadId={threadId} />;
}
