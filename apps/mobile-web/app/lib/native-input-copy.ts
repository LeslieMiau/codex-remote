import type { NativeRequestKind } from "@codex-remote/protocol";

import { localize, type Locale } from "./locale";

export function isDesktopOrientedNativeRequest(
  kind: NativeRequestKind | undefined
) {
  return kind === "dynamic_tool" || kind === "auth_refresh";
}

export function describePendingInputSummary(
  locale: Locale,
  count: number,
  kind: NativeRequestKind = "user_input"
) {
  const safeCount = Math.max(0, count);

  if (isDesktopOrientedNativeRequest(kind)) {
    const remainingCount = Math.max(0, safeCount - 1);
    const title = localize(locale, {
      zh:
        remainingCount > 0
          ? `有 1 条聊天需要回桌面恢复，另有 ${remainingCount} 条仍在等待`
          : "有 1 条聊天需要回桌面恢复",
      en:
        remainingCount > 0
          ? `1 chat needs desktop recovery, plus ${remainingCount} more waiting`
          : "1 chat needs desktop recovery"
    });
    const body = localize(locale, {
      zh:
        remainingCount > 0
          ? "先在手机上查看这条请求的恢复步骤；如果要继续运行，通常要回到桌面 Codex app。其他暂停中的聊天也还在等你处理。"
          : "先在手机上查看这条请求的恢复步骤；如果要继续运行，通常要回到桌面 Codex app。",
      en:
        remainingCount > 0
          ? "Open this request on the phone first, but continuing usually happens in desktop Codex app. Other paused chats are still waiting too."
          : "Open this request on the phone first, but continuing usually happens in desktop Codex app."
    });

    return {
      body,
      cta: localize(locale, {
        zh: "查看恢复步骤",
        en: "See recovery steps"
      }),
      eyebrow: localize(locale, {
        zh: "建议回桌面",
        en: "Desktop recovery"
      }),
      title
    };
  }

  const title = localize(locale, {
    zh: safeCount === 1 ? "有 1 条聊天正在等你输入" : `有 ${safeCount} 条聊天正在等你输入`,
    en:
      safeCount === 1
        ? "1 chat is waiting for your input"
        : `${safeCount} chats are waiting for your input`
  });

  const body = localize(locale, {
    zh: "先处理这些补充输入，暂停中的运行才能继续往下走。",
    en: "Clear these input requests first so the paused runs can keep moving."
  });

  const cta = localize(locale, {
    zh: "先去回复",
    en: "Reply now"
  });

  return {
    body,
    cta,
    eyebrow: localize(locale, {
      zh: "先回复这里",
      en: "Reply first"
    }),
    title
  };
}

export function describeQueueInputPreview(
  locale: Locale,
  kind: NativeRequestKind = "user_input",
  detail?: string
) {
  const safeDetail =
    detail ??
    localize(locale, {
      zh: "Codex 正在等下一步。",
      en: "Codex is waiting on the next step."
    });

  if (kind === "dynamic_tool") {
    return localize(locale, {
      zh: `这条聊天卡在动态工具步骤上。${safeDetail}`,
      en: `This chat is paused on a dynamic tool step. ${safeDetail}`
    });
  }

  if (kind === "auth_refresh") {
    return localize(locale, {
      zh: `这条聊天卡在认证刷新上。${safeDetail}`,
      en: `This chat is waiting on an auth refresh. ${safeDetail}`
    });
  }

  return localize(locale, {
    zh: `这条聊天正等你回复。${safeDetail}`,
    en: `This chat is waiting for your reply. ${safeDetail}`
  });
}

export function describeNativeRequestQueueLabel(
  locale: Locale,
  kind: NativeRequestKind = "user_input"
) {
  if (kind === "dynamic_tool") {
    return localize(locale, {
      zh: "回桌面继续",
      en: "Desktop step"
    });
  }

  if (kind === "auth_refresh") {
    return localize(locale, {
      zh: "桌面认证",
      en: "Desktop auth"
    });
  }

  return localize(locale, {
    zh: "手机可回",
    en: "Reply here"
  });
}

