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

  const commandBridge = {
    async listExperimentalFeatures() {
      return [
        {
          name: "fastApply",
          stage: "beta",
          displayName: "Fast Apply",
          description: "Apply patches faster",
          enabled: true,
          defaultEnabled: false
        }
      ];
    },
    async listMcpServerStatuses() {
      return [
        {
          name: "github",
          authStatus: "bearerToken",
          toolCount: 4,
          resourceCount: 2,
          resourceTemplateCount: 1
        }
      ];
    },
    async listModels() {
      return [
        {
          model: "gpt-5.4",
          displayName: "GPT-5.4",
          defaultReasoningEffort: "medium",
          reasoningLevels: [
            {
              reasoningEffort: "medium"
            },
            {
              reasoningEffort: "high"
            }
          ]
        },
        {
          model: "gpt-5.4-lite",
          displayName: "GPT-5.4 Lite",
          reasoningLevels: []
        }
      ];
    },
    async readAccount() {
      return {
        account: {
          type: "chatgpt",
          email: "leslie@example.com",
          planType: "pro"
        },
        requiresOpenaiAuth: false
      };
    },
    async readConfigRequirements() {
      return {
        allowedApprovalPolicies: ["onRequest", "unlessTrusted"],
        allowedSandboxModes: ["workspaceWrite", "readOnly"],
        allowedWebSearchModes: ["on", "off"],
        featureRequirements: {
          images: true
        },
        enforceResidency: "us"
      };
    },
    async readRateLimits() {
      return {
        rateLimits: {
          primary: {
            usedPercent: 42,
            windowDurationMins: 300,
            resetsAt: 1_773_800_000
          },
          planType: "pro"
        },
        rateLimitsByLimitId: {
          primary: {
            primary: {
              usedPercent: 42
            }
          }
        }
      };
    }
  };

  return new CodexSettingsBridge({
    codexHome
    ,
    commandBridge
  });
}

describe("CodexSettingsBridge", () => {
  it("reports writable shared settings and loads model metadata", async () => {
    const bridge = await createBridgeFixture();

    await expect(bridge.getCapabilities()).resolves.toEqual({
      diagnostics_read: true,
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
    expect(settings.requirements).toEqual({
      allowed_approval_policies: ["on-request", "untrusted"],
      allowed_sandbox_modes: ["workspace-write", "read-only"],
      allowed_web_search_modes: ["on", "off"],
      feature_requirements: {
        images: true
      },
      enforce_residency: "us"
    });
    expect(settings.experimental_features).toEqual([
      {
        name: "fastApply",
        stage: "beta",
        display_name: "Fast Apply",
        description: "Apply patches faster",
        announcement: undefined,
        enabled: true,
        default_enabled: false
      }
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

  it("builds diagnostics from command bridge responses", async () => {
    const bridge = await createBridgeFixture();

    await expect(bridge.getDiagnosticsSummary()).resolves.toMatchObject({
      account: {
        type: "chatgpt",
        email: "leslie@example.com",
        plan_type: "pro"
      },
      requires_openai_auth: false,
      rate_limits: {
        plan_type: "pro",
        primary: {
          used_percent: 42,
          window_duration_mins: 300
        }
      },
      rate_limits_by_limit_id: {
        primary: {
          primary: {
            used_percent: 42
          }
        }
      },
      mcp_servers: [
        {
          name: "github",
          auth_status: "bearerToken",
          tool_count: 4,
          resource_count: 2,
          resource_template_count: 1
        }
      ],
      errors: {}
    });
  });
});
