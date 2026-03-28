import { localize, type Locale } from "../lib/locale";

interface OverviewEmptyStateInput {
  hasThreadSearch: boolean;
  isFallbackOnlyOverview: boolean;
  locale: Locale;
  reason?: string;
}

interface QueueEmptyStateInput {
  inputFilterActive: boolean;
  isFallbackOnlyOverview: boolean;
  locale: Locale;
  reason?: string;
}

export function describeThreadTimelineEmptyMessage(
  locale: Locale,
  input: {
    degraded: boolean;
  }
) {
  if (input.degraded) {
    return localize(locale, {
      zh: "共享聊天状态当前处于退化模式，这条聊天的消息暂时不可用。",
      en: "Shared chat state is degraded right now, so messages for this chat are temporarily unavailable."
    });
  }

  return localize(locale, {
    zh: "这条聊天里还没有消息。",
    en: "No messages yet in this chat."
  });
}

export function buildOverviewEmptyStateCopy(input: OverviewEmptyStateInput) {
  if (input.hasThreadSearch) {
    return {
      body: localize(input.locale, {
        zh: "没有找到匹配聊天。",
        en: "No matching chats."
      }),
      title: localize(input.locale, {
        zh: "换个关键词再试试。",
        en: "Try a different keyword."
      }),
      detail: localize(input.locale, {
        zh: "可以继续按标题、项目名或仓库路径搜索。",
        en: "Search by title, project name, or repo path."
      })
    };
  }

  if (input.isFallbackOnlyOverview) {
    return {
      body:
        input.reason ??
        localize(input.locale, {
          zh: "共享聊天状态暂时不可用。",
          en: "Shared chat state is temporarily unavailable."
        }),
      title: localize(input.locale, {
        zh: "恢复后，这里会自动显示可同步的真实会话。",
        en: "Once recovery completes, synchronized chats will appear here automatically."
      }),
      detail: localize(input.locale, {
        zh: "当前只保留退化模式下的恢复数据，恢复线程默认不会显示在主列表中。",
        en: "Only degraded recovery data is available, and recovery threads stay hidden from the main list by default."
      })
    };
  }

  return {
    body: localize(input.locale, {
      zh: "还没有可显示的聊天。",
      en: "There are no visible chats yet."
    }),
    title: localize(input.locale, {
      zh: "从这里开始第一条对话。",
      en: "Start the first conversation from here."
    }),
    detail: localize(input.locale, {
      zh: "新聊天会直接进入共享会话。",
      en: "New chats open the shared conversation directly."
    })
  };
}

export function buildQueueEmptyStateCopy(input: QueueEmptyStateInput) {
  if (input.isFallbackOnlyOverview) {
    return {
      body:
        input.reason ??
        localize(input.locale, {
          zh: "共享聊天状态暂时不可用，收件箱目前无法同步。",
          en: "Shared chat state is temporarily unavailable, so the inbox cannot sync right now."
        }),
      actionLabel: localize(input.locale, {
        zh: "回到聊天列表",
        en: "Back to chats"
      })
    };
  }

  return {
    body: input.inputFilterActive
      ? localize(input.locale, {
          zh: "当前筛选下没有事项。",
          en: "No inbox items match this filter."
        })
      : localize(input.locale, {
          zh: "现在没有需要你点开的事项。",
          en: "Nothing needs your attention right now."
        }),
    actionLabel: localize(input.locale, {
      zh: "回到聊天",
      en: "Back to chats"
    })
  };
}

export function buildRecentChatsSheetCopy(locale: Locale) {
  return {
    empty: localize(locale, {
      zh: "当前还没有别的对话。",
      en: "No other chats yet."
    }),
    issueLabel: localize(locale, {
      zh: "对话列表异常",
      en: "Chat list issue"
    }),
    loading: localize(locale, {
      zh: "正在加载最近对话。",
      en: "Loading recent chats."
    }),
    unavailableTitle: localize(locale, {
      zh: "最近对话暂时不可用",
      en: "Recent chats are temporarily unavailable"
    })
  };
}
