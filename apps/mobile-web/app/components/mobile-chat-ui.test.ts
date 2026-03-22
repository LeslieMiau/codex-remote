import * as React from "react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  CodexOverviewResponse,
  CodexQueueEntry,
  CodexThread
} from "@codex-remote/protocol";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import { setCachedOverview } from "../lib/client-cache";
import { LocaleProvider } from "../lib/locale";

let mockPathname = "/projects";
const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn()
};

globalThis.React = React;

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    usePathname() {
      return mockPathname;
    },
    useRouter() {
      return mockRouter;
    }
  };
});

import { CodexShell } from "./codex-shell";
import { DetailShell } from "./detail-shell";
import { OverviewScreen } from "./overview-screen";
import { QueueScreen } from "./queue-screen";

function renderWithProviders(node: ReactNode) {
  return renderToStaticMarkup(createElement(LocaleProvider, null, node));
}

function buildCapabilities(): CodexOverviewResponse["capabilities"] {
  return {
    adapter_kind: "codex-app-server",
    collaboration_mode: "default",
    codex_home: "/tmp/codex-home",
    shared_state_available: true,
    shared_thread_create: true,
    supports_images: true,
    run_start: true,
    live_follow_up: true,
    image_inputs: true,
    interrupt: true,
    approvals: true,
    patch_decisions: true,
    thread_rename: true,
    thread_archive: true,
    thread_compact: true,
    thread_fork: true,
    thread_rollback: true,
    review_start: true,
    skills_input: true,
    diagnostics_read: true,
    settings_read: true,
    settings_write: false,
    shared_model_config: true,
    shared_history: true,
    shared_threads: true
  };
}

function buildThread(
  overrides: Partial<CodexThread> & Pick<CodexThread, "thread_id" | "title">
): CodexThread {
  return {
    thread_id: overrides.thread_id,
    project_id: overrides.project_id ?? "project-1",
    title: overrides.title,
    project_label: overrides.project_label ?? "repo",
    repo_root: overrides.repo_root ?? "/tmp/repo",
    source: overrides.source ?? "codex-app-server",
    state: overrides.state ?? "ready",
    archived: overrides.archived ?? false,
    has_active_run: overrides.has_active_run ?? false,
    pending_approvals: overrides.pending_approvals ?? 0,
    pending_patches: overrides.pending_patches ?? 0,
    pending_native_requests: overrides.pending_native_requests ?? 0,
    active_turn_id: overrides.active_turn_id ?? null,
    last_stream_seq: overrides.last_stream_seq ?? 0,
    sync_state: overrides.sync_state ?? "native_confirmed",
    created_at: overrides.created_at ?? "2026-03-22T10:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-03-22T10:00:00.000Z"
  } as CodexThread;
}

function buildQueueEntry(
  overrides: Partial<CodexQueueEntry> &
    Pick<CodexQueueEntry, "entry_id" | "kind" | "thread_id" | "title">
): CodexQueueEntry {
  return {
    entry_id: overrides.entry_id,
    kind: overrides.kind,
    thread_id: overrides.thread_id,
    title: overrides.title,
    summary: overrides.summary ?? `${overrides.title} summary`,
    timestamp: overrides.timestamp ?? "2026-03-22T10:00:00.000Z",
    status: overrides.status ?? "Waiting",
    action_required: overrides.action_required ?? true,
    patch_id: overrides.patch_id,
    approval_id: overrides.approval_id,
    turn_id: overrides.turn_id,
    native_request_kind: overrides.native_request_kind
  } as CodexQueueEntry;
}

function extractRowTitles(markup: string) {
  return [...markup.matchAll(/<a class="codex-thread-row[^"]*"[^>]*>[\s\S]*?<strong>(.*?)<\/strong>/g)].map(
    (match) => match[1]
  );
}

describe("mobile chat shells", () => {
  beforeEach(() => {
    mockPathname = "/projects";
    setCachedOverview(null);
    vi.clearAllMocks();
  });

  afterEach(() => {
    setCachedOverview(null);
  });

  it("keeps only chats and settings in the top-level tab bar", () => {
    const markup = renderWithProviders(
      createElement(
        CodexShell,
        {
          eyebrow: "Chats",
          subtitle: "Recent shared chats",
          title: "Recent chats",
          children: createElement("div", null, "body")
        }
      )
    );

    expect(markup).toContain("codex-tab-bar");
    expect(markup).toContain(">Chats<");
    expect(markup).toContain(">Settings<");
    expect(markup).not.toContain(">Queue<");
  });

  it("renders detail pages without the global tab bar", () => {
    const markup = renderWithProviders(
      createElement(
        DetailShell,
        {
          backHref: "/projects",
          eyebrow: "Chat",
          subtitle: "Waiting for approval",
          title: "Shared Codex thread",
          children: createElement("div", null, "conversation")
        }
      )
    );

    expect(markup).toContain("codex-detail-header");
    expect(markup).toContain('href="/projects"');
    expect(markup).not.toContain("codex-tab-bar");
  });
});

