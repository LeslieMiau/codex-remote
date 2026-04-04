import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { TurnInputItem } from "@codex-remote/protocol";

import { CodexAttachmentStore } from "../runtime/codex-attachment-store";
import type { PatchDecision } from "./types";
import { CodexAppServerAdapter } from "./codex-app-server-adapter";

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "codex-remote-adapter-"));
}

async function waitFor(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runAdapterTurn(input: {
  attachmentStore?: CodexAttachmentStore;
  adapterThreadRef?: string;
  interruptAfterMs?: number;
  logPath: string;
  nativeResponsePayload?: Record<string, unknown>;
  patchAction?: PatchDecision["action"];
  prompt?: string;
  turnInput?: {
    prompt: string;
    input_items?: TurnInputItem[];
  };
  turnId: string;
}) {
  const root = await createTempDir();
  const worktreePath = path.join(root, "worktree");
  await fs.mkdir(worktreePath, { recursive: true });

  const adapter = new CodexAppServerAdapter({
    command: process.execPath,
    args: [
      path.join(
        process.cwd(),
        "src",
        "adapters",
        "__fixtures__",
        "fake-app-server.mjs"
      ),
      input.logPath
    ],
    attachmentStore: input.attachmentStore,
    requestTimeoutMs: 5_000
  });

  const approvals: Array<{
    command?: string;
    kind: string;
    reason: string;
  }> = [];
  const nativeRequests: Array<{
    kind: string;
    prompt?: string;
    title: string;
  }> = [];
  const testsFinished: Array<{
    status: string;
    summary: string;
  }> = [];
  const threadBindings: string[] = [];
  const progressMessages: string[] = [];
  const patchResolutions: Array<{
    action: "apply" | "discard";
    patch_id: string;
  }> = [];
  let execution:
    | {
        interrupt(reason?: string): Promise<void>;
      }
    | undefined;

  const finalState = new Promise<{
    kind: "completed" | "failed";
    summary: string;
  }>((resolve) => {
    void adapter
      .runTurn(
        {
          project: {
            project_id: "project_adapter",
            repo_root: root,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          thread: {
            project_id: "project_adapter",
            thread_id: "thread_adapter",
            state: "running",
            active_turn_id: input.turnId,
            pending_turn_ids: [],
            pending_approval_ids: [],
            worktree_path: worktreePath,
            adapter_kind: input.adapterThreadRef ? "codex-app-server" : undefined,
            adapter_thread_ref: input.adapterThreadRef,
            last_stream_seq: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          turn: {
            project_id: "project_adapter",
            thread_id: "thread_adapter",
            turn_id: input.turnId,
            prompt: input.prompt ?? "Create a file",
            collaboration_mode: "default",
            state: "started",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          worktreePath,
          turnInput: input.turnInput
        },
        {
          onProgress: async (progress) => {
            progressMessages.push(progress.message);
          },
          onThreadBinding: async (binding) => {
            threadBindings.push(binding.thread_ref);
          },
          onApprovalRequest: async (approval) => {
            approvals.push({
              command: approval.command,
              kind: approval.kind,
              reason: approval.reason
            });
            return {
              approval_id: "approval-1",
              status: "approved"
            };
          },
          onNativeRequest: async (request) => {
            nativeRequests.push({
              kind: request.kind,
              prompt: request.prompt,
              title: request.title
            });
            return {
              native_request_id: "native-request-1",
              status: "responded",
              response_payload: input.nativeResponsePayload ?? {
                answers: {
                  answer: {
                    answers: ["confirmed"]
                  }
                }
              }
            };
          },
          onNativeThreadUpdated: async () => {},
          onNativeApprovalResolved: async () => {},
          onTestsFinished: async (result) => {
            testsFinished.push({
              status: result.status,
              summary: result.summary
            });
          },
          onPatchReady: async (): Promise<PatchDecision> => ({
            patch_id: `patch-${input.turnId}`,
            action: input.patchAction ?? "apply"
          }),
          onPatchResolved: async (resolution) => {
            patchResolutions.push({
              action: resolution.action,
              patch_id: resolution.patch_id
            });
          },
          onCompleted: async (summary) => {
            resolve({
              kind: "completed",
              summary
            });
          },
          onFailed: async (failure) => {
            resolve({
              kind: "failed",
              summary: failure.message
            });
          },
          onDiagnostic: async () => {}
        }
      )
      .then((result) => {
        execution = result;
        if (typeof input.interruptAfterMs === "number") {
          setTimeout(() => {
            void result.interrupt("user_requested");
          }, input.interruptAfterMs);
        }
      });
  });

  const result = await Promise.race([
    finalState,
    new Promise<{
      kind: "failed";
      summary: string;
    }>((resolve) => {
      setTimeout(() => {
        void execution?.interrupt("timed_out");
        resolve({
          kind: "failed",
          summary: "timed out"
        });
      }, 5_000);
    })
  ]);

  await waitFor(50);

  return {
    approvals,
    nativeRequests,
    patchResolutions,
    progressMessages,
    result,
    root,
    testsFinished,
    threadBindings,
    worktreePath
  };
}

const cleanupRoots: string[] = [];

afterEach(async () => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    if (root) {
      await fs.rm(root, { force: true, recursive: true });
    }
  }
});

describe("CodexAppServerAdapter", () => {
  it("binds a remote thread, runs a turn, and resumes without starting a new thread", async () => {
    const logOneRoot = await createTempDir();
    cleanupRoots.push(logOneRoot);
    const logOne = path.join(logOneRoot, "fake-server-1.log");

    const firstRun = await runAdapterTurn({
      logPath: logOne,
      turnId: "turn-one"
    });
    cleanupRoots.push(firstRun.root);

    expect(firstRun.result.kind).toBe("completed");
    expect(firstRun.threadBindings).toContain("remote-thread-1");
    expect(firstRun.patchResolutions).toEqual([
      {
        action: "apply",
        patch_id: "patch-turn-one"
      }
    ]);
    expect(firstRun.testsFinished).toEqual([
      {
        status: "passed",
        summary: "test suite passed"
      }
    ]);
    expect(
      await fs.readFile(path.join(firstRun.worktreePath, "notes", "real-1.txt"), "utf8")
    ).toBe("hello-1\n");

    const firstLog = await fs.readFile(logOne, "utf8");
    expect(firstLog).toContain("request:thread/start");
    expect(firstLog).toContain("request:turn/start");

    const logTwoRoot = await createTempDir();
    cleanupRoots.push(logTwoRoot);
    const logTwo = path.join(logTwoRoot, "fake-server-2.log");

    const secondRun = await runAdapterTurn({
      adapterThreadRef: "remote-thread-1",
      logPath: logTwo,
      turnId: "turn-two"
    });
    cleanupRoots.push(secondRun.root);

    expect(secondRun.result.kind).toBe("completed");
    expect(secondRun.threadBindings).toEqual([]);
    expect(
      await fs.readFile(path.join(secondRun.worktreePath, "notes", "real-1.txt"), "utf8")
    ).toBe("hello-1\n");

    const secondLog = await fs.readFile(logTwo, "utf8");
    expect(secondLog).not.toContain("request:thread/start");
    expect(secondLog).toContain("request:thread/resume");
    expect(secondLog).toContain("request:turn/start");
  });

  it("keeps using an existing thread when resume reports no active rollout", async () => {
    const logRoot = await createTempDir();
    cleanupRoots.push(logRoot);
    const logPath = path.join(logRoot, "fake-server-resume-skipped.log");

    const run = await runAdapterTurn({
      adapterThreadRef: "remote-thread-no-rollout",
      logPath,
      turnId: "turn-resume-skipped"
    });
    cleanupRoots.push(run.root);

    expect(run.result.kind).toBe("completed");
    expect(run.threadBindings).toEqual([]);

    const log = await fs.readFile(logPath, "utf8");
    expect(log).toContain("request:thread/resume");
    expect(log).not.toContain("request:thread/start");
    expect(log).toContain("request:turn/start");
  });

  it("routes approval, user input, and test completion callbacks through the adapter", async () => {
    const logRoot = await createTempDir();
    cleanupRoots.push(logRoot);
    const logPath = path.join(logRoot, "fake-server-approval.log");

    const run = await runAdapterTurn({
      logPath,
      prompt: "[fixture:approval] [fixture:user-input] gather confirmation",
      turnId: "turn-approval"
    });
    cleanupRoots.push(run.root);

    expect(run.result.kind).toBe("completed");
    expect(run.approvals).toHaveLength(1);
    expect(run.approvals[0]?.command).toBe("pnpm test");
    expect(run.nativeRequests).toEqual([
      {
        kind: "user_input",
        prompt: "Provide the confirmation text.",
        title: "Input requested"
      }
    ]);
    expect(run.testsFinished).toEqual([
      {
        status: "passed",
        summary: "test suite passed"
      }
    ]);
    expect(run.progressMessages.some((message) => message.includes("Working on it"))).toBe(
      true
    );

    const log = await fs.readFile(logPath, "utf8");
    expect(log).toContain("approval:accept");
    expect(log).toContain("user-input:");
    expect(log).toContain("patch:accept");
  });

  it("interrupts an in-flight turn", async () => {
    const logRoot = await createTempDir();
    cleanupRoots.push(logRoot);
    const logPath = path.join(logRoot, "fake-server-interrupt.log");

    const run = await runAdapterTurn({
      interruptAfterMs: 100,
      logPath,
      prompt: "[fixture:interrupt] wait for manual interrupt",
      turnId: "turn-interrupt"
    });
    cleanupRoots.push(run.root);

    expect(run.result.kind).toBe("failed");
    expect(run.result.summary).toContain("Interrupted by request");

    const log = await fs.readFile(logPath, "utf8");
    expect(log).toContain("request:turn/interrupt");
  });

  it("forwards skill and image attachment inputs to the app server", async () => {
    const logRoot = await createTempDir();
    cleanupRoots.push(logRoot);
    const logPath = path.join(logRoot, "fake-server-structured.log");
    const codexHome = path.join(logRoot, ".codex");
    await fs.mkdir(codexHome, { recursive: true });

    const attachmentStore = new CodexAttachmentStore({
      codexHome
    });
    const attachment = await attachmentStore.saveImage({
      threadId: "thread_adapter",
      fileName: "screen.png",
      contentType: "image/png",
      bytes: Buffer.from("png")
    });

    const run = await runAdapterTurn({
      attachmentStore,
      logPath,
      prompt: "Inspect the uploaded image",
      turnInput: {
        prompt: "Inspect the uploaded image",
        input_items: [
          {
            type: "skill",
            name: "checks",
            path: "/skills/checks/SKILL.md"
          },
          {
            type: "image_attachment",
            attachment_id: attachment.attachment_id,
            file_name: "screen.png"
          }
        ]
      },
      turnId: "turn-structured"
    });
    cleanupRoots.push(run.root);

    expect(run.result.kind).toBe("completed");

    const log = await fs.readFile(logPath, "utf8");
    expect(log).toContain('"type":"skill"');
    expect(log).toContain('"/skills/checks/SKILL.md"');
    expect(log).toContain('"type":"localImage"');
  });
});
