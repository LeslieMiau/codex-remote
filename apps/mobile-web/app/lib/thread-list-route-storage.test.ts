import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getStoredThreadListRoute,
  setStoredThreadListRoute
} from "./thread-list-route-storage";

describe("thread-list-route-storage", () => {
  const localStorageMock = {
    getItem: vi.fn<(key: string) => string | null>(),
    setItem: vi.fn<(key: string, value: string) => void>()
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("falls back to /projects when nothing valid is stored", () => {
    localStorageMock.getItem.mockReturnValueOnce("/unexpected");
    vi.stubGlobal("window", {
      localStorage: localStorageMock
    });

    expect(getStoredThreadListRoute()).toBe("/projects");
  });

  it("reads and writes the last list route", () => {
    localStorageMock.getItem.mockReturnValueOnce("/queue");
    vi.stubGlobal("window", {
      localStorage: localStorageMock
    });

    expect(getStoredThreadListRoute()).toBe("/queue");

    setStoredThreadListRoute("/projects");

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "codex-remote:last-thread-list-route",
      "/projects"
    );
  });
});
