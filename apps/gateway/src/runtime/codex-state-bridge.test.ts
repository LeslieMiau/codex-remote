import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GatewayStore } from "../lib/store";
import { nowIso } from "../lib/time";
import { CodexStateBridge } from "./codex-state-bridge";
import { SessionHub } from "./session-hub";

const cleanupRoots = new Set<string>();

afterEach(async () => {
  for (const root of cleanupRoots) {
    await fs.rm(root, {
      force: true,
      recursive: true
    });
  }
  cleanupRoots.clear();
});

async function createBridgeHarness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-state-bridge-"));
  cleanupRoots.add(root);

  const repoRoot = path.join(root, "repo");
  const codexHome = path.join(root, ".codex");
  await fs.mkdir(repoRoot, {
    recursive: true
  });
  await fs.mkdir(codexHome, {
    recursive: true
  });

  const store = await GatewayStore.open(":memory:");
  const timestamp = nowIso();
  store.saveProject({
    project_id: "project_demo",
    repo_root: repoRoot,
    created_at: timestamp,
    updated_at: timestamp
  });

  const bridge = new CodexStateBridge({
    adapterKind: "codex-app-server",
    codexHome,
    pollIntervalMs: 60_000,
    sessionHub: new SessionHub(),
    store
  });

  return {
    bridge,
    repoRoot,
    store
  };
}

describe("CodexStateBridge", () => {
  it("reports plan collaboration mode when shared app-server state is available", async () => {
    const { bridge, store } = await createBridgeHarness();
    await fs.writeFile(path.join((bridge as unknown as { codexHome: string }).codexHome, "state_5.sqlite"), "");
    await fs.writeFile(
      path.join((bridge as unknown as { codexHome: string }).codexHome, "session_index.jsonl"),
      ""
    );

    await expect(bridge.getCapabilities()).resolves.toMatchObject({
      collaboration_mode: "plan",
      shared_state_available: true,
      shared_thread_create: true,
      run_start: true,
      live_follow_up: true
    });

    await bridge.stop();
    store.close();
  });

  it("falls back to default collaboration mode when shared state is unavailable", async () => {
    const { bridge, store } = await createBridgeHarness();

    await expect(bridge.getCapabilities()).resolves.toMatchObject({
      collaboration_mode: "default",
      shared_state_available: false,
      shared_thread_create: false,
      run_start: false,
      live_follow_up: false
    });

    await bridge.stop();
    store.close();
  });

  it("keeps a freshly created shared thread while native discovery catches up", async () => {
    const { bridge, repoRoot, store } = await createBridgeHarness();
    const timestamp = nowIso();

    store.saveThread({
      project_id: "project_demo",
      thread_id: "thread_recent",
      state: "ready",
      active_turn_id: null,
      pending_turn_ids: [],
      pending_approval_ids: [],
      worktree_path: repoRoot,
      adapter_kind: "codex-app-server",
      adapter_thread_ref: "thread_recent",
      last_stream_seq: 0,
      created_at: timestamp,
      updated_at: timestamp
    });

    await bridge.syncStore();

    expect(store.getThread("thread_recent")?.thread_id).toBe("thread_recent");

    await bridge.stop();
    store.close();
  });

  it("removes stale unsynced shared threads after the discovery grace window", async () => {
    const { bridge, repoRoot, store } = await createBridgeHarness();
    const staleTimestamp = "2026-03-20T00:00:00.000Z";

    store.saveThread({
      project_id: "project_demo",
      thread_id: "thread_stale",
      state: "ready",
      active_turn_id: null,
      pending_turn_ids: [],
      pending_approval_ids: [],
      worktree_path: repoRoot,
      adapter_kind: "codex-app-server",
      adapter_thread_ref: "thread_stale",
      last_stream_seq: 0,
      created_at: staleTimestamp,
      updated_at: staleTimestamp
    });

    await bridge.syncStore();

    expect(store.getThread("thread_stale")).toBeUndefined();

    await bridge.stop();
    store.close();
  });
});