export function describeThreadPendingInputPreview(
  locale: Locale,
  kind: NativeRequestKind | undefined
) {
  if (kind === "dynamic_tool") {
    return localize(locale, {
      zh: "这条聊天卡在动态工具步骤上，通常要回到桌面 Codex app 继续。",
      en: "This chat is paused on a dynamic tool step and usually continues in desktop Codex app."
    });
  }

  if (kind === "auth_refresh") {
    return localize(locale, {
      zh: "这条聊天卡在认证刷新上，通常要回到桌面 Codex app 完成恢复。",
      en: "This chat is waiting on an auth refresh and usually resumes from desktop Codex app."
    });
  }

  return localize(locale, {
    zh: "Codex 正等你回复，回一句就能继续往下跑。",
    en: "Codex is waiting for your reply before this chat can keep going."
  });
}

export function describeNativeRequestGateBody(
  locale: Locale,
  kind: NativeRequestKind,
  pendingCount: number
) {
  const remainingCount = Math.max(0, pendingCount - 1);

  if (kind === "dynamic_tool") {
    return localize(locale, {
      zh: "这轮运行暂停在动态工具请求上。先打开请求查看详情，再决定继续还是取消。",
      en: "This run is paused on a dynamic tool request. Open it for details before you continue or cancel."
    });
  }

  if (kind === "auth_refresh") {
    return localize(locale, {
      zh: "这轮运行暂停在认证刷新上。先打开请求查看详情，必要时回到桌面 Codex app 完成认证。",
      en: "This run is paused on an auth refresh. Open the request for details, then finish authentication in desktop Codex app if needed."
    });
  }

  return localize(locale, {
    zh:
      remainingCount > 0
        ? `先处理这条补充输入请求。后面还有 ${remainingCount} 条待处理，Codex 才能继续当前运行。`
        : "先处理这条补充输入请求，Codex 才能继续当前运行。",
    en:
      remainingCount > 0
        ? `Resolve this input request first. ${remainingCount} more are still waiting before Codex can continue the current run.`
        : "Resolve this input request before Codex can continue the current run."
  });
}

export function describeNativeRequestTaskDetail(
  locale: Locale,
  kind: NativeRequestKind,
  prompt?: string
) {
  if (kind === "user_input") {
    return (
      prompt ??
      localize(locale, {
        zh: "Codex 正在等待你补充输入。",
        en: "Codex is waiting for your input."
      })
    );
  }

  const recoveryNote =
    kind === "dynamic_tool"
      ? localize(locale, {
          zh: "手机端可以先查看或取消这条请求；如果要继续运行，通常要回到桌面 Codex app 处理。",
          en: "You can inspect or cancel this request on the phone, but continuing usually happens in desktop Codex app."
        })
      : localize(locale, {
          zh: "手机端可以先查看这条请求；如果要继续运行，通常要回到桌面 Codex app 完成认证。",
          en: "You can inspect this request on the phone, but continuing usually means finishing authentication in desktop Codex app."
        });

  return prompt ? `${prompt} ${recoveryNote}` : recoveryNote;
}

export function describeNativeRequestActionLabel(
  locale: Locale,
  kind: NativeRequestKind
) {
  if (kind === "user_input") {
    return localize(locale, { zh: "处理输入", en: "Open input request" });
  }

  return localize(locale, { zh: "查看恢复步骤", en: "See recovery steps" });
}

export function describeNativeRequestRecoveryNotice(
  locale: Locale,
  kind: NativeRequestKind
) {
  if (kind === "dynamic_tool") {
    return {
      title: localize(locale, {
        zh: "手机端先查看，继续通常回桌面",
        en: "Inspect on phone, continue on desktop"
      }),
      body: localize(locale, {
        zh: "这类动态工具请求在手机端主要用于查看详情或取消。需要继续执行时，通常要回到桌面 Codex app 打开同一条聊天。",
        en: "Dynamic tool requests are mainly view-or-cancel from the phone. To keep going, reopen the same chat in desktop Codex app."
      })
    };
  }

  return {
    title: localize(locale, {
      zh: "认证通常要回桌面完成",
      en: "Authentication usually finishes on desktop"
    }),
    body: localize(locale, {
      zh: "手机端可以先确认请求内容，但真正继续运行通常要回到桌面 Codex app 完成认证刷新。",
      en: "You can confirm the request details on the phone, but actually continuing usually means finishing the auth refresh in desktop Codex app."
    })
  };
}
