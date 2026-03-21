import { promises as fs, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  CodexApprovalPolicy,
  CodexDiagnosticsSummary,
  CodexExperimentalFeature,
  CodexModelOption,
  CodexSettings,
  CodexServiceTier,
  CodexSandboxMode
} from "@codex-remote/protocol";

interface SharedModelCacheRecord {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  default_reasoning_level?: unknown;
  supported_reasoning_levels?: unknown;
}

interface CommandBridgeModelRecord {
  defaultReasoningEffort?: unknown;
  description?: unknown;
  displayName?: unknown;
  id?: unknown;
  inputModalities?: unknown;
  isDefault?: unknown;
  model?: unknown;
  reasoningLevels?: unknown;
  slug?: unknown;
  supportsPersonality?: unknown;
}

interface CodexSettingsCommandSource {
  listExperimentalFeatures(): Promise<unknown[]>;
  listMcpServerStatuses(): Promise<unknown[]>;
  listModels(input?: { includeHidden?: boolean }): Promise<unknown[]>;
  readAccount(input?: { refreshToken?: boolean }): Promise<unknown | null>;
  readConfigRequirements(): Promise<unknown | null>;
  readRateLimits(): Promise<unknown | null>;
}

interface CodexSettingsBridgeOptions {
  codexHome?: string;
  commandBridge?: CodexSettingsCommandSource;
}

const MODEL_KEY = "model";
const REASONING_KEY = "model_reasoning_effort";

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

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

function toModelOptionFromCommandBridge(candidate: CommandBridgeModelRecord): CodexModelOption | null {
  const slugCandidate =
    typeof candidate.slug === "string"
      ? candidate.slug
      : typeof candidate.model === "string"
        ? candidate.model
        : typeof candidate.id === "string"
          ? candidate.id
          : "";
  const displayName =
    typeof candidate.displayName === "string" ? candidate.displayName.trim() : "";
  const slug = slugCandidate.trim();
  if (!slug || !displayName) {
    return null;
  }

  const rawLevels = Array.isArray(candidate.reasoningLevels) ? candidate.reasoningLevels : [];
  const reasoningLevels = rawLevels
    .map((level) => {
      const record = asRecord(level);
      if (!record) {
        return null;
      }

      const effort =
        typeof record.reasoningEffort === "string"
          ? record.reasoningEffort.trim()
          : typeof record.effort === "string"
            ? record.effort.trim()
            : "";
      if (!effort) {
        return null;
      }

      return {
        effort,
        description:
          typeof record.description === "string" ? record.description.trim() : undefined
      };
    })
    .filter((level): level is NonNullable<typeof level> => Boolean(level));

  return {
    slug,
    display_name: displayName,
    description:
      typeof candidate.description === "string" ? candidate.description.trim() : undefined,
    default_reasoning_effort:
      typeof candidate.defaultReasoningEffort === "string"
        ? candidate.defaultReasoningEffort.trim()
        : undefined,
    reasoning_levels: reasoningLevels,
    input_modalities: isStringArray(candidate.inputModalities) ? candidate.inputModalities : [],
    supports_personality: Boolean(candidate.supportsPersonality),
    is_default: Boolean(candidate.isDefault)
  };
}

function normalizeApprovalPolicy(value: string): CodexApprovalPolicy | null {
  switch (value.trim()) {
    case "never":
      return "never";
    case "onFailure":
    case "on-failure":
      return "on-failure";
    case "onRequest":
    case "on-request":
      return "on-request";
    case "unlessTrusted":
    case "untrusted":
      return "untrusted";
    default:
      return null;
  }
}

function normalizeSandboxMode(value: string): CodexSandboxMode | null {
  switch (value.trim()) {
    case "readOnly":
    case "read-only":
      return "read-only";
    case "workspaceWrite":
    case "workspace-write":
      return "workspace-write";
    case "dangerFullAccess":
    case "danger-full-access":
      return "danger-full-access";
    default:
      return null;
  }
}

function toIsoTimestamp(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  return undefined;
}

function toExperimentalFeature(candidate: Record<string, unknown>): CodexExperimentalFeature | null {
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const stage = typeof candidate.stage === "string" ? candidate.stage.trim() : "";
  if (!name || !stage) {
    return null;
  }

  return {
    name,
    stage,
    display_name:
      typeof candidate.displayName === "string" ? candidate.displayName.trim() : undefined,
    description:
      typeof candidate.description === "string" ? candidate.description.trim() : undefined,
    announcement:
      typeof candidate.announcement === "string" ? candidate.announcement.trim() : undefined,
    enabled: Boolean(candidate.enabled),
    default_enabled: Boolean(candidate.defaultEnabled)
  };
}

