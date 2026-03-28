import type {
  CodexOverviewResponse,
  CodexThread,
  CodexTimelineResponse,
  CodexTranscriptPageResponse
} from "@codex-remote/protocol";

import { GatewayFallbackProjection } from "../projections/fallback-thread-projection";
import type { GatewayRepositories } from "../repositories/gateway-repositories";

interface ReadBridge {
  getOverview(input?: { includeArchived?: boolean }): Promise<CodexOverviewResponse>;
  getThread(threadId: string): Promise<CodexThread | null>;
  getTimeline(threadId: string): Promise<CodexTimelineResponse | null>;
  getTranscriptPage(input: {
    threadId: string;
    cursor?: string;
    limit?: number;
  }): Promise<CodexTranscriptPageResponse | null>;
}

export class GatewayReadModelService {
  constructor(
    repositories: GatewayRepositories,
    private readonly bridge: ReadBridge,
    private readonly fallbackProjection = new GatewayFallbackProjection(repositories)
  ) {}

  async getOverview(input?: {
    includeArchived?: boolean;
  }): Promise<CodexOverviewResponse> {
    return this.bridge.getOverview(input);
  }

  async getThread(threadId: string): Promise<CodexThread | null> {
    return (await this.bridge.getThread(threadId)) ?? this.getFallbackThread(threadId);
  }

  async getTimeline(threadId: string): Promise<CodexTimelineResponse | null> {
    return (await this.bridge.getTimeline(threadId)) ?? this.getFallbackTimeline(threadId);
  }

  async getTranscriptPage(input: {
    threadId: string;
    cursor?: string;
    limit?: number;
  }): Promise<CodexTranscriptPageResponse | null> {
    return (
      (await this.bridge.getTranscriptPage(input)) ??
      this.fallbackProjection.buildTranscript(input.threadId, input)
    );
  }

  getFallbackThread(threadId: string): CodexThread | null {
    return this.fallbackProjection.buildThread(threadId);
  }

  getFallbackTimeline(threadId: string): CodexTimelineResponse | null {
    return this.fallbackProjection.buildTimeline(threadId);
  }

  getFallbackTranscript(
    threadId: string,
    input: {
      cursor?: string;
      limit?: number;
    } = {}
  ): CodexTranscriptPageResponse | null {
    return this.fallbackProjection.buildTranscript(threadId, input);
  }
}
