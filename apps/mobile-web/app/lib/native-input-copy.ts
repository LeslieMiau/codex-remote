import { localize, type Locale } from "./locale";

type NativeRequestKind = "user_input" | "dynamic_tool" | "auth_refresh";

export function describePendingInputSummary(locale: Locale, count: number) {
  const safeCount = Math.max(0, count);
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
    title
  };
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
