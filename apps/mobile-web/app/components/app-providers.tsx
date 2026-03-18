"use client";

import type { ReactNode } from "react";

import { LocaleProvider } from "../lib/locale";

export function AppProviders({ children }: { children: ReactNode }) {
  return <LocaleProvider>{children}</LocaleProvider>;
}
