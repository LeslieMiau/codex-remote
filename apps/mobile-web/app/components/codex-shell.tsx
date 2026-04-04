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
            d="M5.5 7.5h5m4.5 0h3.5M5.5 12h8m4.5 0h.5m-13.5 4.5h2.5m4.5 0h6.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          <circle cx="12.75" cy="7.5" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="15.75" cy="12" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="10.25" cy="16.5" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.8" />
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
