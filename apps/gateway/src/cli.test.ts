import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runGatewayCli, type GatewayCliRunResult } from "./cli";

const runtimes: GatewayCliRunResult[] = [];
const cleanupRoots = new Set<string>();

afterEach(async () => {
  while (runtimes.length > 0) {
    await runtimes.pop()?.shutdown();
  }

  for (const root of cleanupRoots) {
    await fs.rm(root, { recursive: true, force: true });
  }
  cleanupRoots.clear();
});

describe("gateway CLI", () => {
  it("starts the gateway and serves the health endpoint", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-cli-"));
    cleanupRoots.add(root);

    const codexHome = path.join(root, ".codex");
    await fs.mkdir(codexHome, { recursive: true });

    const runtime = await runGatewayCli({
      ...process.env,
      CODEX_HOME: codexHome,
      CODEX_REMOTE_GATEWAY_HOST: "127.0.0.1",
      CODEX_REMOTE_GATEWAY_PORT: "0"
    });
    runtimes.push(runtime);

    const response = await fetch(new URL("/health", runtime.address));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      adapter: "codex-app-server"
    });
  });
});
