import { pathToFileURL } from "node:url";

import type { GatewayRuntime } from "./server";
import { createGatewayServer } from "./server";

export const DEFAULT_GATEWAY_HOST = "127.0.0.1";
export const DEFAULT_GATEWAY_PORT = 8787;

function readEnv(value: string | undefined) {
  return value?.trim();
}

export function resolveGatewayHost(env: NodeJS.ProcessEnv = process.env) {
  return readEnv(env.CODEX_REMOTE_GATEWAY_HOST) ?? DEFAULT_GATEWAY_HOST;
}

export function resolveGatewayPort(env: NodeJS.ProcessEnv = process.env) {
  const rawPort = readEnv(env.CODEX_REMOTE_GATEWAY_PORT);
  if (!rawPort) {
    return DEFAULT_GATEWAY_PORT;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(
      `Invalid CODEX_REMOTE_GATEWAY_PORT: ${rawPort}. Expected an integer between 0 and 65535.`
    );
  }

  return port;
}

export interface GatewayCliRunResult {
  address: string;
  runtime: GatewayRuntime;
  shutdown: () => Promise<void>;
}

export async function runGatewayCli(
  env: NodeJS.ProcessEnv = process.env
): Promise<GatewayCliRunResult> {
  const host = resolveGatewayHost(env);
  const port = resolveGatewayPort(env);
  const runtime = await createGatewayServer();
  let address: string;

  try {
    address = await runtime.app.listen({
      host,
      port
    });
  } catch (error) {
    await runtime.app.close().catch(() => undefined);
    throw error;
  }
  let shutdownPromise: Promise<void> | null = null;

  const shutdown = async () => {
    if (!shutdownPromise) {
      shutdownPromise = runtime.app.close();
    }
    await shutdownPromise;
  };

  const handleSignal = (signal: NodeJS.Signals) => {
    void shutdown().catch((error) => {
      console.error(`Failed to shut down gateway after ${signal}:`, error);
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
  console.log(`Gateway listening on ${address}`);

  return {
    address,
    runtime,
    shutdown
  };
}

async function main() {
  await runGatewayCli();
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryUrl && import.meta.url === entryUrl) {
  void main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
