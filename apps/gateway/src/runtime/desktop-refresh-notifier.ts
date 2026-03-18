import { spawn } from "node:child_process";

export type DesktopRefreshNotificationKind =
  | "remote_turn_started"
  | "remote_turn_follow_up"
  | "remote_turn_completed"
  | "remote_turn_failed"
  | "remote_approval_required"
  | "remote_input_required";

export interface DesktopRefreshNotification {
  kind: DesktopRefreshNotificationKind;
  thread_id: string;
  turn_id?: string;
  thread_title: string;
  body: string;
}

export interface DesktopRefreshNotifier {
  notify(input: DesktopRefreshNotification): Promise<void>;
}

export interface MacDesktopRefreshNotifierOptions {
  command?: string;
  cooldownMs?: number;
  enabled?: boolean;
  title?: string;
}

function escapeAppleScriptString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function truncate(value: string, max: number) {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 1).trimEnd()}...`;
}

function buildNotificationScript(input: {
  body: string;
  subtitle: string;
  title: string;
}) {
  return `display notification ${escapeAppleScriptString(
    input.body
  )} with title ${escapeAppleScriptString(input.title)} subtitle ${escapeAppleScriptString(
    input.subtitle
  )}`;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function createDesktopRefreshNotifierFromEnv(
  env: NodeJS.ProcessEnv = process.env
): DesktopRefreshNotifier | undefined {
  if ((env.CODEX_REMOTE_DESKTOP_REFRESH_NOTIFICATIONS ?? "").toLowerCase() === "off") {
    return undefined;
  }

  return new MacDesktopRefreshNotifier({
    cooldownMs: readPositiveInteger(
      env.CODEX_REMOTE_DESKTOP_REFRESH_NOTIFICATION_COOLDOWN_MS,
      8_000
    ),
    enabled: process.platform === "darwin",
    title: env.CODEX_REMOTE_DESKTOP_NOTIFICATION_TITLE ?? "Codex Remote"
  });
}

export class MacDesktopRefreshNotifier implements DesktopRefreshNotifier {
  private readonly command: string;
  private readonly cooldownMs: number;
  private readonly enabled: boolean;
  private readonly title: string;
  private readonly sentAt = new Map<string, number>();

  constructor(options: MacDesktopRefreshNotifierOptions = {}) {
    this.command = options.command ?? "/usr/bin/osascript";
    this.cooldownMs = options.cooldownMs ?? 8_000;
    this.enabled = options.enabled ?? process.platform === "darwin";
    this.title = options.title ?? "Codex Remote";
  }

  async notify(input: DesktopRefreshNotification) {
    if (!this.enabled) {
      return;
    }

    const dedupeKey = `${input.kind}:${input.thread_id}:${input.turn_id ?? ""}`;
    const now = Date.now();
    const lastSentAt = this.sentAt.get(dedupeKey) ?? 0;
    if (now - lastSentAt < this.cooldownMs) {
      return;
    }
    this.sentAt.set(dedupeKey, now);

    const script = buildNotificationScript({
      title: this.title,
      subtitle: truncate(input.thread_title || input.thread_id, 72),
      body: truncate(input.body, 220)
    });

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.command, ["-e", script], {
        stdio: "ignore"
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`desktop_notification_failed:${code ?? "unknown"}`));
      });
    });
  }
}
