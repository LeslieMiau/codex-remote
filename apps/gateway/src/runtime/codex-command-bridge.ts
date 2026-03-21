import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { CodexReviewDelivery, CodexReviewTarget } from "@codex-remote/protocol";

import {
  JsonLineFramer,
  encodeJsonLineMessage
} from "../lib/rpc-framer";
import { resolveCodexAppServerEnvironment } from "../lib/system-proxy";

type JsonRpcId = number | string;

interface PendingRequest {
  method: string;
  reject: (reason?: unknown) => void;
  resolve: (value: Record<string, unknown> | undefined) => void;
  timeout: NodeJS.Timeout;
}

export interface CodexCommandBridgeOptions {
  args?: string[];
  command?: string;
  codexHome?: string;
  requestTimeoutMs?: number;
}

interface ResolvedCodexCommandBridgeOptions {
  args: string[];
  command: string;
  codexHome?: string;
  requestTimeoutMs: number;
}

export interface AppServerThread {
  id: string;
  archived?: boolean;
  createdAt?: string;
  cwd?: string;
  title?: string;
  turns?: unknown[];
  [key: string]: unknown;
}

interface AppServerThreadListResponse {
  data?: AppServerThread[];
  nextCursor?: string | null;
}

interface AppServerThreadReadResponse {
  thread?: AppServerThread;
}

interface AppServerCursorPage<T> {
  data?: T[];
  nextCursor?: string | null;
}

interface AppServerSkill {
  name?: string;
  description?: string;
  shortDescription?: string;
  displayName?: string;
  path?: string;
}

interface AppServerMcpServerStatus {
  authStatus?: string;
  name?: string;
  resourceCount?: number;
  resourceTemplateCount?: number;
  toolCount?: number;
}

interface AppServerReviewStartResponse {
  reviewThreadId?: string;
  turn?: {
    id?: string;
    [key: string]: unknown;
  };
}

export interface CodexSharedThread {
  archived: boolean;
  thread: AppServerThread;
}

export class CodexCommandBridge {
  private readonly options: ResolvedCodexCommandBridgeOptions;

  constructor(options: CodexCommandBridgeOptions = {}) {
    this.options = {
      command: options.command ?? "codex",
      args: options.args ?? ["app-server", "--listen", "stdio://"],
      codexHome: options.codexHome,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000
    };
  }

  private async withClient<T>(
    run: (input: {
      request: (
        method: string,
        params?: Record<string, unknown>
      ) => Promise<Record<string, unknown> | undefined>;
      waitForExit: Promise<never>;
      child: ChildProcessWithoutNullStreams;
    }) => Promise<T>
  ): Promise<T> {
    const envResolution = await resolveCodexAppServerEnvironment(process.env);
    if (this.options.codexHome) {
      envResolution.env.CODEX_HOME = this.options.codexHome;
    }

    const child = spawn(this.options.command, this.options.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: envResolution.env
    });
    const pending = new Map<JsonRpcId, PendingRequest>();
    const framer = new JsonLineFramer();
    let nextId = 1;

    const closeChild = () => {
      if (!child.killed) {
        child.kill();
      }
    };

