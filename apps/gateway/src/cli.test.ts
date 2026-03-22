import { execFileSync, spawn, type ChildProcessByStdio } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

type GatewayCliProcess = ChildProcessByStdio<null, Readable, Readable>;

const childProcesses: GatewayCliProcess[] = [];
const cleanupRoots = new Set<string>();

function waitForListening(child: GatewayCliProcess, timeoutMs = 15_000) {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the gateway CLI to start."));
    }, timeoutMs);
    let output = "";

    const onStdout = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Gateway listening on (http:\/\/[^\s]+)/);
      if (!match) {
        return;
      }

      cleanup();
      resolve(match[1]);
    };

    const onStderr = (chunk: Buffer) => {
      output += chunk.toString();
    };

    const onExit = () => {
      cleanup();
      reject(new Error(`Gateway CLI exited before it became ready.\n${output}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
  });
}

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    if (child.exitCode !== null) {
      continue;
    }

    const exitPromise = once(child, "exit");
    child.kill("SIGTERM");
    await Promise.race([
      exitPromise,
      new Promise((resolve) => setTimeout(resolve, 5_000))
    ]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
  }

  for (const root of cleanupRoots) {
    await fs.rm(root, { recursive: true, force: true });
  }
  cleanupRoots.clear();
});

describe("gateway CLI", () => {
  it("starts the gateway and serves the health endpoint", async () => {
    execFileSync("corepack", ["pnpm", "build"], {
      cwd: process.cwd(),
      stdio: "pipe"
    });

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-cli-"));
    cleanupRoots.add(root);
    await fs.mkdir(path.join(root, ".codex"), { recursive: true });

    const child = spawn(process.execPath, [path.join(process.cwd(), "dist", "cli.js")], {
      cwd: root,
      env: {
        ...process.env,
        CODEX_HOME: path.join(root, ".codex"),
        CODEX_REMOTE_GATEWAY_HOST: "127.0.0.1",
        CODEX_REMOTE_GATEWAY_PORT: "0"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    childProcesses.push(child);

    const address = await waitForListening(child);
    const response = await fetch(new URL("/health", address));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      adapter: "codex-app-server"
    });
  });
});
