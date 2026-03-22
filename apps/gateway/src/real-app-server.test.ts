import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  CodexDiagnosticsSummaryResponse,
  CodexSharedSettingsResponse
} from "@codex-remote/protocol";

import { createGatewayServer, type GatewayRuntime } from "./server";

const DEFAULT_APP_SERVER_ARGS = ["app-server", "--listen", "stdio://"] as const;
const runtimes: GatewayRuntime[] = [];
const cleanupRoots = new Set<string>();

function parseCommandArgs(value: string | undefined) {
  if (!value || value.trim().length === 0) {
    return [...DEFAULT_APP_SERVER_ARGS];
  }

  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
        return parsed;
      }
    } catch {
      // Fall back to simple whitespace splitting.
    }
  }

  return trimmed.split(/\s+/).filter(Boolean);
}

function realAppServerTestConfig() {
  const timeoutMs = Number(process.env.RUN_REAL_APP_SERVER_TIMEOUT_MS ?? "120000");

  return {
    args: parseCommandArgs(process.env.RUN_REAL_APP_SERVER_ARGS),
    command: process.env.RUN_REAL_APP_SERVER_COMMAND ?? "codex",
    enabled: process.env.RUN_REAL_APP_SERVER_TESTS === "1",
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120_000
  };
}

async function initTempRepo(repoRoot: string) {
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, "README.md"),
    "# codex-remote real smoke\n",
    "utf8"
  );

  try {
    execFileSync("git", ["init", "-b", "main"], {
      cwd: repoRoot,
      stdio: "pipe"
    });
  } catch {
    execFileSync("git", ["init"], {
      cwd: repoRoot,
      stdio: "pipe"
    });
    execFileSync("git", ["checkout", "-b", "main"], {
      cwd: repoRoot,
      stdio: "pipe"
    });
  }
}

async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return await read();
}

async function createRuntime() {
  const config = realAppServerTestConfig();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-real-app-server-"));
  cleanupRoots.add(root);

  const repoRoot = path.join(root, "repo");
  const codexHome = path.join(root, ".codex");
  await initTempRepo(repoRoot);
  await fs.mkdir(codexHome, { recursive: true });

  const runtime = await createGatewayServer({
    adapterKind: "codex-app-server",
    codexHome,
    codexAdapterOptions: {
      args: config.args,
      command: config.command,
      requestTimeoutMs: config.timeoutMs
    },
    codexCommandBridgeOptions: {
      args: config.args,
      command: config.command,
      requestTimeoutMs: config.timeoutMs
    },
    databasePath: path.join(root, "gateway.sqlite")
  });
  await runtime.app.ready();
  runtimes.push(runtime);

  return {
    codexHome,
    repoRoot,
    root,
    runtime
  };
}

afterEach(async () => {
  while (runtimes.length > 0) {
    const runtime = runtimes.pop();
    if (runtime) {
      await runtime.app.close();
    }
  }

  for (const root of cleanupRoots) {
    await fs.rm(root, { force: true, recursive: true });
  }
  cleanupRoots.clear();
});

describe("real-app-server smoke", () => {
  const config = realAppServerTestConfig();

  it("documents how to enable the real app-server smoke suite", () => {
    expect({
      command: config.command,
      enabled: config.enabled,
      hint:
        "RUN_REAL_APP_SERVER_TESTS=1 pnpm --filter @codex-remote/gateway test -- src/real-app-server.test.ts"
    }).toMatchObject({
      command: expect.any(String),
      enabled: expect.any(Boolean),
      hint: expect.stringContaining("RUN_REAL_APP_SERVER_TESTS=1")
    });
  });

  if (!config.enabled) {
    return;
  }

  it(
    "creates a shared thread and surfaces it through the gateway timeline",
    async () => {
      const { runtime, repoRoot } = await createRuntime();

      const createShared = await runtime.app.inject({
        method: "POST",
        payload: {
          actor_id: "smoke",
          repo_root: repoRoot,
          request_id: "real-smoke-create"
        },
        url: "/threads/shared"
      });
      expect(createShared.statusCode).toBe(200);

      const createdThreadId = createShared.json().thread.thread_id as string;
      expect(createdThreadId).toBeTruthy();
      const createdThreadPath = encodeURIComponent(createdThreadId);
      expect(
        runtime.store.getThread(createdThreadId) ??
          runtime.store.findThreadByAdapterRef(createdThreadId)
      ).toBeTruthy();

      const timelineResponse = await runtime.app.inject({
        method: "GET",
        url: `/threads/${createdThreadPath}/timeline`
      });
      expect(timelineResponse.statusCode).toBe(200);
      expect(timelineResponse.json().thread.thread_id).toBe(createdThreadId);
    },
    config.timeoutMs
  );

  it(
    "returns shared settings and diagnostics through the real app-server bridge",
    async () => {
      const { runtime } = await createRuntime();

      const settingsResponse = await runtime.app.inject({
        method: "GET",
        url: "/settings/shared"
      });
      expect(settingsResponse.statusCode).toBe(200);
      const settings = settingsResponse.json() as CodexSharedSettingsResponse;
      expect(settings).toMatchObject({
        available_models: expect.any(Array),
        experimental_features: expect.any(Array),
        read_only: expect.any(Boolean)
      });

      const diagnosticsResponse = await runtime.app.inject({
        method: "GET",
        url: "/diagnostics/summary"
      });
      expect(diagnosticsResponse.statusCode).toBe(200);
      const diagnostics = diagnosticsResponse.json() as CodexDiagnosticsSummaryResponse;
      expect(diagnostics).toMatchObject({
        errors: expect.any(Object),
        mcp_servers: expect.any(Array),
        rate_limits_by_limit_id: expect.any(Object),
        requires_openai_auth: expect.any(Boolean)
      });
    },
    config.timeoutMs
  );

  it(
    "keeps a prompted shared thread addressable through later thread actions",
    async () => {
      const { runtime, repoRoot } = await createRuntime();

      const createShared = await runtime.app.inject({
        method: "POST",
        payload: {
          actor_id: "smoke",
          repo_root: repoRoot,
          request_id: "real-smoke-prompted",
          prompt: "Reply with exactly OK and nothing else."
        },
        url: "/threads/shared"
      });
      expect(createShared.statusCode).toBe(200);

      const createdThreadId = createShared.json().thread.thread_id as string;
      expect(createdThreadId).toContain("shared_pending_");

      await waitFor(
        async () => runtime.store.getThread(createdThreadId),
        (thread) => Boolean(thread?.adapter_thread_ref),
        config.timeoutMs
      );

      const encodedThreadId = encodeURIComponent(createdThreadId);
      const renameResponse = await runtime.app.inject({
        method: "POST",
        payload: {
          actor_id: "smoke",
          request_id: "real-smoke-rename",
          name: "Renamed from smoke"
        },
        url: `/threads/${encodedThreadId}/name`
      });
      expect(renameResponse.statusCode).toBe(200);
      expect(renameResponse.json().thread.thread_id).toBe(createdThreadId);

      const overviewResponse = await runtime.app.inject({
        method: "GET",
        url: "/overview"
      });
      expect(overviewResponse.statusCode).toBe(200);
      expect(
        overviewResponse
          .json()
          .threads.some((thread: { thread_id: string }) => thread.thread_id === createdThreadId)
      ).toBe(true);
    },
    config.timeoutMs
  );
});
