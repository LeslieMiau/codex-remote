import { afterEach, describe, expect, it, vi } from "vitest";

import type { StartTurnResponse } from "@codex-remote/protocol";

import { GatewayStore } from "../lib/store";
import { nowIso } from "../lib/time";
import { createGatewayRepositories } from "../repositories/gateway-repositories";
import type { ThreadRuntimeManager } from "../runtime/thread-runtime-manager";
import { GatewayRunService } from "./run-service";

let store: GatewayStore | null = null;

afterEach(() => {
  store?.close();
  store = null;
});

async function createHarness() {
  store = await GatewayStore.open(":memory:");
  const timestamp = nowIso();

  store.saveProject({
    project_id: "project_demo",
    repo_root: "/repo/codex-remote",
    created_at: timestamp,
    updated_at: timestamp
  });
  store.saveThread({
    project_id: "project_demo",
    thread_id: "thread_demo",
    state: "ready",
    active_turn_id: null,
    pending_turn_ids: [],
    pending_approval_ids: [],
    adapter_kind: "codex-app-server",
    last_stream_seq: 0,
    created_at: timestamp,
    updated_at: timestamp
  });

  const repositories = createGatewayRepositories(store);
  const readModels = {
    getThread: vi.fn(async () => ({
      thread_id: "thread_demo",
      project_id: "project_demo",
      project_label: "codex-remote",
      title: "Demo",
      archived: false,
      state: "ready",
      origin: "shared_gateway",
      updated_at: timestamp,
      pending_approvals: 0,
      pending_patches: 0,
      pending_native_requests: 0,
      sync_state: "live"
    }))
  };
  const startTurn = vi.fn(async (): Promise<StartTurnResponse> => ({
    deduplicated: false,
    thread: {
      project_id: "project_demo",
      thread_id: "thread_demo",
      state: "running",
      active_turn_id: "turn_demo",
      pending_turn_ids: ["turn_demo"],
      pending_approval_ids: [],
      adapter_kind: "codex-app-server",
      last_stream_seq: 0,
      created_at: timestamp,
      updated_at: timestamp,
      native_title: "Demo"
    },
    turn: {
      project_id: "project_demo",
      turn_id: "turn_demo",
      thread_id: "thread_demo",
      prompt: "continue",
      state: "started",
      created_at: timestamp,
      updated_at: timestamp
    }
  }));
  const manager = {
    startTurn,
    resolveApproval: vi.fn(),
    resolvePatch: vi.fn(),
    resolveNativeRequest: vi.fn(),
    rollbackPatch: vi.fn()
  };

  return {
    repositories,
    readModels,
    manager,
    service: new GatewayRunService(
      repositories,
      readModels as never,
      manager as never as ThreadRuntimeManager
    ),
    timestamp
  };
}

describe("GatewayRunService", () => {
  it("blocks new turns when repository state shows a pending approval", async () => {
    const { service, readModels, manager, timestamp } = await createHarness();

    store!.saveApproval({
      approval_id: "approval_demo",
      project_id: "project_demo",
      thread_id: "thread_demo",
      turn_id: "turn_demo",
      kind: "command",
      source: "legacy_gateway",
      status: "requested",
      reason: "Need confirmation.",
      requested_at: timestamp,
      recoverable: true,
      available_decisions: ["approved", "rejected"]
    });

    await expect(
      service.startTurn({
        threadId: "thread_demo",
        body: {
          actor_id: "phone",
          request_id: "req-pending-approval",
          prompt: "continue"
        }
      })
    ).rejects.toThrow("approval_required");

    expect(readModels.getThread).toHaveBeenCalledWith("thread_demo");
    expect(manager.startTurn).not.toHaveBeenCalled();
  });

  it("starts a turn when repository state has no pending blocking actions", async () => {
    const { service, manager } = await createHarness();

    const response = await service.startTurn({
      threadId: "thread_demo",
      body: {
        actor_id: "phone",
        request_id: "req-start-turn",
        prompt: "continue",
        collaboration_mode: "plan"
      }
    });

    expect(response.deduplicated).toBe(false);
    expect(manager.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: "phone",
        request_id: "req-start-turn",
        prompt: "continue",
        collaboration_mode: "plan",
        thread_id: "thread_demo",
        command_type: "turns.start"
      })
    );
  });
});
