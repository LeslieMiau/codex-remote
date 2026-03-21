import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getCodexOverview,
  getThreadSkills,
  subscribeToThreadStream,
  updateCodexSharedSettings,
  uploadSharedThreadImage,
  type TransportState
} from "./gateway-client";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  emitError() {
    this.onerror?.({} as Event);
  }

  emitMessage(data: string) {
    this.onmessage?.({
      data
    } as MessageEvent<string>);
  }

  emitOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({} as Event);
  }
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {}

  emitMessage(data: string) {
    this.onmessage?.({
      data
    } as MessageEvent<string>);
  }

  emitOpen() {
    this.onopen?.({} as Event);
  }
}

async function flushMicrotasks() {
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
}

function installWindow() {
  const windowLike = {
    EventSource: FakeEventSource,
    WebSocket: FakeWebSocket,
    location: {
      origin: "https://gateway-host.tailnet.ts.net"
    },
    queueMicrotask
  } as unknown as Window & typeof globalThis;

  vi.stubGlobal("window", windowLike);
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("EventSource", FakeEventSource);
}

afterEach(() => {
  FakeWebSocket.instances = [];
  FakeEventSource.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("subscribeToThreadStream", () => {
  it("uses WebSocket as the primary realtime transport", async () => {
    installWindow();

    const events: Array<{ event_type: string; stream_seq: number }> = [];
    const transports: TransportState[] = [];
    const stop = subscribeToThreadStream({
      threadId: "thread_ws",
      lastSeenSeq: 7,
      onEvent(event) {
        events.push(event as { event_type: string; stream_seq: number });
      },
      onTransport(state) {
        transports.push(state);
      }
    });

    await flushMicrotasks();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.url).toBe(
      "wss://gateway-host.tailnet.ts.net/api/ws?thread_id=thread_ws&last_seen_seq=7"
    );
    expect(transports).toEqual(["idle"]);

    FakeWebSocket.instances[0]!.emitOpen();
    FakeWebSocket.instances[0]!.emitMessage(
      JSON.stringify({
        event_type: "turn.started",
        stream_seq: 8
      })
    );

    expect(transports).toEqual(["idle", "websocket"]);
    expect(events).toEqual([
      {
        event_type: "turn.started",
        stream_seq: 8
      }
    ]);

    stop();
    expect(transports.at(-1)).toBe("idle");
  });

  it("falls back to SSE when WebSocket is unavailable", async () => {
    installWindow();

    const events: Array<{ event_type: string; stream_seq: number }> = [];
    const errors: string[] = [];
    const transports: TransportState[] = [];
    const stop = subscribeToThreadStream({
      threadId: "thread_sse",
      lastSeenSeq: 2,
      onEvent(event) {
        events.push(event as { event_type: string; stream_seq: number });
      },
      onTransport(state) {
        transports.push(state);
      },
      onError(message) {
        errors.push(message);
      }
    });

    await flushMicrotasks();

    FakeWebSocket.instances[0]!.emitError();

    expect(errors).toContain("WebSocket unavailable. Falling back to SSE.");
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe(
      "https://gateway-host.tailnet.ts.net/api/events?thread_id=thread_sse&last_seen_seq=2"
    );

    FakeEventSource.instances[0]!.emitOpen();
    FakeEventSource.instances[0]!.emitMessage(
      JSON.stringify({
        event_type: "approval.required",
        stream_seq: 3
      })
    );

    expect(transports).toEqual(["idle", "sse"]);
    expect(events).toEqual([
      {
        event_type: "approval.required",
        stream_seq: 3
      }
    ]);

    stop();
    expect(transports.at(-1)).toBe("idle");
  });
});

describe("uploadSharedThreadImage", () => {
  it("posts multipart form data without forcing a JSON content type", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          attachment_id: "attachment-1",
          thread_id: "thread-upload",
          file_name: "screen.png",
          content_type: "image/png",
          byte_size: 4,
          uploaded_at: "2026-03-16T12:00:00.000Z",
          expires_at: "2026-03-17T12:00:00.000Z"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["png"], "screen.png", {
      type: "image/png"
    });
    const uploaded = await uploadSharedThreadImage("thread-upload", file);

    expect(uploaded.attachment_id).toBe("attachment-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/threads/thread-upload/attachments/images",
      expect.objectContaining({
        method: "POST"
      })
    );

    const firstCall = (fetchMock.mock.calls as unknown as Array<
      [string, RequestInit | undefined]
    >)[0];
    expect(firstCall).toBeDefined();
    const requestInit = firstCall?.[1];
    const headers = new Headers(requestInit?.headers as HeadersInit | undefined);
    expect(headers.has("content-type")).toBe(false);

    const formData = requestInit?.body;
    expect(formData).toBeInstanceOf(FormData);
    expect((formData as FormData).get("file")).toBe(file);
  });
});

describe("gateway reads", () => {
  it("includes archived threads when requested from overview", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          projects: [],
          threads: [],
          queue: [],
          capabilities: {
            adapter_kind: "codex-app-server",
            collaboration_mode: "default",
            shared_state_available: true
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await getCodexOverview({
      includeArchived: true
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/overview?include_archived=1",
      expect.objectContaining({
        method: "GET"
      })
    );
  });

  it("loads skills for a thread from the gateway route", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          cwd: "/repo",
          skills: [
            {
              name: "checks",
              path: "/skills/checks/SKILL.md",
              description: "Run project checks"
            }
          ],
          errors: []
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const skills = await getThreadSkills("thread-skills");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/threads/thread-skills/skills",
      expect.objectContaining({
        method: "GET"
      })
    );
    expect(skills).toEqual([
      {
        name: "checks",
        path: "/skills/checks/SKILL.md",
        description: "Run project checks"
      }
    ]);
  });

  it("updates shared settings with a PATCH request", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          model: "gpt-5.4",
          model_reasoning_effort: "high",
          available_models: [],
          experimental_features: [],
          read_only: false
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const nextSettings = await updateCodexSharedSettings({
      model: "gpt-5.4",
      model_reasoning_effort: "high"
    });

    expect(nextSettings.model_reasoning_effort).toBe("high");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/shared",
      expect.objectContaining({
        method: "PATCH"
      })
    );
    const firstCall = (fetchMock.mock.calls as unknown as Array<
      [string, RequestInit | undefined]
    >)[0];
    expect(firstCall?.[1]?.body).toBe(
      JSON.stringify({
        model: "gpt-5.4",
        model_reasoning_effort: "high"
      })
    );
  });
});
