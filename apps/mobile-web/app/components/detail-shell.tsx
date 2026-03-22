"use client";

import Link from "next/link";
import { type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { useNavigationGuard } from "./navigation-guard-provider";
import { useKeyboardViewportState } from "./mobile-viewport";

interface DetailShellProps {
  actions?: ReactNode;
  backHref: string;
  bodyClassName?: string;
  children: ReactNode;
  className?: string;
  eyebrow?: string;
  subtitle?: string;
  title: string;
}

export function DetailShell({
  actions,
  backHref,
  bodyClassName,
  children,
  className,
  eyebrow,
  subtitle,
  title
}: DetailShellProps) {
  const { requestNavigation } = useNavigationGuard();
  const { keyboardOffset, keyboardOpen } = useKeyboardViewportState();

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
      className={[
        "codex-detail-shell",
        keyboardOpen ? "is-keyboard-open" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          "--keyboard-offset": `${keyboardOffset}px`
        } as CSSProperties
      }
    >
      <header className="codex-detail-header">
        <Link
          aria-label="Back"
          className="codex-detail-header__back"
          href={backHref}
          onClick={createGuardedClickHandler(backHref)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path
              d="M15 19l-7-7 7-7"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.2"
            />
          </svg>
        </Link>

        <div className="codex-detail-header__copy">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1>{title}</h1>
          {subtitle ? <p className="codex-detail-header__subtitle">{subtitle}</p> : null}
        </div>

        <div className="codex-detail-header__actions">{actions}</div>
      </header>

      <main className={["codex-detail-shell__body", bodyClassName].filter(Boolean).join(" ")}>
        {children}
      </main>
    </div>
  );
}
