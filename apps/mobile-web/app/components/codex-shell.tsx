"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useState,
  useEffect,
  type CSSProperties,
  type MouseEvent,
  type ReactNode
} from "react";

import { getCachedOverview } from "../lib/client-cache";
import { useLocale } from "../lib/locale";
import { useNavigationGuard } from "./navigation-guard-provider";
import { useKeyboardViewportState } from "./mobile-viewport";

interface CodexShellProps {
  actions?: ReactNode;
  children: ReactNode;
  eyebrow?: string;
  subtitle?: string;
  title: string;
}

function isCurrentPath(
  pathname: string,
  href: string
) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function TabIcon({ name }: { name: "projects" | "settings" }) {
  switch (name) {
    case "projects":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path
            d="M6 7.5h12m-12 4.5h8m-8 4.5h11"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "settings":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path
            d="M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Zm7.25 3.75-.98-.56a6.85 6.85 0 0 0-.35-.86l.28-1.09-1.58-1.58-1.09.28c-.28-.14-.57-.26-.86-.35l-.56-.98h-2.24l-.56.98c-.29.09-.58.21-.86.35l-1.09-.28-1.58 1.58.28 1.09c-.14.28-.26.57-.35.86l-.98.56v2.24l.98.56c.09.29.21.58.35.86l-.28 1.09 1.58 1.58 1.09-.28c.28.14.57.26.86.35l.56.98h2.24l.56-.98c.29-.09.58-.21.86-.35l1.09.28 1.58-1.58-.28-1.09c.14-.28.26-.57.35-.86l.98-.56Z"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.4"
          />
        </svg>
      );
  }
}

export function CodexShell({
  actions,
  children,
  eyebrow = "Codex",
  subtitle,
  title
}: CodexShellProps) {
  const pathname = usePathname();
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const { requestNavigation } = useNavigationGuard();
  const { keyboardOffset, keyboardOpen } = useKeyboardViewportState();
  const [queueBadge, setQueueBadge] = useState(0);

  useEffect(() => {
    const updateBadge = () => {
      const cached = getCachedOverview();
      const count =
        cached?.queue.filter(
          (e: { action_required: boolean }) => e.action_required
        ).length ?? 0;
      setQueueBadge(count);
    };
    updateBadge();
    const interval = setInterval(updateBadge, 3_000);
    return () => clearInterval(interval);
  }, []);
  const navItems = [
    { href: "/projects", key: "projects" as const, label: isZh ? "聊天" : "Chats" },
    { href: "/settings", key: "settings" as const, label: isZh ? "设置" : "Settings" }
  ];

  function createGuardedClickHandler(href: string) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      ) {
        return;
      }

      if (!requestNavigation(href)) {
        event.preventDefault();
      }
    };
  }

  return (
    <div
      className={`codex-app codex-app--primary ${keyboardOpen ? "is-keyboard-open" : ""}`}
      style={
        {
          "--keyboard-offset": `${keyboardOffset}px`,
          "--mobile-nav-height": keyboardOpen ? "0px" : "68px"
        } as CSSProperties
      }
    >
      <div className="codex-main codex-main--primary">
        <header className="codex-page-header">
          <div className="codex-page-header__copy">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h1>{title}</h1>
            {subtitle ? <p className="codex-page-header__subtitle">{subtitle}</p> : null}
          </div>
          <div className="codex-page-header__inline-actions">{actions}</div>
        </header>

        <div className="codex-page-body">{children}</div>
      </div>

      {!keyboardOpen && (
        <nav className="codex-tab-bar" aria-label={isZh ? "主导航" : "Primary navigation"}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              className={`codex-tab-bar__item ${
                isCurrentPath(pathname, item.href) ? "is-active" : ""
              }`}
              href={item.href}
              onClick={createGuardedClickHandler(item.href)}
            >
              <span className="codex-tab-bar__icon">
                <TabIcon name={item.key} />
              </span>
              {item.key === "projects" && queueBadge > 0 ? (
                <span className="codex-tab-bar__badge">{queueBadge}</span>
              ) : null}
              <span className="codex-tab-bar__label">{item.label}</span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
