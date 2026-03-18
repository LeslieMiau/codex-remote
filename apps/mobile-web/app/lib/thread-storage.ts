const STORAGE_KEY = "codex-remote:last-active-thread";

export function getStoredLastActiveThread() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredLastActiveThread(threadId: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, threadId);
  } catch {
    // Ignore storage failures in the restored placeholder.
  }
}
