import type { CodexLiveState } from "@codex-remote/protocol";

import type { DisplayChatMessage } from "./live-draft";
import type { PendingSendState } from "./pending-send";

const GROUP_WINDOW_MS = 5 * 60 * 1_000;

export interface MessageGroup {
  action_required: boolean;
  detail_count: number;
  ended_at: string;
  group_id: string;
  includes_live_draft: boolean;
  messages: DisplayChatMessage[];
  role: DisplayChatMessage["role"];
  started_at: string;
}

export type ChatTimelineItem =
  | {
      date_key: string;
      id: string;
      timestamp: string;
      type: "date_divider";
    }
  | {
      group: MessageGroup;
      id: string;
      timestamp: string;
      type: "message_group";
    }
  | {
      id: string;
      pending_send: PendingSendState;
      timestamp: string;
      type: "pending_send";
    }
  | {
      has_inline_draft: boolean;
      id: string;
      live_state: CodexLiveState;
      timestamp: string;
      tone: "danger" | "neutral" | "success" | "warning";
      type: "live_banner";
    };

interface BuildChatTimelineItemsInput {
  liveBanner?:
    | {
        has_inline_draft: boolean;
        live_state: CodexLiveState;
        tone: "danger" | "neutral" | "success" | "warning";
      }
    | null
    | undefined;
  messages: DisplayChatMessage[];
  pendingSends: PendingSendState[];
}

function localDateKey(timestamp: string) {
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function detailCount(message: DisplayChatMessage) {
  return message.details.length;
}

function messageTimestamp(message: DisplayChatMessage) {
  return Date.parse(message.timestamp);
}

function canGroupMessage(group: MessageGroup, message: DisplayChatMessage) {
  if (message.is_live_draft || group.includes_live_draft) {
    return false;
  }

  if (group.role !== message.role || message.role === "system_action") {
    return false;
  }

  const previous = Date.parse(group.ended_at);
  const next = messageTimestamp(message);
  if (Number.isNaN(previous) || Number.isNaN(next)) {
    return false;
  }

  return next - previous <= GROUP_WINDOW_MS;
}

function appendDateDivider(
  items: ChatTimelineItem[],
  dateKey: string,
  timestamp: string,
  lastDateKeyRef: { current: string | null }
) {
  if (lastDateKeyRef.current === dateKey) {
    return;
  }

  items.push({
    type: "date_divider",
    id: `date:${dateKey}`,
    date_key: dateKey,
    timestamp
  });
  lastDateKeyRef.current = dateKey;
}

function flushGroup(items: ChatTimelineItem[], currentGroup: MessageGroup | null) {
  if (!currentGroup) {
    return null;
  }

  items.push({
    type: "message_group",
    id: currentGroup.group_id,
    timestamp: currentGroup.ended_at,
    group: currentGroup
  });
  return null;
}

export function buildChatTimelineItems(input: BuildChatTimelineItemsInput) {
  const items: ChatTimelineItem[] = [];
  const lastDateKeyRef = {
    current: null as string | null
  };

  const entries = [
    ...input.messages.map((message) => ({
      kind: "message" as const,
      rank: 0,
      timestamp: message.timestamp,
      value: message
    })),
    ...input.pendingSends.map((pendingSend) => ({
      kind: "pending_send" as const,
      rank: 1,
      timestamp: pendingSend.created_at,
      value: pendingSend
    }))
  ].sort((left, right) => {
    const diff = Date.parse(left.timestamp) - Date.parse(right.timestamp);
    if (diff !== 0) {
      return diff;
    }
    return left.rank - right.rank;
  });

  let currentGroup: MessageGroup | null = null;

  for (const entry of entries) {
    const dateKey = localDateKey(entry.timestamp);
    if (entry.kind === "pending_send") {
      currentGroup = flushGroup(items, currentGroup);
      appendDateDivider(items, dateKey, entry.timestamp, lastDateKeyRef);
      items.push({
        type: "pending_send",
        id: `pending:${entry.value.local_id}`,
        timestamp: entry.timestamp,
        pending_send: entry.value
      });
      continue;
    }

    const message = entry.value;
    if (currentGroup && localDateKey(currentGroup.ended_at) !== dateKey) {
      currentGroup = flushGroup(items, currentGroup);
    }
    appendDateDivider(items, dateKey, message.timestamp, lastDateKeyRef);
    if (currentGroup && canGroupMessage(currentGroup, message)) {
      const previousGroup: MessageGroup = currentGroup;
      currentGroup = {
        ...previousGroup,
        ended_at: message.timestamp,
        messages: [...previousGroup.messages, message],
        includes_live_draft:
          previousGroup.includes_live_draft || Boolean(message.is_live_draft),
        action_required: previousGroup.action_required || Boolean(message.action_required),
        detail_count: previousGroup.detail_count + detailCount(message)
      };
      continue;
    }

    currentGroup = flushGroup(items, currentGroup);
    currentGroup = {
      group_id: `group:${message.message_id}`,
      role: message.role,
      started_at: message.timestamp,
      ended_at: message.timestamp,
      messages: [message],
      includes_live_draft: Boolean(message.is_live_draft),
      action_required: Boolean(message.action_required),
      detail_count: detailCount(message)
    };
  }

  flushGroup(items, currentGroup);

  if (input.liveBanner) {
    items.push({
      type: "live_banner",
      id: `live:${input.liveBanner.live_state.turn_id ?? input.liveBanner.live_state.updated_at}`,
      timestamp: input.liveBanner.live_state.updated_at,
      live_state: input.liveBanner.live_state,
      tone: input.liveBanner.tone,
      has_inline_draft: input.liveBanner.has_inline_draft
    });
  }

  return items;
}

export function getVisibleTimelineItems(items: ChatTimelineItem[], visibleCount: number) {
  const normalizedVisibleCount = Math.max(visibleCount, 0);
  if (items.length <= normalizedVisibleCount) {
    return {
      hiddenCount: 0,
      visibleItems: items
    };
  }

  return {
    hiddenCount: items.length - normalizedVisibleCount,
    visibleItems: items.slice(-normalizedVisibleCount)
  };
}
