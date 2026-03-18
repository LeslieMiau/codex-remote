import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openSqliteDatabase } from "../lib/sqlite";
import { CodexNativeThreadMarker } from "./codex-native-thread-marker";

describe("CodexNativeThreadMarker", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-native-thread-marker-"));
    const database = await openSqliteDatabase(path.join(tempDir, "state_5.sqlite"));
    database.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        model_provider TEXT NOT NULL DEFAULT 'openai',
        cwd TEXT NOT NULL,
        title TEXT NOT NULL,
        sandbox_policy TEXT NOT NULL DEFAULT 'read-only',
        approval_mode TEXT NOT NULL DEFAULT 'on-request',
        tokens_used INTEGER NOT NULL DEFAULT 0,
        has_user_event INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0
      );
    `);
    database
      .prepare(
        `INSERT INTO threads(
          id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
          sandbox_policy, approval_mode, tokens_used, has_user_event, archived
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "thread-1",
        path.join(tempDir, "rollout.jsonl"),
        100,
        100,
        "vscode",
        "openai",
        tempDir,
        "hello",
        "read-only",
        "on-request",
        0,
        0,
        0
      );
    database.close();
    const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
    await writeFile(sessionIndexPath, '{"id":"thread-1"}\n', "utf8");
    const pastTimestamp = new Date(Date.now() - 10_000);
    await utimes(sessionIndexPath, pastTimestamp, pastTimestamp);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("bumps updated_at and marks user events", async () => {
    const marker = new CodexNativeThreadMarker({
      codexHome: tempDir,
      throttleMs: 0
    });
    const beforeStat = await stat(path.join(tempDir, "session_index.jsonl"));

    await marker.touchThread("thread-1", {
      markUserEvent: true,
      force: true
    });

    const database = await openSqliteDatabase(path.join(tempDir, "state_5.sqlite"), {
      readonly: true,
      fileMustExist: true
    });
    const row = database
      .prepare("SELECT updated_at, has_user_event FROM threads WHERE id = ?")
      .get<{ updated_at: number; has_user_event: number }>("thread-1");

    expect(row?.updated_at).toBeGreaterThan(100);
    expect(row?.has_user_event).toBe(1);
    const afterStat = await stat(path.join(tempDir, "session_index.jsonl"));
    expect(afterStat.mtimeMs).toBeGreaterThan(beforeStat.mtimeMs);

    database.close();
    await marker.close();
  });

  it("falls back to updated_at when has_user_event is unavailable", async () => {
    const bareDir = await mkdtemp(path.join(os.tmpdir(), "codex-native-thread-marker-bare-"));
    try {
      const database = await openSqliteDatabase(path.join(bareDir, "state_5.sqlite"));
      database.exec(`
        CREATE TABLE threads (
          id TEXT PRIMARY KEY,
          rollout_path TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          source TEXT NOT NULL,
          cwd TEXT NOT NULL,
          title TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0
        );
      `);
      database
        .prepare(
          `INSERT INTO threads(id, rollout_path, created_at, updated_at, source, cwd, title, archived)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "thread-compat",
          path.join(bareDir, "rollout.jsonl"),
          100,
          100,
          "vscode",
          bareDir,
          "compat",
          0
        );
      database.close();
      await writeFile(path.join(bareDir, "session_index.jsonl"), '{"id":"thread-compat"}\n', "utf8");

      const marker = new CodexNativeThreadMarker({
        codexHome: bareDir,
        throttleMs: 0
      });

      await expect(
        marker.touchThread("thread-compat", {
          markUserEvent: true,
          force: true
        })
      ).resolves.toBe(true);

      const readonlyDatabase = await openSqliteDatabase(path.join(bareDir, "state_5.sqlite"), {
        readonly: true,
        fileMustExist: true
      });
      const row = readonlyDatabase
        .prepare("SELECT updated_at FROM threads WHERE id = ?")
        .get<{ updated_at: number }>("thread-compat");

      expect(row?.updated_at).toBeGreaterThan(100);

      readonlyDatabase.close();
      await marker.close();
    } finally {
      await rm(bareDir, { recursive: true, force: true });
    }
  });
});
