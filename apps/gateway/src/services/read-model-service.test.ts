import { afterEach, describe, expect, it } from "vitest";

import { GatewayStore } from "../lib/store";
import { nowIso } from "../lib/time";
import { GatewayFallbackProjection } from "../projections/fallback-thread-projection";
import { createGatewayRepositories } from "../repositories/gateway-repositories";
import { GatewayReadModelService } from "./read-model-service";

let store: GatewayStore | null = null;

afterEach(() => {
  store?.close();
  store = null;
});

async function createService() {
  store = await GatewayStore.open(":memory:");
  const repositories = createGatewayRepositories(store);
  const fallbackProjection = new GatewayFallbackProjection(repositories);
  return new GatewayReadModelService(repositories, {
    async getOverview() {
      return {
        projects: [],
        threads: [],
        queue: [],
        capabilities: {
          collaboration_mode: "default",
          shared_state_available: false,
          shared_thread_create: false,
          supports_images: false,
          run_start: false,
          live_follow_up: false,
          image_inputs: false,
          interrupt: false,
          approvals: true,
          patch_decisions: true,
          thread_rename: false,
          thread_archive: false,
          thread_compact: false,
          thread_fork: false,
          thread_rollback: false,
          review_start: false,
          skills_input: false,
          diagnostics_read: false,
          settings_read: false,
          settings_write: false,
          shared_model_config: false,
          shared_history: false,
          shared_threads: false
        }
      };
    },
    async getThread() {
      return null;
    },
    async getTimeline() {
      return null;
    },
    async getTranscriptPage() {
      return null;
    }
  }, fallbackProjection);
}

describe("GatewayReadModelService", () => {
  it("builds fallback thread projections from mirrored store data", async () => {
    const service = await createService();
    const timestamp = nowIso();

    store!.saveProject({
      project_id: "project_demo",
      repo_root: "/repo/codex-remote",
      created_at: timestamp,
      updated_at: timestamp
    });
    store!.saveThread({
      project_id: "project_demo",
      thread_id: "thread_demo",
      state: "waiting_approval",
      active_turn_id: "turn_demo",
      pending_turn_ids: [],
      pending_approval_ids: ["approval_demo"],
      adapter_kind: "codex-app-server",
      last_stream_seq: 2,
      created_at: timestamp,
      updated_at: timestamp
    });
    store!.saveTurn({
      project_id: "project_demo",
      thread_id: "thread_demo",
      turn_id: "turn_demo",
      prompt: "Need approval",
      state: "waiting_approval",
      created_at: timestamp,
      updated_at: timestamp
    });
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

    const thread = await service.getThread("thread_demo");

    expect(thread?.state).toBe("waiting_approval");
    expect(thread?.pending_approvals).toBe(1);
    expect(thread?.project_label).toBe("codex-remote");
    expect(thread?.degraded).toBe(true);
    expect(thread?.degraded_reason).toBe("recovery_fallback");
  });

  it("builds fallback transcripts with live state when native state is unavailable", async () => {
    const service = await createService();
    const timestamp = nowIso();

    store!.saveProject({
      project_id: "project_demo",
      repo_root: "/repo/codex-remote",
      created_at: timestamp,
      updated_at: timestamp
    });
    store!.saveThread({
      project_id: "project_demo",
      thread_id: "thread_demo",
      state: "completed",
      active_turn_id: null,
      pending_turn_ids: [],
      pending_approval_ids: [],
      adapter_kind: "codex-app-server",
      last_stream_seq: 1,
      created_at: timestamp,
      updated_at: timestamp
    });
    store!.saveTurn({
      project_id: "project_demo",
      thread_id: "thread_demo",
      turn_id: "turn_demo",
      prompt: "Hello",
      state: "completed",
      created_at: timestamp,
      updated_at: timestamp
    });
    store!.saveLiveState("thread_demo", {
      turn_id: "turn_demo",
      status: "completed",
      detail: "Done",
      assistant_text: "",
      details: [],
      updated_at: timestamp,
      awaiting_native_commit: false
    });

    const transcript = await service.getTranscriptPage({
      threadId: "thread_demo",
      limit: 10
    });

    expect(transcript?.thread.state).toBe("completed");
    expect(transcript?.thread.degraded).toBe(true);
    expect(transcript?.thread.sync_state).toBe("sync_failed");
    expect(transcript?.items).toHaveLength(1);
    expect(transcript?.live_state?.detail).toBe("Done");
  });
});
