import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openSqliteDatabase } from "./lib/sqlite";
import { createGatewayServer, type GatewayRuntime } from "./server";

const runtimes: GatewayRuntime[] = [];
const cleanupRoots = new Set<string>();

function fakeAppServerScriptPath() {
  return path.join(
    process.cwd(),
    "src",
    "adapters",
    "__fixtures__",
    "fake-app-server.mjs"
  );
}

function createFakeAppServerOptions(logPath: string) {
  return {
    command: process.execPath,
    args: [fakeAppServerScriptPath(), logPath],
    requestTimeoutMs: 5_000
  };
}

async function waitFor<T>(
  producer: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  timeoutMs = 4_000
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await producer();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out waiting for condition");
}

async function seedSharedCodexState(codexHome: string, repoRoot: string) {
  const sessionDir = path.join(codexHome, "sessions", "2026", "03", "16");
  const rolloutPath = path.join(sessionDir, "remote-thread-1.jsonl");
  await fs.mkdir(sessionDir, { recursive: true });

  const database = await openSqliteDatabase(path.join(codexHome, "state_5.sqlite"));
  database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      has_user_event INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0
    );
  `);
  database
    .prepare(
      `
        INSERT INTO threads(id, rollout_path, created_at, updated_at, source, cwd, title, archived)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      "remote-thread-1",
      rolloutPath,
      1_773_622_800,
      1_773_623_100,
      "vscode",
      repoRoot,
      "Shared Codex thread",
      0
    );
  database.close();

  await fs.writeFile(
    path.join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({ id: "remote-thread-1", title: "Shared Codex thread" })}\n`,
    "utf8"
  );

  await fs.writeFile(
    rolloutPath,
    [
      JSON.stringify({
        timestamp: "2026-03-16T09:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Inspect the current mobile UI."
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-16T09:00:02.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          phase: "commentary",
          message: "Reviewing the current routes and queue surfaces."
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-16T09:00:05.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_shared",
          arguments: "rg --files apps/mobile-web/app"
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-16T09:00:07.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call_shared",
          output: "apps/mobile-web/app/page.tsx"
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-16T09:00:09.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          phase: "final_answer",
          message: "The mobile UI currently uses a compact dashboard layout."
        }
      })
    ].join("\n"),
    "utf8"
  );
}

async function readNativeThreadMarker(
  codexHome: string,
  threadId: string
): Promise<{ updated_at: number; has_user_event: number } | undefined> {
  const database = await openSqliteDatabase(path.join(codexHome, "state_5.sqlite"), {
    readonly: true,
    fileMustExist: true
  });

  try {
    return database
      .prepare("SELECT updated_at, has_user_event FROM threads WHERE id = ?")
      .get<{ updated_at: number; has_user_event: number }>(threadId);
  } finally {
    database.close();
  }
}

async function createRuntime() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-server-"));
  cleanupRoots.add(root);

  const repoRoot = path.join(root, "repo");
  const codexHome = path.join(root, ".codex");
  const adapterLogPath = path.join(root, "fake-adapter.log");
  const bridgeLogPath = path.join(root, "fake-command-bridge.log");

  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(codexHome, { recursive: true });
  await seedSharedCodexState(codexHome, repoRoot);

  const runtime = await createGatewayServer({
    databasePath: path.join(root, "gateway.sqlite"),
    adapterKind: "codex-app-server",
    codexHome,
    codexAdapterOptions: createFakeAppServerOptions(adapterLogPath),
    codexCommandBridgeOptions: createFakeAppServerOptions(bridgeLogPath)
  });
  await runtime.app.ready();
  runtimes.push(runtime);

  return {
    adapterLogPath,
    bridgeLogPath,
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
    await fs.rm(root, { recursive: true, force: true });
  }
  cleanupRoots.clear();
});

describe("gateway server", () => {
  it("boots a shared thread and completes the approval -> patch -> apply flow", async () => {
    const { adapterLogPath, bridgeLogPath, repoRoot, runtime } = await createRuntime();

    const createShared = await runtime.app.inject({
      method: "POST",
      url: "/threads/shared",
      payload: {
        actor_id: "phone",
        request_id: "shared-create-flow",
        repo_root: repoRoot,
        prompt: "[fixture:approval] Review the mobile surface."
      }
    });
    expect(createShared.statusCode).toBe(200);

    const createPayload = createShared.json() as {
      thread: { thread_id: string };
      turn: { turn_id: string };
    };
    const threadId = createPayload.thread.thread_id;
    const turnId = createPayload.turn.turn_id;

    const approval = await waitFor(
      () => runtime.store.listApprovals(threadId),
      (approvals) => approvals.length === 1
    ).then((approvals) => approvals[0]!);

    const overview = await waitFor(
      async () => {
        const response = await runtime.app.inject({
          method: "GET",
          url: "/overview"
        });
        return response.json() as {
          threads: Array<{ state: string; thread_id: string }>;
        };
      },
      (payload) =>
        payload.threads.some(
          (thread) =>
            thread.thread_id === threadId && thread.state === "waiting_approval"
        )
    );
    expect(overview.threads.some((thread) => thread.thread_id === threadId)).toBe(true);

    const queueBeforeApproval = await waitFor(
      async () => {
        const response = await runtime.app.inject({
          method: "GET",
          url: "/queue"
        });
        return response.json() as {
          entries: Array<{ kind: string; thread_id: string }>;
        };
      },
      (payload) =>
        payload.entries.some(
          (entry) => entry.kind === "approval" && entry.thread_id === threadId
        )
    );
    expect(
      queueBeforeApproval.entries.some(
        (entry) => entry.kind === "approval" && entry.thread_id === threadId
      )
    ).toBe(true);

    const approve = await runtime.app.inject({
      method: "POST",
      url: `/approvals/${approval.approval_id}/approve`,
      payload: {
        actor_id: "phone",
        request_id: "shared-approve-flow",
        confirmed: true
      }
    });
    expect(approve.statusCode).toBe(200);

    const patch = await waitFor(
      () => runtime.store.listPatches(threadId),
      (patches) => patches.length === 1
    ).then((patches) => patches[0]!);

    const queueAfterApproval = await waitFor(
      async () => {
        const response = await runtime.app.inject({
          method: "GET",
          url: "/queue"
        });
        return response.json() as {
          entries: Array<{ kind: string; thread_id: string }>;
        };
      },
      (payload) =>
        payload.entries.some(
          (entry) => entry.kind === "patch" && entry.thread_id === threadId
        )
    );
    expect(
      queueAfterApproval.entries.some(
        (entry) => entry.kind === "patch" && entry.thread_id === threadId
      )
    ).toBe(true);

    const applyPatch = await runtime.app.inject({
      method: "POST",
      url: `/patches/${patch.patch_id}/apply`,
      payload: {
        actor_id: "phone",
        request_id: "shared-apply-flow"
      }
    });
    expect(applyPatch.statusCode).toBe(200);
    expect(applyPatch.json().patch.status).toBe("applied");

    await waitFor(
      () => runtime.store.getTurn(turnId),
      (turn) => turn?.state === "completed"
    );

    await expect(
      fs.readFile(path.join(repoRoot, "notes", "real-1.txt"), "utf8")
    ).resolves.toBe("hello-1\n");

    const transcript = await runtime.app.inject({
      method: "GET",
      url: `/threads/${threadId}/messages/latest?limit=10`
    });
    expect(transcript.statusCode).toBe(200);
    expect(
      transcript
        .json()
        .items.some((item: { role: string }) => item.role === "assistant")
    ).toBe(true);

    const events = await runtime.app.inject({
      method: "GET",
      url: `/threads/${threadId}/events?after_seq=0`
    });
    expect(events.statusCode).toBe(200);
    expect(
      events
        .json()
        .events.some(
          (event: { event_type: string }) => event.event_type === "approval.required"
        )
    ).toBe(true);
    expect(
      events
        .json()
        .events.some((event: { event_type: string }) => event.event_type === "patch.ready")
    ).toBe(true);
    expect(
      events
        .json()
        .events.some(
          (event: { event_type: string }) => event.event_type === "turn.completed"
        )
    ).toBe(true);

    await expect(fs.readFile(bridgeLogPath, "utf8")).resolves.toContain("request:thread/start");
    await expect(fs.readFile(adapterLogPath, "utf8")).resolves.toContain("request:turn/start");
  });

  it("supports the shared flow under /api-prefixed routes", async () => {
    const { repoRoot, runtime } = await createRuntime();

    const createShared = await runtime.app.inject({
      method: "POST",
      url: "/api/threads/shared",
      payload: {
        actor_id: "phone",
        request_id: "api-shared-create",
        repo_root: repoRoot
      }
    });
    expect(createShared.statusCode).toBe(200);

    const threadId = createShared.json().thread.thread_id as string;

    const startRun = await runtime.app.inject({
      method: "POST",
      url: `/api/threads/${threadId}/runs`,
      payload: {
        actor_id: "phone",
        request_id: "api-start-run",
        prompt: "Create a recovered note."
      }
    });
    expect(startRun.statusCode).toBe(200);

    const turnId = startRun.json().turn.turn_id as string;
    const patch = await waitFor(
      () => runtime.store.listPatches(threadId),
      (patches) => patches.length === 1
    ).then((patches) => patches[0]!);

    const discardPatch = await runtime.app.inject({
      method: "POST",
      url: `/api/patches/${patch.patch_id}/discard`,
      payload: {
        actor_id: "phone",
        request_id: "api-discard-patch"
      }
    });
    expect(discardPatch.statusCode).toBe(200);
    expect(discardPatch.json().patch.status).toBe("discarded");

    await waitFor(
      () => runtime.store.getTurn(turnId),
      (turn) => turn?.state === "completed"
    );

    const overview = await runtime.app.inject({
      method: "GET",
      url: "/api/overview"
    });
    expect(overview.statusCode).toBe(200);
    expect(
      overview
        .json()
        .threads.some((thread: { thread_id: string }) => thread.thread_id === threadId)
    ).toBe(true);

    const latestMessages = await runtime.app.inject({
      method: "GET",
      url: `/api/threads/${threadId}/messages/latest?limit=5`
    });
    expect(latestMessages.statusCode).toBe(200);
    expect(latestMessages.json().items.length).toBeGreaterThan(0);

    const events = await runtime.app.inject({
      method: "GET",
      url: `/api/threads/${threadId}/events?after_seq=0`
    });
    expect(events.statusCode).toBe(200);
    expect(
      events
        .json()
        .events.some((event: { event_type: string }) => event.event_type === "patch.ready")
    ).toBe(true);
    expect(
      events
        .json()
        .events.some(
          (event: { event_type: string }) => event.event_type === "turn.completed"
        )
    ).toBe(true);
  });

  it("interrupts an active shared run", async () => {
    const { repoRoot, runtime } = await createRuntime();

    const createShared = await runtime.app.inject({
      method: "POST",
      url: "/threads/shared",
      payload: {
        actor_id: "phone",
        request_id: "interrupt-shared-create",
        repo_root: repoRoot
      }
    });
    expect(createShared.statusCode).toBe(200);

    const threadId = createShared.json().thread.thread_id as string;
    const startRun = await runtime.app.inject({
      method: "POST",
      url: `/threads/${threadId}/runs`,
      payload: {
        actor_id: "phone",
        request_id: "interrupt-shared-run",
        prompt: "[fixture:interrupt] Wait for an interrupt."
      }
    });
    expect(startRun.statusCode).toBe(200);

    const turnId = startRun.json().turn.turn_id as string;
    await waitFor(
      () => runtime.store.getTurn(turnId),
      (turn) =>
        turn?.state === "started" ||
        turn?.state === "streaming" ||
        turn?.state === "resumed"
    );

    const interrupt = await runtime.app.inject({
      method: "POST",
      url: `/runs/${turnId}/interrupt`,
      payload: {
        actor_id: "phone",
        request_id: "interrupt-shared-command"
      }
    });
    expect(interrupt.statusCode).toBe(200);

    await waitFor(
      () => runtime.store.getTurn(turnId),
      (turn) => turn?.state === "interrupted"
    );
    expect(runtime.store.getThread(threadId)?.active_turn_id).toBeNull();
  });

  it("marks a shared native thread as updated after phone-side rollback", async () => {
    const { codexHome, repoRoot, runtime } = await createRuntime();

    const thread = await waitFor(
      () => runtime.store.getThread("remote-thread-1"),
      (value) => Boolean(value)
    );
    if (!thread) {
      throw new Error("Expected shared thread to be available in the gateway store.");
    }

    runtime.store.saveThread({
      ...thread,
      worktree_path: repoRoot,
      updated_at: thread.updated_at
    });

    const patchPath = path.join(repoRoot, "notes", "from-phone.txt");
    await fs.mkdir(path.dirname(patchPath), { recursive: true });
    await fs.writeFile(patchPath, "after\n", "utf8");
    runtime.store.savePatch({
      patch_id: "patch_shared_marker",
      project_id: thread.project_id,
      thread_id: thread.thread_id,
      turn_id: "turn_shared_marker",
      status: "applied",
      summary: "Phone-applied patch",
      files: [
        {
          path: "notes/from-phone.txt",
          added_lines: 1,
          removed_lines: 0
        }
      ],
      changes: [
        {
          path: "notes/from-phone.txt",
          before_content: null,
          after_content: "after\n"
        }
      ],
      rollback_available: true,
      created_at: "2026-03-16T09:06:00.000Z",
      updated_at: "2026-03-16T09:06:00.000Z",
      applied_at: "2026-03-16T09:06:00.000Z"
    });

    const beforeMarker = await readNativeThreadMarker(codexHome, thread.thread_id);
    expect(beforeMarker?.has_user_event).toBe(0);

    const rollback = await runtime.app.inject({
      method: "POST",
      url: "/patches/patch_shared_marker/rollback",
      payload: {
        actor_id: "phone",
        request_id: "shared-thread-marker-rollback"
      }
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json().patch.rollback_available).toBe(false);

    await waitFor(
      () => readNativeThreadMarker(codexHome, thread.thread_id),
      (value) =>
        Boolean(value) &&
        Number(value?.has_user_event ?? 0) === 1 &&
        Number(value?.updated_at ?? 0) > Number(beforeMarker?.updated_at ?? 0)
    );

    await expect(fs.readFile(patchPath, "utf8")).rejects.toThrow();
  });
});
