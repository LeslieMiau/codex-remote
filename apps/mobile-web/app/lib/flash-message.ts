interface ThreadFlashInput {
  kind?: string;
  message: string;
  threadId: string;
}

const messages = new Map<string, string>();

export function consumeThreadFlashMessage(threadId: string) {
  const value = messages.get(threadId) ?? null;
  messages.delete(threadId);
  return value;
}

export function writeThreadFlashMessage(input: ThreadFlashInput) {
  messages.set(input.threadId, input.message);
}
