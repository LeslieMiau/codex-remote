import type { GatewayEvent } from "@codex-remote/protocol";

type SessionListener = (event: GatewayEvent) => void;

export class SessionHub {
  private readonly listeners = new Map<string, Set<SessionListener>>();

  publish(event: GatewayEvent) {
    const delivered = new Set<SessionListener>();
    const threadListeners = event.thread_id ? this.listeners.get(event.thread_id) : undefined;
    const globalListeners = this.listeners.get("*");

    for (const bucket of [threadListeners, globalListeners]) {
      for (const listener of bucket ?? []) {
        if (delivered.has(listener)) {
          continue;
        }
        delivered.add(listener);
        listener(event);
      }
    }
  }

  subscribe(threadId: string | null | undefined, listener: SessionListener) {
    const key = threadId && threadId.length > 0 ? threadId : "*";
    const bucket = this.listeners.get(key) ?? new Set<SessionListener>();
    bucket.add(listener);
    this.listeners.set(key, bucket);

    return () => {
      const current = this.listeners.get(key);
      if (!current) {
        return;
      }
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(key);
      }
    };
  }
}
