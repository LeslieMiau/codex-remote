"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode
} from "react";

import { getCachedOverview } from "../lib/client-cache";
import { useLocale } from "../lib/locale";
import { useNavigationGuard } from "./navigation-guard-provider";
import { useKeyboardViewportState } from "./mobile-viewport";
import styles from "./primary-mobile-shell.module.css";

interface PrimaryMobileShellProps {
  actions?: ReactNode;
  children: ReactNode;
  eyebrow?: string;
  shellId?: string;
  subtitle?: string;
  title: string;
}

function isCurrentPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function TabIcon({ name }: { name: "projects" | "settings" }) {
  switch (name) {
    case "projects":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path
            d="M5.5 8.5h13m-13 4.5h13m-13 4.5h9"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.9"
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

export function PrimaryMobileShell({
  actions,
  children,
  eyebrow,
  shellId = "primary-mobile",
  subtitle,
  title
}: PrimaryMobileShellProps) {
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
          (entry: { action_required: boolean }) => entry.action_required
        ).length ?? 0;
      setQueueBadge(count);
    };

    updateBadge();
    const interval = window.setInterval(updateBadge, 3_000);
    return () => window.clearInterval(interval);
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
      className={`${styles.shell} ${keyboardOpen ? styles.shellKeyboardOpen : ""}`}
      data-shell={shellId}
      style={
        {
          "--keyboard-offset": `${keyboardOffset}px`
        } as CSSProperties
      }
    >
      <div className={styles.layout}>
        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <h1>{title}</h1>
          </div>
          {actions ? <div className={styles.headerActions}>{actions}</div> : null}
        </header>

        <main className={styles.body}>{children}</main>
      </div>

      {!keyboardOpen ? (
        <nav
          aria-label={isZh ? "主导航" : "Primary navigation"}
          className={styles.tabBar}
        >
          {navItems.map((item) => {
            const active = isCurrentPath(pathname, item.href);
            return (
              <Link
                key={item.href}
                className={`${styles.tabItem} ${active ? styles.tabItemActive : ""}`}
                href={item.href}
                onClick={createGuardedClickHandler(item.href)}
              >
                <span className={styles.tabIcon}>
                  <TabIcon name={item.key} />
                </span>
                {item.key === "projects" && queueBadge > 0 ? (
                  <span className={styles.tabBadge}>
                    {queueBadge > 9 ? "9+" : queueBadge}
                  </span>
                ) : null}
                <span className={styles.tabLabel}>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