export class CodexSettingsBridge {
  readonly codexHome: string;
  readonly configPath: string;
  readonly modelsCachePath: string;
  readonly commandBridge?: CodexSettingsCommandSource;

  constructor(options: CodexSettingsBridgeOptions = {}) {
    this.codexHome =
      options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
    this.configPath = path.join(this.codexHome, "config.toml");
    this.modelsCachePath = path.join(this.codexHome, "models_cache.json");
    this.commandBridge = options.commandBridge;
  }

  async getCapabilities() {
    const configExists = await pathExists(this.configPath);
    const modelsExist = await pathExists(this.modelsCachePath);
    return {
      diagnostics_read: Boolean(this.commandBridge),
      settings_read: configExists || modelsExist || Boolean(this.commandBridge),
      settings_write: configExists && (await canWrite(this.configPath)),
      shared_model_config: configExists || modelsExist || Boolean(this.commandBridge)
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
    const [commandModels, requirements, experimentalFeatures] = await Promise.all([
      this.loadCommandBridgeModels(),
      this.loadConfigRequirements(),
      this.loadExperimentalFeatures()
    ]);
    const availableModels =
      commandModels.length > 0
        ? commandModels
        : modelsExist
          ? await this.loadAvailableModels()
          : [];
    const configStat = configExists ? await fs.stat(this.configPath) : null;

    return {
      model,
      model_reasoning_effort: modelReasoningEffort,
      available_models: availableModels,
      requirements: requirements ?? undefined,
      experimental_features: experimentalFeatures,
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

  async getDiagnosticsSummary(): Promise<CodexDiagnosticsSummary> {
    if (!this.commandBridge) {
      return {
        account: null,
        requires_openai_auth: false,
        rate_limits: null,
        rate_limits_by_limit_id: {},
        mcp_servers: [],
        errors: {}
      };
    }

    const [accountResult, rateLimitsResult, mcpServersResult] = await Promise.allSettled([
      this.commandBridge.readAccount(),
      this.commandBridge.readRateLimits(),
      this.commandBridge.listMcpServerStatuses()
    ]);

    const errors: CodexDiagnosticsSummary["errors"] = {};
    const accountPayload =
      accountResult.status === "fulfilled" ? accountResult.value : null;
    const rateLimitsPayload =
      rateLimitsResult.status === "fulfilled" ? rateLimitsResult.value : null;
    const mcpServersPayload =
      mcpServersResult.status === "fulfilled" ? mcpServersResult.value : [];

    if (accountResult.status === "rejected") {
      errors.account =
        accountResult.reason instanceof Error
          ? accountResult.reason.message
          : String(accountResult.reason);
    }
    if (rateLimitsResult.status === "rejected") {
      errors.rate_limits =
        rateLimitsResult.reason instanceof Error
          ? rateLimitsResult.reason.message
          : String(rateLimitsResult.reason);
    }
    if (mcpServersResult.status === "rejected") {
      errors.mcp_servers =
        mcpServersResult.reason instanceof Error
          ? mcpServersResult.reason.message
          : String(mcpServersResult.reason);
    }

    const accountRecord = asRecord(accountPayload);
    const rateLimitsRecord = asRecord(rateLimitsPayload);
    const rawByLimitId = asRecord(rateLimitsRecord?.rateLimitsByLimitId);
    const rateLimitsByLimitId: CodexDiagnosticsSummary["rate_limits_by_limit_id"] = {};

    if (rawByLimitId) {
      for (const [key, value] of Object.entries(rawByLimitId)) {
        const snapshot = this.toRateLimitSnapshot(asRecord(value));
        if (snapshot) {
          rateLimitsByLimitId[key] = snapshot;
        }
      }
    }

    const mcpServers: CodexDiagnosticsSummary["mcp_servers"] = [];
    for (const entry of mcpServersPayload) {
      const mapped = this.toMcpServerStatus(asRecord(entry));
      if (mapped) {
        mcpServers.push(mapped);
      }
    }

    return {
      account: this.toAccount(asRecord(accountRecord?.account)),
      requires_openai_auth: Boolean(accountRecord?.requiresOpenaiAuth),
      rate_limits: this.toRateLimitSnapshot(asRecord(rateLimitsRecord?.rateLimits)),
      rate_limits_by_limit_id: rateLimitsByLimitId,
      mcp_servers: mcpServers,
      errors
    };
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

  private async loadCommandBridgeModels(): Promise<CodexModelOption[]> {
    if (!this.commandBridge) {
      return [];
    }

    try {
      return (await this.commandBridge.listModels({
        includeHidden: false
      }))
        .map((candidate) => toModelOptionFromCommandBridge(candidate as CommandBridgeModelRecord))
        .filter((option): option is CodexModelOption => Boolean(option))
        .sort((left, right) => left.display_name.localeCompare(right.display_name));
    } catch {
      return [];
    }
  }

  private async loadConfigRequirements() {
    if (!this.commandBridge) {
      return null;
    }

    try {
      const record = asRecord(await this.commandBridge.readConfigRequirements());
      if (!record) {
        return null;
      }

      const approvalPolicies = Array.isArray(record.allowedApprovalPolicies)
        ? record.allowedApprovalPolicies
            .map((value) =>
              typeof value === "string" ? normalizeApprovalPolicy(value) : null
            )
            .filter((value): value is CodexApprovalPolicy => Boolean(value))
        : undefined;
      const sandboxModes = Array.isArray(record.allowedSandboxModes)
        ? record.allowedSandboxModes
            .map((value) =>
              typeof value === "string" ? normalizeSandboxMode(value) : null
            )
            .filter((value): value is CodexSandboxMode => Boolean(value))
        : undefined;
      const rawFeatureRequirements = asRecord(record.featureRequirements);
      const featureRequirements = rawFeatureRequirements
        ? Object.fromEntries(
            Object.entries(rawFeatureRequirements)
              .filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")
          )
        : undefined;

      return {
        allowed_approval_policies: approvalPolicies,
        allowed_sandbox_modes: sandboxModes,
        allowed_web_search_modes: isStringArray(record.allowedWebSearchModes)
          ? record.allowedWebSearchModes
          : undefined,
        feature_requirements: featureRequirements,
        enforce_residency:
          typeof record.enforceResidency === "string" ? record.enforceResidency : undefined
      };
    } catch {
      return null;
    }
  }

  private async loadExperimentalFeatures(): Promise<CodexExperimentalFeature[]> {
    if (!this.commandBridge) {
      return [];
    }

    try {
      return (await this.commandBridge.listExperimentalFeatures())
        .map((candidate) => toExperimentalFeature(asRecord(candidate) ?? {}))
        .filter((feature): feature is CodexExperimentalFeature => Boolean(feature));
    } catch {
      return [];
    }
  }

  private toAccount(record: Record<string, unknown> | null) {
    if (!record || typeof record.type !== "string") {
      return null;
    }

    if (record.type === "apiKey") {
      return {
        type: "apiKey" as const
      };
    }

    if (
      record.type === "chatgpt" &&
      typeof record.email === "string" &&
      typeof record.planType === "string"
    ) {
      return {
        type: "chatgpt" as const,
        email: record.email,
        plan_type: record.planType
      };
    }

    return null;
  }

  private toRateLimitSnapshot(record: Record<string, unknown> | null) {
    if (!record) {
      return null;
    }

    const primary = asRecord(record.primary);
    const secondary = asRecord(record.secondary);
    const credits = asRecord(record.credits);

    const toWindow = (candidate: Record<string, unknown> | null) => {
      if (!candidate || typeof candidate.usedPercent !== "number") {
        return null;
      }

      return {
        used_percent: candidate.usedPercent,
        window_duration_mins:
          typeof candidate.windowDurationMins === "number"
            ? candidate.windowDurationMins
            : undefined,
        resets_at: toIsoTimestamp(candidate.resetsAt)
      };
    };

    return {
      limit_id:
        typeof record.limitId === "string" ? record.limitId : undefined,
      limit_name:
        typeof record.limitName === "string" ? record.limitName : undefined,
      primary: toWindow(primary),
      secondary: toWindow(secondary),
      credits: credits
        ? {
            has_credits: Boolean(credits.hasCredits),
            unlimited: Boolean(credits.unlimited),
            balance:
              typeof credits.balance === "string" ? credits.balance : undefined
          }
        : undefined,
      plan_type:
        typeof record.planType === "string" ? record.planType : undefined
    };
  }

  private toMcpServerStatus(record: Record<string, unknown> | null) {
    if (!record || typeof record.name !== "string" || typeof record.authStatus !== "string") {
      return null;
    }

    const authStatus: "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth" =
      record.authStatus === "unsupported" ||
      record.authStatus === "notLoggedIn" ||
      record.authStatus === "bearerToken" ||
      record.authStatus === "oAuth"
        ? record.authStatus
        : "unsupported";

    return {
      name: record.name,
      auth_status: authStatus,
      tool_count: typeof record.toolCount === "number" ? record.toolCount : 0,
      resource_count:
        typeof record.resourceCount === "number" ? record.resourceCount : 0,
      resource_template_count:
        typeof record.resourceTemplateCount === "number"
          ? record.resourceTemplateCount
          : 0
    };
  }
}
