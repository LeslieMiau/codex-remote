import { describe, expect, it } from "vitest";

import { resolveCodexAppServerEnvironment } from "./system-proxy";

describe("system-proxy", () => {
  it("returns a shallow copy of the source environment", async () => {
    const source = {
      PATH: "/usr/bin",
      CODEX_HOME: "/tmp/codex"
    } as NodeJS.ProcessEnv;

    const resolved = await resolveCodexAppServerEnvironment(source);

    expect(resolved.env).toEqual(source);
    expect(resolved.env).not.toBe(source);
  });
});
