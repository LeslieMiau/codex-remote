"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { localize, useLocale } from "../lib/locale";

interface MobileSheetProps {
  children: ReactNode;
  disableDismiss?: boolean;
  eyebrow?: string;
  footer?: ReactNode;
  fullHeight?: boolean;
  open: boolean;
  onClose(): void;
  title: string;
  variant?: "default" | "chat";
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

function getFocusableElements(container: HTMLElement | null) {
  if (!container) {
    return [];
  }

  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.hasAttribute("disabled") && element.tabIndex !== -1
  );
}

export function MobileSheet({
  children,
  disableDismiss = false,
  eyebrow,
  footer,
  fullHeight = true,
  open,
  onClose,
  title,
  variant = "default"
}: MobileSheetProps) {
  const { locale } = useLocale();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    const frame = window.requestAnimationFrame(() => {
      const focusable = getFocusableElements(dialogRef.current);
      (focusable[0] ?? closeButtonRef.current ?? dialogRef.current)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disableDismiss) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = getFocusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;

      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus();
      }
    };
  }, [disableDismiss, open]);

  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ y: number; time: number } | null>(null);

  const handleTouchStart = useCallback(
    (event: React.TouchEvent) => {
      if (disableDismiss) return;
      dragStartRef.current = { y: event.touches[0].clientY, time: Date.now() };
      setIsDragging(true);
    },
    [disableDismiss]
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent) => {
      if (!dragStartRef.current) return;
      const delta = Math.max(0, event.touches[0].clientY - dragStartRef.current.y);
      setDragY(delta);
    },
    []
  );

  const handleTouchEnd = useCallback(() => {
    if (!dragStartRef.current) return;
    const velocity = dragY / Math.max(1, Date.now() - dragStartRef.current.time);
    if (dragY > 100 || velocity > 0.4) {
      onCloseRef.current();
    }
    setDragY(0);
    setIsDragging(false);
    dragStartRef.current = null;
  }, [dragY]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={`codex-mobile-sheet ${disableDismiss ? "is-locked" : ""} ${
        variant === "chat" ? "codex-mobile-sheet--chat" : ""
      }`}
      data-variant={variant}
    >
      <div className="sheet-backdrop" onClick={disableDismiss ? undefined : onClose} />
      <section
        aria-modal="true"
        aria-labelledby={titleId}
        className={`sheet codex-mobile-sheet__dialog ${fullHeight ? "is-full-height" : ""} ${
          variant === "chat" ? "codex-mobile-sheet__dialog--chat" : ""
        }`}
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        style={
          dragY > 0
            ? { transform: `translateY(${dragY}px)`, transition: isDragging ? "none" : undefined }
            : undefined
        }
        tabIndex={-1}
      >
        <div
          aria-hidden="true"
          className={`codex-mobile-sheet__handle ${
            variant === "chat" ? "codex-mobile-sheet__handle--chat" : ""
          }`}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          onTouchStart={handleTouchStart}
        />
        <header className={`sheet-header ${variant === "chat" ? "sheet-header--chat" : ""}`}>
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            className="chrome-button"
            disabled={disableDismiss}
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            {localize(locale, { zh: "关闭", en: "Close" })}
          </button>
        </header>

        <div
          className={`codex-mobile-sheet__content ${
            variant === "chat" ? "codex-mobile-sheet__content--chat" : ""
          }`}
        >
          {children}
        </div>

        {footer ? (
          <div
            className={`sheet-actions codex-mobile-sheet__footer ${
              variant === "chat" ? "codex-mobile-sheet__footer--chat" : ""
            }`}
          >
            {footer}
          </div>
        ) : null}
      </section>
    </div>
  );
}
