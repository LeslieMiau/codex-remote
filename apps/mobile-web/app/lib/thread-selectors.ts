export function selectThreadById<T extends { thread_id: string }>(threads: T[], threadId: string) {
  return threads.find((thread) => thread.thread_id === threadId) ?? null;
}
