export type InputFocusFilter = "all" | "desktop" | "replyable";

const STORAGE_KEY = "codex-remote:input-focus-filter";

function isInputFocusFilter(value: string | null): value is InputFocusFilter {
  return value === "all" || value === "desktop" || value === "replyable";
}

export function getStoredInputFocusFilter(): InputFocusFilter {
  if (typeof window === "undefined") {
    return "all";
  }

  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isInputFocusFilter(value) ? value : "all";
  } catch {
    return "all";
  }
}

export function setStoredInputFocusFilter(filter: InputFocusFilter) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, filter);
  } catch {
    // Ignore storage failures and keep the UI usable.
  }
}
