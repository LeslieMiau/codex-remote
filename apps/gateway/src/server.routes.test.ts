import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

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

async function createRuntime() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-routes-"));
  cleanupRoots.add(root);

  const repoRoot = path.join(root, "repo");
  const codexHome = path.join(root, ".codex");
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(codexHome, { recursive: true });

  const runtime = await createGatewayServer({
    databasePath: path.join(root, "gateway.sqlite"),
    adapterKind: "codex-app-server",
    codexHome
  });
  await runtime.app.ready();
  runtimes.push(runtime);

  return {
    repoRoot,
    root,
    runtime
  };
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
});
