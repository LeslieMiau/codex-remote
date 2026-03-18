"use client";

import { localize, useLocale } from "../lib/locale";

interface ThreadFeedProps {
  className?: string;
  [key: string]: unknown;
}

export function ThreadFeed({ className }: ThreadFeedProps) {
  const { locale } = useLocale();

  return (
    <section
      className={["codex-status-strip", "codex-status-strip--stacked", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="codex-status-strip__copy">
        <p className="section-label">
          {localize(locale, { zh: "兼容视图", en: "Compatibility view" })}
        </p>
        <strong>
          {localize(locale, {
            zh: "旧版对话列表已经并入共享聊天界面。",
            en: "The legacy conversation feed now lives in the shared chat workspace."
          })}
        </strong>
        <p>
          {localize(locale, {
            zh: "如果这个组件再次被接回，它会显示统一的聊天界面，而不是空白占位。",
            en: "If this component is wired back in, it will show the unified chat experience instead of a blank placeholder."
          })}
        </p>
      </div>
    </section>
  );
}

export default ThreadFeed;
