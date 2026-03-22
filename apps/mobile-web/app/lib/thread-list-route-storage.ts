export type ThreadListRoute = "/projects" | "/queue";

const STORAGE_KEY = "codex-remote:last-thread-list-route";

function isThreadListRoute(value: string | null): value is ThreadListRoute {
  return value === "/projects" || value === "/queue";
}

export function getStoredThreadListRoute(): ThreadListRoute {
  if (typeof window === "undefined") {
    return "/projects";
  }

  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isThreadListRoute(value) ? value : "/projects";
  } catch {
    return "/projects";
  }
}

export function setStoredThreadListRoute(route: ThreadListRoute) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, route);
  } catch {
    // Ignore storage failures and keep navigation usable.
  }
}
