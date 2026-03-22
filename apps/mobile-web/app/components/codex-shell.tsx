"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode
} from "react";

import { getCachedOverview } from "../lib/client-cache";
import { buildThreadPath } from "../lib/codex-paths";
import { useLocale } from "../lib/locale";
import { getStoredLastActiveThread } from "../lib/thread-storage";
import { useNavigationGuard } from "./navigation-guard-provider";

interface CodexShellProps {
  actions?: ReactNode;
  backHref?: string;
  children: ReactNode;
  compactHeader?: boolean;
  eyebrow?: string;
  subtitle?: string;
  title: string;
}

function isEditableElement(element: Element | null) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return true;
  }

  if (element instanceof HTMLInputElement) {
    return !new Set([
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit"
    ]).has(element.type);
  }

  return false;
}

function isCurrentPath(
  pathname: string,
  href: string,
  key?: "thread" | "queue" | "projects" | "settings"
) {
  if (key === "thread" || href.startsWith("/threads/")) {
    return pathname.startsWith("/threads/");
  }
  if (key === "projects") {
    return pathname === "/projects" || pathname.startsWith("/projects/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function TabIcon({ name }: { name: "thread" | "queue" | "projects" | "settings" }) {
  switch (name) {
    case "thread":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path
            d="M6.5 7.5h11m-11 4.5h7m-7 4.5h9"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "queue":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path
            d="M7 7h10M7 12h10M7 17h6"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
          <circle cx="17.5" cy="17" r="1.5" fill="currentColor" />
        </svg>
      );
    case "projects":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path
            d="M5.5 7.5h13v9h-13zm4-3h5"
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
  backHref,
  children,
  compactHeader = false,
  eyebrow = "Codex",
  subtitle,
  title
}: CodexShellProps) {
  const pathname = usePathname();
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const { requestNavigation } = useNavigationGuard();
  const [lastActiveThread, setLastActiveThread] = useState<string | null>(() =>
    getStoredLastActiveThread()
  );
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [queueBadge, setQueueBadge] = useState(0);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLastActiveThread(getStoredLastActiveThread());
  }, [pathname]);

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

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeaderCollapsed(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateKeyboardState = () => {
      const activeEditable = isEditableElement(document.activeElement);
      const viewport = window.visualViewport;
      const keyboardHeight = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      const nextOpen = activeEditable && keyboardHeight > 120;
      setKeyboardOpen(nextOpen);
      setKeyboardOffset(nextOpen ? Math.round(keyboardHeight) : 0);
    };

    updateKeyboardState();
    const viewport = window.visualViewport;

    window.addEventListener("resize", updateKeyboardState);
    document.addEventListener("focusin", updateKeyboardState);
    document.addEventListener("focusout", updateKeyboardState);
    viewport?.addEventListener("resize", updateKeyboardState);
    viewport?.addEventListener("scroll", updateKeyboardState);

    return () => {
      window.removeEventListener("resize", updateKeyboardState);
      document.removeEventListener("focusin", updateKeyboardState);
      document.removeEventListener("focusout", updateKeyboardState);
      viewport?.removeEventListener("resize", updateKeyboardState);
      viewport?.removeEventListener("scroll", updateKeyboardState);
    };
  }, []);

  const currentThreadHref = lastActiveThread
    ? buildThreadPath(lastActiveThread)
    : "/projects";
  const navItems = [
    { href: "/projects", key: "projects" as const, label: isZh ? "聊天" : "Chats" },
    { href: "/queue", key: "queue" as const, label: isZh ? "待办" : "Tasks" },
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
      className={`codex-app ${keyboardOpen ? "is-keyboard-open" : ""} ${headerCollapsed ? "is-header-collapsed" : ""}`}
      style={
        {
          "--keyboard-offset": `${keyboardOffset}px`,
          "--mobile-nav-height": keyboardOpen ? "0px" : "56px"
        } as CSSProperties
      }
    >
      <div className="codex-main">
        <div ref={sentinelRef} style={{ height: 0 }} />
        <header className={`codex-page-header ${compactHeader ? "is-compact" : ""}`}>
          <div className="codex-page-header__top">
            {backHref ? (
              <Link
                className="codex-back-link"
                href={backHref}
                onClick={createGuardedClickHandler(backHref)}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
                  <path
                    d="M15 19l-7-7 7-7"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                  />
                </svg>
              </Link>
            ) : null}
            <h1>{title}</h1>
            <div className="codex-page-header__actions">
              {actions}
            </div>
          </div>
          {subtitle ? <p className="codex-page-header__subtitle">{subtitle}</p> : null}
        </header>

        <div className="codex-page-body">{children}</div>
      </div>

      {!keyboardOpen && (
        <nav className="codex-tab-bar" aria-label={isZh ? "主导航" : "Primary navigation"}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              className={`codex-tab-bar__item ${
                isCurrentPath(pathname, item.href, item.key) ? "is-active" : ""
              }`}
              href={item.href}
              onClick={createGuardedClickHandler(item.href)}
            >
              <span className="codex-tab-bar__icon">
                <TabIcon name={item.key} />
              </span>
              {item.key === "queue" && queueBadge > 0 ? (
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
