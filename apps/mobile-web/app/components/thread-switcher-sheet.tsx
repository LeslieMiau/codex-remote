"use client";

import { localize, useLocale } from "../lib/locale";
import { MobileSheet } from "./mobile-sheet";

interface ThreadSwitcherSheetProps {
  open?: boolean;
  onClose?(): void;
  [key: string]: unknown;
}

export function ThreadSwitcherSheet({
  onClose,
  open = false
}: ThreadSwitcherSheetProps) {
  const { locale } = useLocale();

  return (
    <MobileSheet
      eyebrow={localize(locale, { zh: "聊天", en: "Chats" })}
      onClose={onClose ?? (() => {})}
      open={open}
      title={localize(locale, {
        zh: "旧入口已经并入最近对话",
        en: "This shortcut now lives in Recent chats"
      })}
    >
      <div className="codex-status-strip codex-status-strip--stacked">
        <div className="codex-status-strip__copy">
          <p className="section-label">
            {localize(locale, { zh: "兼容视图", en: "Compatibility view" })}
          </p>
          <strong>
            {localize(locale, {
              zh: "切换聊天现在统一放在最近对话和共享聊天页里处理。",
              en: "Switching chats now happens from Recent chats and the shared workspace."
            })}
          </strong>
          <p>
            {localize(locale, {
              zh: "这个兼容入口会继续保留，避免旧按钮再次弹出一张空白 sheet。",
              en: "This compatibility shim keeps the old button alive so it no longer opens a blank sheet."
            })}
          </p>
        </div>
      </div>
    </MobileSheet>
  );
}

export default ThreadSwitcherSheet;
