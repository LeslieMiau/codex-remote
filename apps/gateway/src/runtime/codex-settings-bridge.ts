import { promises as fs, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CodexModelOption, CodexSettings, CodexServiceTier } from "@codex-remote/protocol";

interface SharedModelCacheRecord {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  default_reasoning_level?: unknown;
  supported_reasoning_levels?: unknown;
}

interface CodexSettingsBridgeOptions {
  codexHome?: string;
  commandBridge?: unknown;
}

const MODEL_KEY = "model";
const REASONING_KEY = "model_reasoning_effort";

function normalizeLineEnding(value: string) {
  return value.includes("\r\n") ? "\r\n" : "\n";
}

function parseTomlString(raw: string, key: string) {
  const match = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"'\\n]+)["']\\s*$`, "m"));
  return match?.[1]?.trim();
}

function upsertTomlString(raw: string, key: string, value: string) {
  const newline = normalizeLineEnding(raw);
  const pattern = new RegExp(`^(\\s*${key}\\s*=\\s*["'])([^"'\\n]*)(["']\\s*)$`, "m");
  const rendered = `${key} = "${value}"`;

  if (pattern.test(raw)) {
    return raw.replace(pattern, rendered);
  }

  const suffix = raw.endsWith(newline) || raw.length === 0 ? "" : newline;
  return `${raw}${suffix}${rendered}${newline}`;
}

function removeTomlString(raw: string, key: string) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*["'][^"'\\n]*["']\\s*(?:\\r?\\n)?`, "m");
  return raw.replace(pattern, "");
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function canWrite(targetPath: string) {
  try {
    await fs.access(targetPath, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function toModelOption(candidate: SharedModelCacheRecord): CodexModelOption | null {
  const slug = typeof candidate.slug === "string" ? candidate.slug.trim() : "";
  const displayName =
    typeof candidate.display_name === "string" ? candidate.display_name.trim() : "";
  if (!slug || !displayName) {
    return null;
  }

  const rawLevels = Array.isArray(candidate.supported_reasoning_levels)
    ? candidate.supported_reasoning_levels
    : [];

  const reasoningLevels = rawLevels
    .map((level) => {
      if (!level || typeof level !== "object") {
        return null;
      }

      const effort =
        typeof (level as { effort?: unknown }).effort === "string"
          ? (level as { effort: string }).effort.trim()
          : "";

      if (!effort) {
        return null;
      }

      return {
        effort,
        description:
          typeof (level as { description?: unknown }).description === "string"
            ? (level as { description: string }).description.trim()
            : undefined
      };
    })
    .filter((level): level is NonNullable<typeof level> => Boolean(level));

  return {
    slug,
    display_name: displayName,
    description:
      typeof candidate.description === "string" ? candidate.description.trim() : undefined,
    default_reasoning_effort:
      typeof candidate.default_reasoning_level === "string"
        ? candidate.default_reasoning_level.trim()
        : undefined,
    reasoning_levels: reasoningLevels,
    input_modalities: [],
    supports_personality: false,
    is_default: false
  };
}

export class CodexSettingsBridge {
  readonly codexHome: string;
  readonly configPath: string;
  readonly modelsCachePath: string;

  constructor(options: CodexSettingsBridgeOptions = {}) {
    this.codexHome =
      options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
    this.configPath = path.join(this.codexHome, "config.toml");
    this.modelsCachePath = path.join(this.codexHome, "models_cache.json");
  }

  async getCapabilities() {
    const configExists = await pathExists(this.configPath);
    const modelsExist = await pathExists(this.modelsCachePath);
    return {
      settings_read: configExists,
      settings_write: configExists && (await canWrite(this.configPath)),
      shared_model_config: configExists || modelsExist
    };
  }

  async getSettings(): Promise<CodexSettings> {
    const [configExists, modelsExist] = await Promise.all([
      pathExists(this.configPath),
      pathExists(this.modelsCachePath)
    ]);

    const rawConfig = configExists ? await fs.readFile(this.configPath, "utf8") : "";
    const model = parseTomlString(rawConfig, MODEL_KEY);
    const modelReasoningEffort = parseTomlString(rawConfig, REASONING_KEY);
    const availableModels = modelsExist ? await this.loadAvailableModels() : [];
    const configStat = configExists ? await fs.stat(this.configPath) : null;

    return {
      model,
      model_reasoning_effort: modelReasoningEffort,
      available_models: availableModels,
      experimental_features: [],
      source: configExists ? this.configPath : undefined,
      read_only: !(configExists && (await canWrite(this.configPath))),
      updated_at: configStat ? configStat.mtime.toISOString() : undefined
    };
  }

  async updateSettings(input: {
    model?: string;
    model_reasoning_effort?: string;
    service_tier?: CodexServiceTier;
  }): Promise<CodexSettings> {
    void input.service_tier;

    if (!(await pathExists(this.configPath))) {
      throw new Error("Shared Codex config.toml is unavailable on this host.");
    }
    if (!(await canWrite(this.configPath))) {
      throw new Error("Shared Codex config.toml is read-only on this host.");
    }

    const current = await this.getSettings();
    const nextModel = input.model ?? current.model;
    if (!nextModel) {
      throw new Error("A shared Codex model is required.");
    }

    const modelOption = current.available_models.find((option) => option.slug === nextModel);
    if (current.available_models.length > 0 && !modelOption) {
      throw new Error(`Unknown shared Codex model: ${nextModel}`);
    }

    const supportedEfforts = modelOption?.reasoning_levels.map((level) => level.effort) ?? [];
    let nextReasoningEffort =
      input.model_reasoning_effort ?? current.model_reasoning_effort;
    if (
      typeof input.model === "string" &&
      input.model !== current.model &&
      supportedEfforts.length === 0 &&
      typeof input.model_reasoning_effort === "undefined"
    ) {
      nextReasoningEffort = undefined;
    }

    if (nextReasoningEffort) {
      if (supportedEfforts.length === 0 || !supportedEfforts.includes(nextReasoningEffort)) {
        throw new Error(
          `Reasoning effort ${nextReasoningEffort} is unavailable for model ${nextModel}.`
        );
      }
    }

    let rawConfig = await fs.readFile(this.configPath, "utf8");
    rawConfig = upsertTomlString(rawConfig, MODEL_KEY, nextModel);
    if (nextReasoningEffort) {
      rawConfig = upsertTomlString(rawConfig, REASONING_KEY, nextReasoningEffort);
    } else {
      rawConfig = removeTomlString(rawConfig, REASONING_KEY);
    }

    await fs.writeFile(this.configPath, rawConfig, "utf8");
    return this.getSettings();
  }

  private async loadAvailableModels(): Promise<CodexModelOption[]> {
    const raw = await fs.readFile(this.modelsCachePath, "utf8");
    const parsed = JSON.parse(raw) as { models?: unknown };
    const models = Array.isArray(parsed.models) ? parsed.models : [];
    return models
      .map((candidate) =>
        candidate && typeof candidate === "object"
          ? toModelOption(candidate as SharedModelCacheRecord)
          : null
      )
      .filter((option): option is CodexModelOption => Boolean(option))
      .sort((left, right) => left.display_name.localeCompare(right.display_name));
  }
}