    const request = (method: string, params?: Record<string, unknown>) => {
      const id = nextId;
      nextId += 1;
      child.stdin.write(
        encodeJsonLineMessage(JSON.stringify({ id, method, params })),
        "utf8"
      );

      return new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for ${method}`));
        }, this.options.requestTimeoutMs);
        pending.set(id, {
          method,
          resolve,
          reject,
          timeout
        });
      });
    };

    const waitForExit = new Promise<never>((_, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        reject(
          new Error(
            `codex app-server exited unexpectedly (code=${code}, signal=${signal})`
          )
        );
      });
    });

    child.stdout.on("data", (chunk) => {
      for (const line of framer.push(chunk)) {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (typeof message.id === "undefined") {
          continue;
        }

        const current = pending.get(message.id as JsonRpcId);
        if (!current) {
          continue;
        }

        clearTimeout(current.timeout);
        pending.delete(message.id as JsonRpcId);
        if (message.error) {
          const error = message.error as { code?: number; message?: string };
          current.reject(
            new Error(`${error.code ?? -1}: ${error.message ?? current.method}`)
          );
        } else {
          current.resolve(message.result as Record<string, unknown> | undefined);
        }
      }
    });

    child.stderr.on("data", () => {
      // Keep stderr noise out of the gateway surface and only bubble up RPC failures.
    });

    try {
      await Promise.race([
        request("initialize", {
          clientInfo: {
            name: "codex-remote",
            version: "0.1.0"
          },
          capabilities: {
            experimentalApi: true
          }
        }),
        waitForExit
      ]);
      child.stdin.write(
        encodeJsonLineMessage(JSON.stringify({ method: "initialized" })),
        "utf8"
      );
      return await run({
        request,
        waitForExit,
        child
      });
    } finally {
      for (const current of pending.values()) {
        clearTimeout(current.timeout);
      }
      pending.clear();
      closeChild();
    }
  }

  async startSharedThread(input: { repoRoot: string }) {
    return this.withClient(async ({ request, waitForExit }) => {
      const response = await Promise.race([
        request("thread/start", {
          cwd: input.repoRoot,
          approvalPolicy: "on-request",
          sandbox: "read-only",
          experimentalRawEvents: false,
          persistExtendedHistory: true
        }),
        waitForExit
      ]);
      const thread = response?.thread as AppServerThread | undefined;
      if (typeof thread?.id !== "string") {
        throw new Error("codex app-server did not return a thread id");
      }

      return {
        thread_id: thread.id
      };
    });
  }

  async listSharedThreads(): Promise<CodexSharedThread[]> {
    return this.withClient(async ({ request, waitForExit }) => {
      const listByArchived = async (archived: boolean) => {
        const results: CodexSharedThread[] = [];
        let cursor: string | null = null;

        do {
          const response = (await Promise.race([
            request("thread/list", {
              archived,
              cursor,
              limit: 200
            }),
            waitForExit
          ])) as AppServerThreadListResponse | undefined;

          for (const thread of response?.data ?? []) {
            results.push({
              archived,
              thread
            });
          }

          cursor = response?.nextCursor ?? null;
        } while (cursor);

        return results;
      };

      const [activeThreads, archivedThreads] = await Promise.all([
        listByArchived(false),
        listByArchived(true)
      ]);
      const deduped = new Map<string, CodexSharedThread>();
      for (const candidate of [...activeThreads, ...archivedThreads]) {
        deduped.set(candidate.thread.id, candidate);
      }
      return [...deduped.values()];
    });
  }

  async readSharedThread(input: { threadId: string; includeTurns?: boolean }) {
    return this.withClient(async ({ request, waitForExit }) => {
      const response = (await Promise.race([
        request("thread/read", {
          threadId: input.threadId,
          includeTurns: input.includeTurns ?? true
        }),
        waitForExit
      ])) as AppServerThreadReadResponse | undefined;

      if (!response?.thread) {
        throw new Error(`codex app-server did not return thread ${input.threadId}`);
      }

      return response.thread;
    });
  }

  async interruptSharedTurn(input: { threadId: string; turnId: string }) {
    return this.withClient(async ({ request, waitForExit }) => {
      try {
        await Promise.race([
          request("thread/resume", {
            threadId: input.threadId
          }),
          waitForExit
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/no rollout found for thread id/i.test(message)) {
          throw error;
        }
      }

      await Promise.race([
        request("turn/interrupt", {
          threadId: input.threadId,
          turnId: input.turnId
        }),
        waitForExit
      ]);

      return {
        interrupted: true
      };
    });
  }

  async steerSharedTurn(input: { threadId: string; turnId: string; prompt: string }) {
    return this.withClient(async ({ request, waitForExit }) => {
      try {
        await Promise.race([
          request("thread/resume", {
            threadId: input.threadId
          }),
          waitForExit
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/no rollout found for thread id/i.test(message)) {
          throw error;
        }
      }

      await Promise.race([
        request("turn/steer", {
          threadId: input.threadId,
          expectedTurnId: input.turnId,
          input: [
            {
              type: "text",
              text: input.prompt,
              text_elements: []
            }
          ]
        }),
        waitForExit
      ]);

      return {
        steered: true
      };
    });
  }

  async renameSharedThread(input: { threadId: string; name: string }) {
    return this.withClient(async ({ request, waitForExit }) => {
      await Promise.race([
        request("thread/rename", {
          threadId: input.threadId,
          name: input.name
        }),
        waitForExit
      ]);

      return {
        renamed: true
      };
    });
  }

  async archiveSharedThread(input: { threadId: string }) {
    return this.withClient(async ({ request, waitForExit }) => {
      await Promise.race([
        request("thread/archive", {
          threadId: input.threadId
        }),
        waitForExit
      ]);

      return {
        archived: true
      };
    });
  }

  async unarchiveSharedThread(input: { threadId: string }) {
    return this.withClient(async ({ request, waitForExit }) => {
      await Promise.race([
        request("thread/unarchive", {
          threadId: input.threadId
        }),
        waitForExit
      ]);

      return {
        unarchived: true
      };
    });
  }

  async compactSharedThread(input: { threadId: string }) {
    return this.withClient(async ({ request, waitForExit }) => {
      await Promise.race([
        request("thread/compact", {
          threadId: input.threadId
        }),
        waitForExit
      ]);

      return {
        compacted: true
      };
    });
  }

  async forkSharedThread(input: { threadId: string }) {
    return this.withClient(async ({ request, waitForExit }) => {
      const response = await Promise.race([
        request("thread/fork", {
          threadId: input.threadId
        }),
        waitForExit
      ]);
      const threadId =
        (typeof response?.threadId === "string" && response.threadId) ||
        (typeof (response?.thread as Record<string, unknown> | undefined)?.id === "string"
          ? String((response?.thread as Record<string, unknown>).id)
          : "");

      if (!threadId) {
        throw new Error("codex app-server did not return a forked thread id");
      }

      return {
        thread_id: threadId
      };
    });
  }

  async rollbackSharedThread(input: { threadId: string; numTurns?: number }) {
    return this.withClient(async ({ request, waitForExit }) => {
      const response = await Promise.race([
        request("thread/rollback", {
          threadId: input.threadId,
          numTurns: input.numTurns
        }),
        waitForExit
      ]);
      const threadId =
        (typeof response?.threadId === "string" && response.threadId) ||
        input.threadId;

      return {
        thread_id: threadId
      };
    });
  }

  async startReview(input: {
    threadId: string;
    target: CodexReviewTarget;
    delivery?: CodexReviewDelivery;
  }) {
    return this.withClient(async ({ request, waitForExit }) => {
      const target =
        input.target.type === "commit"
          ? {
              type: "commit",
              sha: input.target.sha,
              title: input.target.title ?? null
            }
          : input.target;

      const response = (await Promise.race([
        request("review/start", {
          threadId: input.threadId,
          target,
          delivery: input.delivery
        }),
        waitForExit
      ])) as AppServerReviewStartResponse | undefined;

      if (!response?.turn?.id || !response.reviewThreadId) {
        throw new Error("codex app-server did not return a review thread.");
      }

      return {
        review_thread_id: response.reviewThreadId,
        review_turn_id: response.turn.id
      };
    });
  }

  async listModels(input?: { includeHidden?: boolean }) {
    return this.withClient(async ({ request, waitForExit }) => {
      const data: Record<string, unknown>[] = [];
      let cursor: string | null = null;

      do {
        const response = (await Promise.race([
          request("model/list", {
            cursor,
            limit: 200,
            includeHidden: input?.includeHidden ?? false
          }),
          waitForExit
        ])) as AppServerCursorPage<Record<string, unknown>> | undefined;

        data.push(...(response?.data ?? []));
        cursor = response?.nextCursor ?? null;
      } while (cursor);

      return data;
    });
  }

  async readConfig(input?: { cwd?: string | null; includeLayers?: boolean }) {
    return this.withClient(async ({ request, waitForExit }) => {
      const response = await Promise.race([
        request("config/read", {
          cwd: input?.cwd ?? undefined,
          includeLayers: input?.includeLayers ?? true
        }),
        waitForExit
      ]);

      if (!response) {
        throw new Error("codex app-server did not return config.");
      }

      return response;
    });
  }

  async batchWriteConfig(input: {
    edits: Array<{
      keyPath: string;
      value: unknown;
      mergeStrategy: "replace" | "upsert";
    }>;
    filePath?: string | null;
    expectedVersion?: string | null;
  }) {
    return this.withClient(async ({ request, waitForExit }) => {
      const response = await Promise.race([
        request("config/batchWrite", {
          edits: input.edits,
          filePath: input.filePath ?? undefined,
          expectedVersion: input.expectedVersion ?? undefined
        }),
        waitForExit
      ]);

      if (!response) {
        throw new Error("codex app-server did not confirm config write.");
      }

      return response;
    });
  }

  async readConfigRequirements() {
    return this.withClient(async ({ request, waitForExit }) => {
      const response = await Promise.race([
        request("configRequirements/read"),
        waitForExit
      ]);

      return (response?.requirements as Record<string, unknown> | null | undefined) ?? null;
    });
  }

  async listExperimentalFeatures() {
    return this.withClient(async ({ request, waitForExit }) => {
      const data: Record<string, unknown>[] = [];
      let cursor: string | null = null;

      do {
        const response = (await Promise.race([
          request("experimentalFeature/list", {
            cursor,
            limit: 200
          }),
          waitForExit
        ])) as AppServerCursorPage<Record<string, unknown>> | undefined;

        data.push(...(response?.data ?? []));
        cursor = response?.nextCursor ?? null;
      } while (cursor);

      return data;
    });
  }

  async readAccount(input?: { refreshToken?: boolean }) {
    return this.withClient(async ({ request, waitForExit }) => {
      const response = await Promise.race([
        request("account/read", {
          refreshToken: input?.refreshToken ?? false
        }),
        waitForExit
      ]);

      return response ?? null;
    });
  }

  async readRateLimits() {
    return this.withClient(async ({ request, waitForExit }) => {
      const response = await Promise.race([
        request("account/rateLimits/read"),
        waitForExit
      ]);

      return response ?? null;
    });
  }

  async listMcpServerStatuses() {
    return this.withClient(async ({ request, waitForExit }) => {
      const data: AppServerMcpServerStatus[] = [];
      let cursor: string | null = null;

      do {
        const response = (await Promise.race([
          request("mcpServerStatus/list", {
            cursor,
            limit: 200
          }),
          waitForExit
        ])) as AppServerCursorPage<AppServerMcpServerStatus> | undefined;

        data.push(...(response?.data ?? []));
        cursor = response?.nextCursor ?? null;
      } while (cursor);

      return data;
    });
  }

  async listSkills(input?: { cwd?: string | null; forceReload?: boolean }) {
    return this.withClient(async ({ request, waitForExit }) => {
      const data: AppServerSkill[] = [];
      let cursor: string | null = null;

      do {
        const response = (await Promise.race([
          request("skills/list", {
            cursor,
            limit: 200,
            cwd: input?.cwd ?? undefined,
            forceReload: input?.forceReload ?? false
          }),
          waitForExit
        ])) as AppServerCursorPage<AppServerSkill> | undefined;

        data.push(...(response?.data ?? []));
        cursor = response?.nextCursor ?? null;
      } while (cursor);

      return data;
    });
  }
}
