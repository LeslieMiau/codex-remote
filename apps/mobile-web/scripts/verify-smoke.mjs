#!/usr/bin/env node

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(__filename);
const appDir = path.resolve(scriptDir, "..");

const host = process.env.MOBILE_WEB_SMOKE_HOST ?? "127.0.0.1";
const port = Number(process.env.MOBILE_WEB_SMOKE_PORT ?? "3111");
const baseUrl = `http://${host}:${port}`;
const skipBrowser = process.env.MOBILE_WEB_SMOKE_SKIP_BROWSER === "1";

const htmlDisallowedMarkers = [
  "codex-home-hero",
  "codex-page-card--plain",
  "Like WeChat or Telegram",
  "像微信和 Telegram 一样",
  "codex-app--primary"
];

const routeChecks = [
  { path: "/", status: 307, location: "/projects" },
  { path: "/projects", status: 200 },
  { path: "/queue", status: 200 },
  { path: "/settings", status: 200 },
  { path: "/threads/recovered-thread", status: 200 }
];

const htmlChecks = [
  { path: "/projects", marker: 'data-overview-screen="chat-list"' },
  { path: "/queue", marker: 'data-queue-screen="compact-inbox"' },
  { path: "/settings", marker: 'data-settings-screen="compact-settings"' }
];

const serverLog = [];

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendServerLog(chunk) {
  const text = chunk.toString();
  const lines = text.split(/\r?\n/).filter(Boolean);
  serverLog.push(...lines);
  if (serverLog.length > 120) {
    serverLog.splice(0, serverLog.length - 120);
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: appDir,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${code}\n${stdout}${stderr}`.trim()
        )
      );
    });
  });
}

function spawnPnpm(args, options = {}) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return spawn(process.execPath, [npmExecPath, ...args], options);
  }

  return spawn("pnpm", args, options);
}

async function fetchRoute(routePath, redirect = "manual") {
  const response = await fetch(`${baseUrl}${routePath}`, {
    redirect,
    signal: AbortSignal.timeout(10_000)
  });
  return response;
}

async function waitForServerReady(serverProcess) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      fail(
        `mobile-web dev server exited early.\n${serverLog.slice(-40).join("\n")}`
      );
    }

    try {
      const response = await fetchRoute("/projects");
      if (response.status === 200) {
        return;
      }
    } catch {
      // Keep polling while Next boots and compiles.
    }

    await sleep(1_000);
  }

  fail(
    `Timed out waiting for ${baseUrl}/projects.\n${serverLog.slice(-40).join("\n")}`
  );
}

function browserEnv() {
  const tempRoot = path.join(os.tmpdir(), "codex-mobile-web-smoke");
  const home = path.join(tempRoot, "home");
  const xdgCache = path.join(tempRoot, "xdg-cache");
  const npmCache = path.join(tempRoot, "npm-cache");
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(tempRoot, "browsers");

  mkdirSync(home, { recursive: true });
  mkdirSync(xdgCache, { recursive: true });
  mkdirSync(npmCache, { recursive: true });
  mkdirSync(browsers, { recursive: true });

  return {
    HOME: home,
    XDG_CACHE_HOME: xdgCache,
    NPM_CONFIG_CACHE: npmCache,
    PLAYWRIGHT_BROWSERS_PATH: browsers
  };
}

async function ensureChromiumInstalled(env) {
  const browsersDir = env.PLAYWRIGHT_BROWSERS_PATH;
  const hasChromium = readdirSync(browsersDir).some((entry) => entry.startsWith("chromium-"));
  if (hasChromium) {
    return;
  }

  log("Installing Playwright Chromium for browser smoke...");
  await runCommand("npx", ["--yes", "playwright", "install", "chromium"], { env });
}

async function runBrowserSmoke() {
  const env = browserEnv();
  await ensureChromiumInstalled(env);

  const outputDir = path.join(appDir, "output", "playwright");
  mkdirSync(outputDir, { recursive: true });
  const screenshotPath = path.join(outputDir, "smoke-projects.png");
  rmSync(screenshotPath, { force: true });

  log("Running browser screenshot smoke for /projects...");
  await runCommand(
    "npx",
    [
      "--yes",
      "playwright",
      "screenshot",
      "-b",
      "chromium",
      "--viewport-size=390,844",
      "--color-scheme=dark",
      "--timeout=30000",
      `${baseUrl}/projects`,
      screenshotPath
    ],
    { env }
  );
}

async function verifyRoutes() {
  for (const route of routeChecks) {
    const response = await fetchRoute(route.path);
    if (response.status !== route.status) {
      const body = await response.text();
      fail(
        `Expected ${route.path} to return ${route.status}, got ${response.status}.\n${body.slice(0, 1200)}`
      );
    }

    if (route.location) {
      const location = response.headers.get("location");
      if (location !== route.location) {
        fail(
          `Expected ${route.path} to redirect to ${route.location}, got ${location ?? "null"}.`
        );
      }
    }
  }
}

async function verifyCompactHtml() {
  for (const check of htmlChecks) {
    const response = await fetchRoute(check.path);
    const html = await response.text();

    if (!html.includes(check.marker)) {
      fail(`${check.path} HTML is missing the compact root marker ${check.marker}.`);
    }

    for (const marker of htmlDisallowedMarkers) {
      if (html.includes(marker)) {
        fail(`${check.path} HTML still contains legacy marker: ${marker}`);
      }
    }
  }
}

async function main() {
  const nextBinary = path.join(appDir, "node_modules", ".bin", "next");
  const serverProcess = spawn(
    nextBinary,
    ["dev", "--hostname", host, "--port", String(port)],
    {
      cwd: appDir,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        WATCHPACK_POLLING: "true"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let startupError = null;

  serverProcess.stdout.on("data", appendServerLog);
  serverProcess.stderr.on("data", appendServerLog);
  serverProcess.on("error", (error) => {
    startupError = error;
    appendServerLog(String(error));
  });

  const shutdown = () => {
    if (serverProcess.exitCode === null) {
      serverProcess.kill("SIGTERM");
    }
  };

  process.on("exit", shutdown);
  process.on("SIGINT", () => {
    shutdown();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(143);
  });

  try {
    log(`Booting mobile-web dev server on ${baseUrl}...`);
    if (startupError) {
      fail(`Failed to start mobile-web dev server.\n${String(startupError)}`);
    }
    await waitForServerReady(serverProcess);

    log("Verifying HTTP routes...");
    await verifyRoutes();

    log("Verifying compact HTML markers...");
    await verifyCompactHtml();

    if (skipBrowser) {
      log("Skipping browser smoke because MOBILE_WEB_SMOKE_SKIP_BROWSER=1 was set explicitly.");
    } else {
      await runBrowserSmoke();
    }

    log("mobile-web smoke verification passed.");
  } finally {
    shutdown();
    await sleep(1_000);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
