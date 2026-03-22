import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { openSqliteDatabase } from "./lib/sqlite";
import { nowIso } from "./lib/time";
import { createGatewayServer, type GatewayRuntime } from "./server";

const runtimes: GatewayRuntime[] = [];
const cleanupRoots = new Set<string>();

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

async function createRuntime(input?: {
  codexCommandBridgeOptions?: {
    args?: string[];
    command?: string;
  };
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-routes-"));
  cleanupRoots.add(root);

  const repoRoot = path.join(root, "repo");
  const codexHome = path.join(root, ".codex");
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(codexHome, { recursive: true });

  const runtime = await createGatewayServer({
    databasePath: path.join(root, "gateway.sqlite"),
    adapterKind: "codex-app-server",
    codexHome,
    codexCommandBridgeOptions: input?.codexCommandBridgeOptions
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

async function seedSharedStateThreads(input: {
  codexHome: string;
  repoRoot: string;
  threads: Array<{
    archived?: boolean;
    threadId: string;
    title: string;
    updatedAt?: number;
  }>;
}) {
  const sessionDir = path.join(input.codexHome, "sessions", "2026", "03", "16");
  await fs.mkdir(sessionDir, { recursive: true });

  const database = await openSqliteDatabase(path.join(input.codexHome, "state_5.sqlite"));
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

  const insertThread = database.prepare(
    `
      INSERT INTO threads(id, rollout_path, created_at, updated_at, source, cwd, title, archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  );

  for (const [index, thread] of input.threads.entries()) {
    const rolloutPath = path.join(sessionDir, `${thread.threadId}.jsonl`);
    insertThread.run(
      thread.threadId,
      rolloutPath,
      1_773_622_800 + index,
      thread.updatedAt ?? 1_773_623_100 + index,
      "vscode",
      input.repoRoot,
      thread.title,
      thread.archived ? 1 : 0
    );
    await fs.writeFile(
      rolloutPath,
      `${JSON.stringify({
        timestamp: "2026-03-16T09:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: `Seeded thread ${thread.threadId}`
        }
      })}\n`,
      "utf8"
    );
  }
  database.close();

  await fs.writeFile(
    path.join(input.codexHome, "session_index.jsonl"),
    input.threads
      .map((thread) =>
        JSON.stringify({
          id: thread.threadId,
          title: thread.title
        })
      )
      .join("\n")
      .concat("\n"),
    "utf8"
  );
}

async function seedPendingApproval(
  runtime: GatewayRuntime,
  repoRoot: string,
  input: {
    approvalId?: string;
    threadId?: string;
    turnId?: string;
  } = {}
) {
  const timestamp = nowIso();
  const threadId = input.threadId ?? "thread_demo";
  const turnId = input.turnId ?? "turn_demo";
  const approvalId = input.approvalId ?? "approval_demo";

  runtime.store.saveProject({
    project_id: "project_demo",
    repo_root: repoRoot,
    created_at: timestamp,
    updated_at: timestamp
  });
  runtime.store.saveThread({
    project_id: "project_demo",
    thread_id: threadId,
    state: "waiting_approval",
    active_turn_id: turnId,
    pending_turn_ids: [],
    pending_approval_ids: [approvalId],
    worktree_path: repoRoot,
    adapter_kind: "codex-app-server",
    last_stream_seq: 0,
    created_at: timestamp,
    updated_at: timestamp
  });
  runtime.store.saveTurn({
    project_id: "project_demo",
    thread_id: threadId,
    turn_id: turnId,
    prompt: "Need approval first",
    state: "waiting_approval",
    created_at: timestamp,
    updated_at: timestamp
  });
  runtime.store.saveApproval({
    approval_id: approvalId,
    project_id: "project_demo",
    thread_id: threadId,
    turn_id: turnId,
    kind: "command",
    source: "legacy_gateway",
    status: "requested",
    reason: "Need confirmation.",
    requested_at: timestamp,
    recoverable: true,
    available_decisions: ["approved", "rejected"]
  });

  return {
    approvalId,
    threadId
  };
}

async function readStreamUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  pattern: string,
  timeoutMs = 3_000
) {
  const decoder = new TextDecoder();
  let collected = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value?: Uint8Array }>((resolve) => {
        setTimeout(() => resolve({ done: true }), 250);
      })
    ]);

    if (result.value) {
      collected += decoder.decode(result.value, {
        stream: true
      });
      if (collected.includes(pattern)) {
        return collected;
      }
    }
  }

  throw new Error(`Timed out waiting for stream pattern: ${pattern}`);
}

describe("gateway recovery routes", () => {
  it("resolves approval commands and replays the resulting event stream", async () => {
    const { runtime, repoRoot } = await createRuntime();
    await seedPendingApproval(runtime, repoRoot);

    const approve = await runtime.app.inject({
      method: "POST",
      url: "/approvals/approval_demo/approve",
      payload: {
        actor_id: "phone",
        request_id: "req-approve-demo"
      }
    });

    expect(approve.statusCode).toBe(200);
    expect(approve.json().approval.status).toBe("approved");

    const events = await runtime.app.inject({
      method: "GET",
      url: "/threads/thread_demo/events?after_seq=0"
    });

    expect(events.statusCode).toBe(200);
    expect(events.json().events.some((event: { event_type: string }) => event.event_type === "approval.resolved")).toBe(
      true
    );
  });

  it("applies stored patches through the restored route", async () => {
    const { runtime, repoRoot } = await createRuntime();
    const timestamp = nowIso();

    runtime.store.saveProject({
      project_id: "project_demo",
      repo_root: repoRoot,
      created_at: timestamp,
      updated_at: timestamp
    });
    runtime.store.saveThread({
      project_id: "project_demo",
      thread_id: "thread_demo",
      state: "needs_review",
      active_turn_id: "turn_demo",
      pending_turn_ids: [],
      pending_approval_ids: [],
      worktree_path: repoRoot,
      adapter_kind: "codex-app-server",
      last_stream_seq: 0,
      created_at: timestamp,
      updated_at: timestamp
    });
    runtime.store.saveTurn({
      project_id: "project_demo",
      thread_id: "thread_demo",
      turn_id: "turn_demo",
      prompt: "Generate patch",
      state: "streaming",
      created_at: timestamp,
      updated_at: timestamp
    });
    runtime.store.savePatch({
      patch_id: "patch_demo",
      project_id: "project_demo",
      thread_id: "thread_demo",
      turn_id: "turn_demo",
      status: "generated",
      summary: "Write recovered file",
      files: [
        {
          path: "notes/recovered.txt",
          added_lines: 1,
          removed_lines: 0
        }
      ],
      changes: [
        {
          path: "notes/recovered.txt",
          before_content: null,
          after_content: "Recovered through server route\n"
        }
      ],
      rollback_available: false,
      created_at: timestamp,
      updated_at: timestamp
    });

    const applyPatch = await runtime.app.inject({
      method: "POST",
      url: "/patches/patch_demo/apply",
      payload: {
        actor_id: "phone",
        request_id: "req-apply-demo"
      }
    });

    expect(applyPatch.statusCode).toBe(200);
    expect(applyPatch.json().patch.status).toBe("applied");
    await expect(
      fs.readFile(path.join(repoRoot, "notes", "recovered.txt"), "utf8")
    ).resolves.toContain("Recovered through server route");
  });

  it("replays approval events over SSE", async () => {
    const { runtime, repoRoot } = await createRuntime();
    const { approvalId, threadId } = await seedPendingApproval(runtime, repoRoot, {
      approvalId: "approval_sse",
      threadId: "thread_sse",
      turnId: "turn_sse"
    });

    await runtime.app.inject({
      method: "POST",
      url: `/approvals/${approvalId}/approve`,
      payload: {
        actor_id: "phone",
        request_id: "req-approve-sse"
      }
    });

    const baseUrl = await runtime.app.listen({
      host: "127.0.0.1",
      port: 0
    });
    const controller = new AbortController();
    const response = await fetch(
      `${baseUrl}/events?thread_id=${threadId}&last_seen_seq=0`,
      {
        signal: controller.signal
      }
    );
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    await expect(readStreamUntil(reader!, "approval.resolved")).resolves.toContain(
      "\"event_type\":\"approval.resolved\""
    );
    await reader?.cancel();
    controller.abort();
  });

  it("streams live approval events over WebSocket", async () => {
    const { runtime, repoRoot } = await createRuntime();
    const { approvalId, threadId } = await seedPendingApproval(runtime, repoRoot, {
      approvalId: "approval_ws",
      threadId: "thread_ws",
      turnId: "turn_ws"
    });

    const baseUrl = await runtime.app.listen({
      host: "127.0.0.1",
      port: 0
    });
    const wsUrl = new URL("/ws", baseUrl);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.searchParams.set("thread_id", threadId);
    wsUrl.searchParams.set("last_seen_seq", "0");

    const eventPromise = new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(wsUrl.toString());
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("Timed out waiting for websocket event"));
      }, 3_000);

      socket.on("open", async () => {
        await runtime.app.inject({
          method: "POST",
          url: `/approvals/${approvalId}/approve`,
          payload: {
            actor_id: "phone",
            request_id: "req-approve-ws"
          }
        });
      });
      socket.on("message", (payload) => {
        const text = payload.toString();
        if (!text.includes("approval.resolved")) {
          return;
        }
        clearTimeout(timeout);
        socket.close();
        resolve(text);
      });
      socket.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    await expect(eventPromise).resolves.toContain("\"event_type\":\"approval.resolved\"");
  });

  it("returns archived threads on demand and surfaces native input in the queue", async () => {
    const { runtime, repoRoot, codexHome } = await createRuntime();
    const timestamp = nowIso();

    await seedSharedStateThreads({
      codexHome,
      repoRoot,
      threads: [
        {
          threadId: "thread_active",
          title: "Active thread"
        },
        {
          threadId: "thread_archived",
          title: "Archived thread",
          archived: true
        }
      ]
    });

    runtime.store.saveProject({
      project_id: "project_demo",
      repo_root: repoRoot,
      created_at: timestamp,
      updated_at: timestamp
    });
    runtime.store.saveThread({
      project_id: "project_demo",
      thread_id: "thread_active",
      state: "waiting_input",
      active_turn_id: "turn_active",
      pending_turn_ids: [],
      pending_approval_ids: [],
      worktree_path: repoRoot,
      adapter_kind: "codex-app-server",
      last_stream_seq: 0,
      created_at: timestamp,
      updated_at: timestamp
    });
    runtime.store.saveTurn({
      project_id: "project_demo",
      thread_id: "thread_active",
      turn_id: "turn_active",
      prompt: "Need more info",
      state: "waiting_input",
      created_at: timestamp,
      updated_at: timestamp
    });
    runtime.store.saveNativeRequest({
      native_request_id: "native_demo",
      project_id: "project_demo",
      thread_id: "thread_active",
      turn_id: "turn_active",
      kind: "user_input",
      source: "native",
      title: "Input requested",
      prompt: "Choose an environment",
      status: "requested",
      requested_at: timestamp,
      payload: {
        questions: [
          {
            id: "env",
            question: "Choose an environment"
          }
        ]
      }
    });
    runtime.store.saveThread({
      project_id: "project_demo",
      thread_id: "thread_archived",
      state: "archived",
      active_turn_id: null,
      pending_turn_ids: [],
      pending_approval_ids: [],
      worktree_path: repoRoot,
      adapter_kind: "codex-app-server",
      last_stream_seq: 0,
      created_at: timestamp,
      updated_at: timestamp
    });

    const activeOnly = await runtime.app.inject({
      method: "GET",
      url: "/overview"
    });
    const withArchived = await runtime.app.inject({
      method: "GET",
      url: "/overview?include_archived=1"
    });

    expect(activeOnly.statusCode).toBe(200);
    expect(activeOnly.json().threads.map((thread: { thread_id: string }) => thread.thread_id)).toEqual([
      "thread_active"
    ]);
    expect(
      activeOnly.json().queue.some(
        (entry: {
          kind: string;
          native_request_kind?: string;
          thread_id: string;
          status: string;
        }) =>
          entry.kind === "input" &&
          entry.native_request_kind === "user_input" &&
          entry.thread_id === "thread_active" &&
          entry.status === "Waiting for input"
      )
    ).toBe(true);

    expect(withArchived.statusCode).toBe(200);
    expect(
      withArchived
        .json()
        .threads.map((thread: { thread_id: string }) => thread.thread_id)
        .sort()
    ).toEqual(["thread_active", "thread_archived"]);
  });

  it("uploads thread images and returns attachment metadata", async () => {
    const { runtime, repoRoot } = await createRuntime();
    const timestamp = nowIso();

    runtime.store.saveProject({
      project_id: "project_demo",
      repo_root: repoRoot,
      created_at: timestamp,
      updated_at: timestamp
    });
    runtime.store.saveThread({
      project_id: "project_demo",
      thread_id: "thread_upload",
      state: "ready",
      active_turn_id: null,
      pending_turn_ids: [],
      pending_approval_ids: [],
      worktree_path: repoRoot,
      adapter_kind: "codex-app-server",
      last_stream_seq: 0,
      created_at: timestamp,
      updated_at: timestamp
    });

    const baseUrl = await runtime.app.listen({
      host: "127.0.0.1",
      port: 0
    });

    const formData = new FormData();
    formData.set(
      "file",
      new File([Buffer.from("png")], "screen.png", {
        type: "image/png"
      })
    );

    const response = await fetch(`${baseUrl}/threads/thread_upload/attachments/images`, {
      method: "POST",
      body: formData
    });
    const payload = (await response.json()) as {
      attachment_id: string;
      thread_id: string;
      file_name: string;
      content_type: string;
    };

    expect(response.status).toBe(200);
    expect(payload.thread_id).toBe("thread_upload");
    expect(payload.file_name).toBe("screen.png");
    expect(payload.content_type).toBe("image/png");
    expect(payload.attachment_id).toMatch(/^attachment_/);
  });

  it("lists skills for a thread through the gateway route", async () => {
    const { runtime, repoRoot } = await createRuntime({
      codexCommandBridgeOptions: {
        command: process.execPath,
        args: [
          path.join(
            process.cwd(),
            "src",
            "adapters",
            "__fixtures__",
            "fake-app-server.mjs"
          )
        ]
      }
    });
    const timestamp = nowIso();

    runtime.store.saveProject({
      project_id: "project_demo",
      repo_root: repoRoot,
      created_at: timestamp,
      updated_at: timestamp
    });
    runtime.store.saveThread({
      project_id: "project_demo",
      thread_id: "thread_skills",
      state: "ready",
      active_turn_id: null,
      pending_turn_ids: [],
      pending_approval_ids: [],
      worktree_path: repoRoot,
      adapter_kind: "codex-app-server",
      last_stream_seq: 0,
      created_at: timestamp,
      updated_at: timestamp
    });

    const response = await runtime.app.inject({
      method: "GET",
      url: "/threads/thread_skills/skills"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      cwd: repoRoot,
      skills: [
        {
          name: "checks",
          description: "Run project checks",
          short_description: "Run checks",
          display_name: "Checks",
          path: "/skills/checks/SKILL.md"
        }
      ],
      errors: []
    });
  });
});
