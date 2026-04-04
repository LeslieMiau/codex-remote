import * as React from "react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import { setCachedOverview } from "../lib/client-cache";
import { LocaleProvider } from "../lib/locale";
import { CodexShell } from "./codex-shell";
import { NavigationGuardProvider } from "./navigation-guard-provider";
import { PrimaryMobileShell } from "./primary-mobile-shell";

let mockPathname = "/settings";

globalThis.React = React;

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    usePathname() {
      return mockPathname;
    }
  };
});

function renderWithProviders(node: ReactNode) {
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      null,
      createElement(NavigationGuardProvider, null, node)
    )
  );
}

function countMatches(markup: string, pattern: RegExp) {
  return [...markup.matchAll(pattern)].length;
}

describe("mobile shell probe", () => {
  beforeEach(() => {
    mockPathname = "/settings";
    setCachedOverview(null);
  });

  afterEach(() => {
    setCachedOverview(null);
  });

  it("keeps the settings tab icon structure aligned across both shell variants", () => {
    const shellMarkup = [
      renderWithProviders(
        createElement(
          CodexShell,
          {
            children: createElement("div", null, "body"),
            title: "Settings"
          }
        )
      ),
      renderWithProviders(
        createElement(
          PrimaryMobileShell,
          {
            children: createElement("div", null, "body"),
            title: "Settings"
          }
        )
      )
    ];

    for (const markup of shellMarkup) {
      expect(markup).toContain('href="/projects"');
      expect(markup).toContain('href="/settings"');
      expect(markup).toContain(">Chats<");
      expect(markup).toContain(">Settings<");
      expect(countMatches(markup, /href="\/(?:projects|settings)"/g)).toBe(2);
      expect(markup).toContain(
        'd="M5.5 7.5h5m4.5 0h3.5M5.5 12h8m4.5 0h.5m-13.5 4.5h2.5m4.5 0h6.5"'
      );
      expect(countMatches(markup, /<circle\b/g)).toBe(3);
    }
  });
});