describe("mobile chat list rendering", () => {
  beforeEach(() => {
    mockPathname = "/projects";
    setCachedOverview(null);
    vi.clearAllMocks();
  });

  afterEach(() => {
    setCachedOverview(null);
  });

  it("renders overview threads in mobile-first priority order", () => {
    const overview: CodexOverviewResponse = {
      projects: [
        {
          project_id: "project-1",
          label: "repo",
          repo_root: "/tmp/repo"
        }
      ],
      threads: [
        buildThread({
          thread_id: "thread-ready",
          title: "Newest ready thread",
          updated_at: "2026-03-22T10:05:00.000Z"
        }),
        buildThread({
          thread_id: "thread-interrupted",
          title: "Interrupted thread",
          state: "interrupted",
          updated_at: "2026-03-22T10:04:00.000Z"
        }),
        buildThread({
          thread_id: "thread-running",
          title: "Running thread",
          state: "running",
          has_active_run: true,
          updated_at: "2026-03-22T10:03:00.000Z"
        }),
        buildThread({
          thread_id: "thread-review",
          title: "Patch review thread",
          pending_patches: 1,
          updated_at: "2026-03-22T10:02:00.000Z"
        }),
        buildThread({
          thread_id: "thread-approval",
          title: "Approval thread",
          pending_approvals: 1,
          updated_at: "2026-03-22T10:01:00.000Z"
        }),
        buildThread({
          thread_id: "thread-input",
          title: "Input thread",
          pending_native_requests: 1,
          state: "waiting_input",
          updated_at: "2026-03-22T10:00:00.000Z"
        })
      ],
      queue: [],
      capabilities: buildCapabilities()
    };

    setCachedOverview(overview);

    const markup = renderWithProviders(createElement(OverviewScreen));

    expect(markup).toContain("codex-inbox-button");
    expect(extractRowTitles(markup)).toEqual([
      "Input thread",
      "Approval thread",
      "Patch review thread",
      "Running thread",
      "Interrupted thread",
      "Newest ready thread"
    ]);
  });

  it("renders actionable inbox rows in priority order without the global tab bar", () => {
    const overview: CodexOverviewResponse = {
      projects: [
        {
          project_id: "project-1",
          label: "repo",
          repo_root: "/tmp/repo"
        }
      ],
      threads: [
        buildThread({
          thread_id: "thread-input",
          title: "Input thread"
        })
      ],
      queue: [
        buildQueueEntry({
          entry_id: "queue-running",
          kind: "running",
          thread_id: "thread-running",
          title: "Running item",
          action_required: false,
          status: "Running"
        }),
        buildQueueEntry({
          entry_id: "queue-failed",
          kind: "failed",
          thread_id: "thread-failed",
          title: "Failed item",
          timestamp: "2026-03-22T10:03:00.000Z",
          status: "Failed"
        }),
        buildQueueEntry({
          entry_id: "queue-patch",
          kind: "patch",
          thread_id: "thread-patch",
          title: "Patch item",
          timestamp: "2026-03-22T10:02:00.000Z",
          status: "Needs review",
          patch_id: "patch-1"
        }),
        buildQueueEntry({
          entry_id: "queue-approval",
          kind: "approval",
          thread_id: "thread-approval",
          title: "Approval item",
          timestamp: "2026-03-22T10:01:00.000Z",
          status: "Waiting for approval",
          approval_id: "approval-1"
        }),
        buildQueueEntry({
          entry_id: "queue-input",
          kind: "input",
          thread_id: "thread-input",
          title: "Input item",
          timestamp: "2026-03-22T10:00:00.000Z",
          status: "Waiting for input",
          native_request_kind: "user_input"
        })
      ],
      capabilities: buildCapabilities()
    };

    setCachedOverview(overview);

    const markup = renderWithProviders(createElement(QueueScreen));

    expect(markup).toContain("codex-detail-header");
    expect(markup).not.toContain("codex-tab-bar");
    expect(extractRowTitles(markup)).toEqual([
      "Input item",
      "Approval item",
      "Patch item",
      "Failed item"
    ]);
  });
});
