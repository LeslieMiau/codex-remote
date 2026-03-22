import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getStoredInputFocusFilter,
  setStoredInputFocusFilter
} from "./input-focus-storage";

describe("input-focus-storage", () => {
  const localStorageMock = {
    getItem: vi.fn<(key: string) => string | null>(),
    setItem: vi.fn<(key: string, value: string) => void>()
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("falls back to all when nothing valid is stored", () => {
    localStorageMock.getItem.mockReturnValueOnce("unexpected");
    vi.stubGlobal("window", {
      localStorage: localStorageMock
    });

    expect(getStoredInputFocusFilter()).toBe("all");
  });

  it("reads and writes a stored filter", () => {
    localStorageMock.getItem.mockReturnValueOnce("desktop");
    vi.stubGlobal("window", {
      localStorage: localStorageMock
    });

    expect(getStoredInputFocusFilter()).toBe("desktop");

    setStoredInputFocusFilter("replyable");

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "codex-remote:input-focus-filter",
      "replyable"
    );
  });
});
