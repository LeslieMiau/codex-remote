"use client";

import type { ReactNode } from "react";

import { PrimaryMobileShell } from "./primary-mobile-shell";

interface ChatsHomeShellProps {
  actions?: ReactNode;
  children: ReactNode;
  subtitle?: string;
  title: string;
}

export function ChatsHomeShell({
  actions,
  children,
  subtitle,
  title
}: ChatsHomeShellProps) {
  return (
    <PrimaryMobileShell actions={actions} shellId="chats-home" subtitle={subtitle} title={title}>
      {children}
    </PrimaryMobileShell>
  );
}
