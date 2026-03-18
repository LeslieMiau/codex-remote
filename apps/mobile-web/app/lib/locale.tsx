"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type Locale = "zh" | "en";

const LOCALE_STORAGE_KEY = "codex-remote:locale";

interface LocaleContextValue {
  locale: Locale;
  setLocale(nextLocale: Locale): void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function detectLocale(): Locale {
  if (typeof window === "undefined") {
    return "en";
  }

  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "zh" || stored === "en") {
      return stored;
    }
  } catch {
    // Ignore storage failures and fall back to browser language.
  }

  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    setLocaleState(detectLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignore storage failures and keep the UI usable.
    }
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale(nextLocale) {
        setLocaleState(nextLocale);
      }
    }),
    [locale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return value;
}

export function formatDateTime(locale: Locale, value: string) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

export function localize<T>(locale: Locale, input: { zh: T; en: T }) {
  return locale === "zh" ? input.zh : input.en;
}

const STATE_ICONS: Record<string, string> = {
  running: "\u25B6",
  streaming: "\u25B6",
  started: "\u25B6",
  resumed: "\u25B6",
  running_queue: "\u25B6",
  waiting_input: "\u23F3",
  failed: "\u2715",
  interrupted: "\u23F8",
  system_error: "\u2715",
  completed: "\u2713",
  applied: "\u2713",
  reviewed: "\u2713",
  waiting_approval: "\u23F3",
  needs_review: "\u23F3",
  queued: "\u23F3",
  archived: "\u2500",
  discarded: "\u2500",
  unavailable: "\u2500"
};

export function translateThreadState(locale: Locale, input: string) {
  const zhMap: Record<string, string> = {
    ready: "就绪",
    running: "运行中",
    waiting_input: "等待输入",
    waiting_approval: "等待批准",
    needs_review: "待审查",
    completed: "已完成",
    failed: "失败",
    interrupted: "已中断",
    system_error: "原生异常",
    archived: "已归档",
    unavailable: "不可用",
    created: "已创建",
    started: "已开始",
    streaming: "生成中",
    resumed: "已恢复",
    queued: "排队中",
    generated: "已生成",
    reviewed: "已审阅",
    applied: "已应用",
    discarded: "已丢弃",
    approval: "批准",
    patch: "补丁",
    running_queue: "运行中"
  };

  const icon = STATE_ICONS[input] ?? "";
  const prefix = icon ? `${icon} ` : "";

  if (locale === "zh") {
    return `${prefix}${zhMap[input] ?? input}`;
  }

  const label = input
    .split("_")
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(" ");

  return `${prefix}${label}`;
}

export function translateApprovalKind(locale: Locale, kind: string) {
  if (locale === "zh") {
    switch (kind) {
      case "network":
        return "网络";
      case "filesystem":
        return "文件系统";
      case "destructive":
        return "危险操作";
      case "command":
        return "命令";
      default:
        return kind;
    }
  }

  switch (kind) {
    case "network":
      return "Network";
    case "filesystem":
      return "Filesystem";
    case "destructive":
      return "Destructive";
    case "command":
      return "Command";
    default:
      return kind;
  }
}

export function transportLabel(locale: Locale, state: "idle" | "websocket" | "sse") {
  if (locale === "zh") {
    switch (state) {
      case "websocket":
        return "实时连接";
      case "sse":
        return "回退连接";
      default:
        return "连接中";
    }
  }

  switch (state) {
    case "websocket":
      return "Live";
    case "sse":
      return "Fallback";
    default:
      return "Connecting";
  }
}

export function translateQueueKind(locale: Locale, kind: string) {
  if (locale === "zh") {
    switch (kind) {
      case "running":
        return "运行中";
      case "input":
        return "待输入";
      case "approval":
        return "待批准";
      case "patch":
        return "待审查";
      case "failed":
        return "失败";
      default:
        return kind;
    }
  }

  switch (kind) {
    case "running":
      return "Running";
    case "input":
      return "Input";
    case "approval":
      return "Approval";
    case "patch":
      return "Review";
    case "failed":
      return "Failed";
    default:
      return kind;
  }
}

export function translateStatusText(locale: Locale, input: string) {
  const zhMap: Record<string, string> = {
    Connected: "已连接",
    Unavailable: "不可用",
    Syncing: "同步中",
    Loading: "加载中",
    Ready: "就绪",
    Running: "运行中",
    Completed: "已完成",
    Failed: "失败",
    Interrupted: "已中断",
    "Waiting for approval": "等待批准",
    "Needs review": "待审查",
    "Run in progress": "任务进行中",
    "Run needs follow-up": "需要继续处理",
    "Tests passed": "测试通过",
    "Tests failed": "测试失败",
    "Tests skipped": "测试已跳过",
    "Codex progress": "Codex 处理中",
    "Tool output": "工具输出",
    "No approval requests pending.": "当前没有待批准的请求。",
    "No patch review waiting.": "当前没有待审查的补丁。",
    "Live stream unavailable. Waiting for reconnect.":
      "实时连接不可用，正在等待重连。"
  };

  if (locale === "zh") {
    return zhMap[input] ?? input;
  }

  return input;
}
