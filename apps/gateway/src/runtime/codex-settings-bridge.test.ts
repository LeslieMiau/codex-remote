import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CodexSettingsBridge } from "./codex-settings-bridge";

const cleanupRoots: string[] = [];

afterEach(async () => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

async function createBridgeFixture() {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-settings-bridge-"));
  cleanupRoots.push(codexHome);

  await fs.writeFile(
    path.join(codexHome, "config.toml"),
    ['model = "gpt-5.4"', 'model_reasoning_effort = "medium"', ""].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(codexHome, "models_cache.json"),
    JSON.stringify(
      {
        models: [
          {
            slug: "gpt-5.4",
            display_name: "GPT-5.4",
            default_reasoning_level: "medium",
            supported_reasoning_levels: [
              {
                effort: "medium"
              },
              {
                effort: "high"
              }
            ]
          },
          {
            slug: "gpt-5.4-lite",
            display_name: "GPT-5.4 Lite",
            supported_reasoning_levels: []
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  return new CodexSettingsBridge({
    codexHome
  });
}

describe("CodexSettingsBridge", () => {
  it("reports writable shared settings and loads model metadata", async () => {
    const bridge = await createBridgeFixture();

    await expect(bridge.getCapabilities()).resolves.toEqual({
      settings_read: true,
      settings_write: true,
      shared_model_config: true
    });

    const settings = await bridge.getSettings();
    expect(settings.model).toBe("gpt-5.4");
    expect(settings.model_reasoning_effort).toBe("medium");
    expect(settings.available_models.map((model) => model.slug)).toEqual([
      "gpt-5.4",
      "gpt-5.4-lite"
    ]);
  });

  it("updates reasoning for supported models and clears stale reasoning for simple models", async () => {
    const bridge = await createBridgeFixture();

    const updated = await bridge.updateSettings({
      model: "gpt-5.4",
      model_reasoning_effort: "high"
    });
    expect(updated.model).toBe("gpt-5.4");
    expect(updated.model_reasoning_effort).toBe("high");

    const switched = await bridge.updateSettings({
      model: "gpt-5.4-lite"
    });
    expect(switched.model).toBe("gpt-5.4-lite");
    expect(switched.model_reasoning_effort).toBeUndefined();

    await expect(
      fs.readFile(path.join(bridge.codexHome, "config.toml"), "utf8")
    ).resolves.toBe('model = "gpt-5.4-lite"\n');
  });
});
