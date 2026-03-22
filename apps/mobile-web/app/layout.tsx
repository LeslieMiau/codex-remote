import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./mobile-refresh.css";
import { AppProviders } from "./components/app-providers";

export const metadata: Metadata = {
  title: "Codex Remote",
  description: "Mobile command center for a remote Codex coding agent",
  manifest: "/manifest.webmanifest"
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
