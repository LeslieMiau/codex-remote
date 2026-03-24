"use client";

import Link from "next/link";
import { type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { useNavigationGuard } from "./navigation-guard-provider";
import { useKeyboardViewportState } from "./mobile-viewport";
import styles from "./detail-shell.module.css";

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
      className={[styles.shell, keyboardOpen ? styles.shellKeyboardOpen : "", className]
        .filter(Boolean)
        .join(" ")}
      data-detail-shell="compact"
      style={
        {
          "--keyboard-offset": `${keyboardOffset}px`
        } as CSSProperties
      }
    >
      <div className={styles.frame}>
        <header className={styles.header}>
          <Link
            aria-label="Back"
            className={styles.back}
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

          <div className={styles.copy}>
            {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
            <h1>{title}</h1>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>

          <div className={styles.actions}>{actions}</div>
        </header>

        <main className={[styles.body, bodyClassName].filter(Boolean).join(" ")}>
          {children}
        </main>
      </div>
    </div>
  );
}
