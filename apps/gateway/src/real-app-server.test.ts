import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  CodexDiagnosticsSummaryResponse,
  CodexSharedSettingsResponse,
  TurnRecord
} from "@codex-remote/protocol";

import { createGatewayServer, type GatewayRuntime } from "./server";

const DEFAULT_APP_SERVER_ARGS = ["app-server", "--listen", "stdio://"] as const;
const LIVE_TURN_STATES = new Set<TurnRecord["state"]>([
  "started",
  "streaming",
  "resumed",
  "waiting_approval"
]);
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
    liveFollowUpEnabled: process.env.RUN_REAL_APP_SERVER_LIVE_FOLLOW_UP_TESTS === "1",
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timed out waiting for ${label}`));
      }, timeoutMs);
    })
  ]);
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

async function waitForSharedThreadControlReady(
  runtime: GatewayRuntime,
  threadId: string,
  timeoutMs: number
) {
  return waitFor(
    () => runtime.bridge.getThread(threadId),
    (thread) =>
      Boolean(
        thread?.adapter_thread_ref &&
          thread.sync_state !== "sync_pending" &&
          thread.sync_state !== "sync_failed"
      ),
    timeoutMs
  );
}

async function createReadySharedThread(input: {
  repoRoot: string;
  requestId: string;
  runtime: GatewayRuntime;
  timeoutMs: number;
}) {
  const createShared = await input.runtime.app.inject({
    method: "POST",
    payload: {
      actor_id: "smoke",
      repo_root: input.repoRoot,
      request_id: input.requestId
    },
    url: "/threads/shared"
  });
  expect(createShared.statusCode).toBe(200);

  const threadId = createShared.json().thread.thread_id as string;
  const readyThread = await waitForSharedThreadControlReady(
    input.runtime,
    threadId,
    input.timeoutMs
  );
  expect(readyThread?.thread_id).toBe(threadId);
  expect(readyThread?.adapter_thread_ref).toBeTruthy();

  return {
    thread: readyThread!,
    threadId
  };
}

async function waitForLiveTurn(input: {
  runtime: GatewayRuntime;
  threadId: string;
  turnId: string;
  timeoutMs: number;
}) {
  const result = await waitFor(
    async () => ({
      thread: await input.runtime.bridge.getThread(input.threadId),
      turn: input.runtime.store.getTurn(input.turnId)
    }),
    (value) =>
      Boolean(
        value.thread?.adapter_thread_ref &&
          value.turn &&
          LIVE_TURN_STATES.has(value.turn.state)
      ),
    input.timeoutMs
  );

  return result.thread?.adapter_thread_ref && result.turn
    ? {
        thread: result.thread,
        turn: result.turn
      }
    : null;
}

async function cleanupLiveTurn(input: {
  runtime: GatewayRuntime;
  turnId: string;
  timeoutMs: number;
}) {
  const currentTurn = input.runtime.store.getTurn(input.turnId);
  if (!currentTurn) {
    return;
  }

  if (
    currentTurn.state === "completed" ||
    currentTurn.state === "failed" ||
    currentTurn.state === "interrupted"
  ) {
    return;
  }

  const interrupt = await withTimeout(
    input.runtime.app.inject({
      method: "POST",
      payload: {
        actor_id: "smoke",
        request_id: `real-smoke-interrupt-${input.turnId}`
      },
      url: `/runs/${encodeURIComponent(input.turnId)}/interrupt`
    }),
    Math.min(input.timeoutMs, 15_000),
    `interrupting run ${input.turnId}`
  );
  expect(interrupt.statusCode).toBe(200);

  await waitFor(
    async () => input.runtime.store.getTurn(input.turnId),
    (turn) =>
      turn?.state === "completed" ||
      turn?.state === "failed" ||
      turn?.state === "interrupted",
    Math.min(input.timeoutMs, 15_000)
  );

  const hasExecution = await waitFor(
    async () => input.runtime.manager.hasActiveExecution(input.turnId),
    (active) => !active,
    Math.min(input.timeoutMs, 15_000)
  );
  expect(hasExecution).toBe(false);
}

async function closeRuntime(runtime: GatewayRuntime, timeoutMs: number) {
  const index = runtimes.indexOf(runtime);
  if (index >= 0) {
    runtimes.splice(index, 1);
  }

  await withTimeout(runtime.app.close(), Math.min(timeoutMs, 15_000), "closing gateway runtime");
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
      liveFollowUpEnabled: config.liveFollowUpEnabled,
      hint:
        "RUN_REAL_APP_SERVER_TESTS=1 pnpm --filter @codex-remote/gateway test -- src/real-app-server.test.ts"
    }).toMatchObject({
      command: expect.any(String),
      enabled: expect.any(Boolean),
      liveFollowUpEnabled: expect.any(Boolean),
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
      const archiveResponse = await runtime.app.inject({
        method: "POST",
        payload: {
          actor_id: "smoke",
          request_id: "real-smoke-archive-pending"
        },
        url: `/threads/${encodedThreadId}/archive`
      });
      expect(archiveResponse.statusCode).toBe(409);
      expect(archiveResponse.json()).toMatchObject({
        error: "thread_sync_pending"
      });

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

  it(
    "archives, restores, and forks a materialized shared thread",
    async () => {
      const { runtime, repoRoot } = await createRuntime();

      const createShared = await runtime.app.inject({
        method: "POST",
        payload: {
          actor_id: "smoke",
          repo_root: repoRoot,
          request_id: "real-smoke-thread-controls",
          prompt: "Reply with exactly OK and nothing else."
        },
        url: "/threads/shared"
      });
      expect(createShared.statusCode).toBe(200);

      const createdThreadId = createShared.json().thread.thread_id as string;
      const readyThread = await waitForSharedThreadControlReady(
        runtime,
        createdThreadId,
        config.timeoutMs
      );
      expect(readyThread?.thread_id).toBe(createdThreadId);
      expect(readyThread?.adapter_thread_ref).toBeTruthy();

      const encodedThreadId = encodeURIComponent(createdThreadId);

      const archiveResponse = await runtime.app.inject({
        method: "POST",
        payload: {
          actor_id: "smoke",
          request_id: "real-smoke-archive-ready"
        },
        url: `/threads/${encodedThreadId}/archive`
      });
      expect(archiveResponse.statusCode).toBe(200);
      expect(archiveResponse.json()).toMatchObject({
        thread: {
          thread_id: createdThreadId,
          archived: true,
          state: "archived"
        }
      });

      const activeOverviewResponse = await runtime.app.inject({
        method: "GET",
        url: "/overview"
      });
      expect(activeOverviewResponse.statusCode).toBe(200);
      expect(
        activeOverviewResponse
          .json()
          .threads.some((thread: { thread_id: string }) => thread.thread_id === createdThreadId)
      ).toBe(false);

      const archivedOverviewResponse = await runtime.app.inject({
        method: "GET",
        url: "/overview?include_archived=1"
      });
      expect(archivedOverviewResponse.statusCode).toBe(200);
      expect(
        archivedOverviewResponse
          .json()
          .threads.some(
            (thread: { archived: boolean; state: string; thread_id: string }) =>
              thread.thread_id === createdThreadId &&
              thread.archived === true &&
              thread.state === "archived"
          )
      ).toBe(true);

      const unarchiveResponse = await runtime.app.inject({
        method: "POST",
        payload: {
          actor_id: "smoke",
          request_id: "real-smoke-unarchive-ready"
        },
        url: `/threads/${encodedThreadId}/unarchive`
      });
      expect(unarchiveResponse.statusCode).toBe(200);
      expect(unarchiveResponse.json()).toMatchObject({
        thread: {
          thread_id: createdThreadId,
          archived: false
        }
      });

      const restoredOverview = await waitFor(
        async () =>
          runtime.app.inject({
            method: "GET",
            url: "/overview"
          }),
        (response) =>
          response
            .json()
            .threads.some((thread: { thread_id: string }) => thread.thread_id === createdThreadId),
        config.timeoutMs
      );
      expect(restoredOverview.statusCode).toBe(200);

      const forkResponse = await runtime.app.inject({
        method: "POST",
        payload: {
          actor_id: "smoke",
          request_id: "real-smoke-fork-ready"
        },
        url: `/threads/${encodedThreadId}/fork`
      });
      expect(forkResponse.statusCode).toBe(200);
      expect(forkResponse.json().thread.thread_id).toBeTruthy();
      expect(forkResponse.json().thread.thread_id).not.toBe(createdThreadId);
    },
    config.timeoutMs
  );

  if (config.liveFollowUpEnabled) {
    it(
      "accepts a live follow-up on a materialized shared turn",
      async () => {
        const promptStrategies = [
          {
            label: "approval-gated",
            prompt:
              "Create a file named steer-smoke.txt with the text hello, then reply with DONE."
          },
          {
            label: "long-output",
            prompt:
              "Write the integers from 1 to 4000, one per line, and do not use tools."
          }
        ] as const;

        let matchedStrategy: (typeof promptStrategies)[number]["label"] | null = null;

        for (const strategy of promptStrategies) {
          const { runtime, repoRoot } = await createRuntime();
          try {
            const { threadId } = await createReadySharedThread({
              repoRoot,
              requestId: `real-smoke-live-follow-up-${strategy.label}`,
              runtime,
              timeoutMs: config.timeoutMs
            });

            const encodedThreadId = encodeURIComponent(threadId);
            const startRun = await runtime.app.inject({
              method: "POST",
              payload: {
                actor_id: "smoke",
                request_id: `real-smoke-live-run-${strategy.label}`,
                prompt: strategy.prompt
              },
              url: `/threads/${encodedThreadId}/runs`
            });
            expect(startRun.statusCode).toBe(200);

            const turnId = startRun.json().turn.turn_id as string;
            const liveTurn = await waitForLiveTurn({
              runtime,
              threadId,
              turnId,
              timeoutMs: Math.min(config.timeoutMs, 10_000)
            });
            if (!liveTurn) {
              await cleanupLiveTurn({
                runtime,
                turnId,
                timeoutMs: config.timeoutMs
              });
              continue;
            }

            const followUp = await withTimeout(
              runtime.app.inject({
                method: "POST",
                payload: {
                  actor_id: "smoke",
                  request_id: `real-smoke-live-follow-up-send-${strategy.label}`,
                  prompt: "Stop the previous plan and reply with exactly FOLLOW_UP_OK."
                },
                url: `/runs/${encodeURIComponent(turnId)}/follow-ups`
              }),
              Math.min(config.timeoutMs, 15_000),
              `sending live follow-up for ${strategy.label}`
            );
            expect(followUp.statusCode).toBe(200);
            expect(followUp.json()).toMatchObject({
              turn: {
                turn_id: turnId
              }
            });

            await cleanupLiveTurn({
              runtime,
              turnId,
              timeoutMs: config.timeoutMs
            });
            matchedStrategy = strategy.label;
            break;
          } finally {
            await closeRuntime(runtime, config.timeoutMs);
          }
        }

        expect(matchedStrategy).not.toBeNull();
      },
      config.timeoutMs
    );
  }
});
