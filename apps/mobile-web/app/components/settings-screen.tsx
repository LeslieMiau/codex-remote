"use client";

import { useEffect, useRef, useState } from "react";

import {
  getCachedSharedSettings,
  setCachedSharedSettings
} from "../lib/client-cache";
import {
  getCodexDiagnosticsSummary,
  getCodexSharedSettings,
  updateCodexSharedSettings
} from "../lib/gateway-client";
import { formatDateTime, localize, useLocale } from "../lib/locale";
import { PrimaryMobileShell } from "./primary-mobile-shell";
import styles from "./settings-screen.module.css";

function describeSaveError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function SettingsScreen() {
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const [settings, setSettings] = useState(() => getCachedSharedSettings());
  const [diagnostics, setDiagnostics] = useState<Awaited<
    ReturnType<typeof getCodexDiagnosticsSummary>
  > | null>(null);
  const [draftModel, setDraftModel] = useState(() => getCachedSharedSettings()?.model ?? "");
  const [draftReasoning, setDraftReasoning] = useState(
    () => getCachedSharedSettings()?.model_reasoning_effort ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!getCachedSharedSettings());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const inFlightRef = useRef(false);

  function syncDrafts(nextSettings: typeof settings) {
    setDraftModel(nextSettings?.model ?? "");
    setDraftReasoning(nextSettings?.model_reasoning_effort ?? "");
  }

  async function loadSettings(background = false) {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    if (background) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const [settingsResult, diagnosticsResult] = await Promise.allSettled([
        getCodexSharedSettings(),
        getCodexDiagnosticsSummary()
      ]);
      if (settingsResult.status !== "fulfilled") {
        throw settingsResult.reason;
      }

      const nextSettings = settingsResult.value;
      setSettings(nextSettings);
      setCachedSharedSettings(nextSettings);
      syncDrafts(nextSettings);
      setError(null);
      if (diagnosticsResult.status === "fulfilled") {
        setDiagnostics(diagnosticsResult.value);
        setDiagnosticsError(null);
      } else {
        setDiagnostics(null);
        setDiagnosticsError(describeSaveError(diagnosticsResult.reason));
      }
    } catch (loadError) {
      setError(describeSaveError(loadError));
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setToastMessage(null);
    }, 4_000);

    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  const selectedModel = settings?.available_models.find((model) => model.slug === draftModel) ?? null;
  const reasoningLevels = selectedModel?.reasoning_levels ?? [];
  const savedModel = settings?.model ?? "";
  const savedReasoning = settings?.model_reasoning_effort ?? "";
  const isReadOnly = settings?.read_only ?? true;
  const requirements = settings?.requirements;
  const hasChanges = draftModel !== savedModel || draftReasoning !== savedReasoning;
  const canSave =
    Boolean(settings) && !isReadOnly && !isSaving && Boolean(draftModel) && hasChanges;

  function handleModelChange(nextModel: string) {
    setDraftModel(nextModel);

    const nextOption =
      settings?.available_models.find((model) => model.slug === nextModel) ?? null;
    const nextLevels = nextOption?.reasoning_levels ?? [];
    if (nextLevels.length === 0) {
      setDraftReasoning("");
      return;
    }

    if (nextLevels.some((level) => level.effort === draftReasoning)) {
      return;
    }

    setDraftReasoning(
      nextOption?.default_reasoning_effort ?? nextLevels[0]?.effort ?? ""
    );
  }

  async function handleSave() {
    if (!canSave) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const nextSettings = await updateCodexSharedSettings({
        model: draftModel,
        model_reasoning_effort: draftReasoning || undefined
      });
      setSettings(nextSettings);
      setCachedSharedSettings(nextSettings);
      syncDrafts(nextSettings);
      try {
        setDiagnostics(await getCodexDiagnosticsSummary());
        setDiagnosticsError(null);
      } catch (diagnosticsLoadError) {
        setDiagnosticsError(describeSaveError(diagnosticsLoadError));
      }
      setToastMessage(
        localize(locale, {
          zh: "共享配置已更新。",
          en: "Shared configuration updated."
        })
      );
    } catch (saveError) {
      setError(describeSaveError(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  function renderRefreshIcon() {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path
          d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.9"
        />
      </svg>
    );
  }

  const sourceLabel = settings?.source ?? "-";
  const updatedLabel = settings?.updated_at
    ? formatDateTime(locale, settings.updated_at)
    : localize(locale, { zh: "未知时间", en: "Unknown time" });
  const editableLabel = settings?.read_only
    ? localize(locale, { zh: "只读", en: "Read only" })
    : localize(locale, { zh: "可编辑", en: "Editable" });
  const editorNote = settings?.read_only
    ? localize(locale, {
        zh: "当前环境只能读取共享配置，手机端暂时不能直接保存。",
        en: "This host is read only, so edits cannot be saved from mobile right now."
      })
    : localize(locale, {
        zh: "保存后，新的模型与推理设置会用于后续共享线程。",
        en: "Saved model and reasoning settings will apply to new shared thread runs."
      });

  return (
    <PrimaryMobileShell
      actions={
        <button
          aria-label={
            isRefreshing
              ? localize(locale, { zh: "同步中", en: "Syncing" })
              : localize(locale, { zh: "刷新设置", en: "Refresh settings" })
          }
          className={styles.iconButton}
          disabled={isLoading || isRefreshing || isSaving}
          onClick={() => void loadSettings(true)}
          title={localize(locale, { zh: "刷新", en: "Refresh" })}
          type="button"
        >
          {renderRefreshIcon()}
        </button>
      }
      eyebrow={isZh ? "设置" : "Settings"}
      shellId="settings-home"
      subtitle={isZh ? "共享模型与推理" : "Shared model and reasoning"}
      title={isZh ? "设置" : "Settings"}
    >
      <div className={styles.page} data-settings-screen="compact-settings">
        {toastMessage ? (
          <div aria-live="polite" className={`codex-toast ${styles.toast}`} role="status">
            {toastMessage}
          </div>
        ) : null}

        {error ? (
          <section aria-live="assertive" className={styles.notice} role="alert">
            <strong>
              {localize(locale, {
                zh: "暂时无法读取或更新共享配置",
                en: "Unable to load or update shared configuration right now"
              })}
            </strong>
            <p>{error}</p>
          </section>
        ) : null}

        <section className={styles.summary}>
          <div className={styles.summaryHead}>
            <div>
              <p className={styles.summaryLabel}>
                {localize(locale, { zh: "当前配置", en: "Current config" })}
              </p>
              <p className={styles.summaryValue}>
                {settings?.model ?? localize(locale, { zh: "未设置", en: "Not set" })}
              </p>
              <p className={styles.summarySubline}>
                {settings?.model_reasoning_effort
                  ? localize(locale, {
                      zh: `推理 ${settings.model_reasoning_effort}`,
                      en: `Reasoning ${settings.model_reasoning_effort}`
                    })
                  : localize(locale, {
                      zh: "使用模型默认推理。",
                      en: "Using the model default reasoning."
                    })}
              </p>
            </div>
            <span className={`${styles.pill} ${styles.pillAccent}`}>{editableLabel}</span>
          </div>
          <div className={styles.pillRow}>
            <span className={styles.pill}>
              {localize(locale, { zh: "来源", en: "Source" })}: {sourceLabel}
            </span>
            <span className={styles.pill}>
              {localize(locale, { zh: "更新于", en: "Updated" })}: {updatedLabel}
            </span>
            {diagnostics?.requires_openai_auth ? (
              <span className={styles.pill}>
                {localize(locale, { zh: "需要认证", en: "Auth required" })}
              </span>
            ) : null}
          </div>
        </section>

        <section className={styles.editor}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}>{isZh ? "编辑" : "Edit"}</p>
              <h2>{isZh ? "共享模型配置" : "Shared model configuration"}</h2>
              <p className={styles.sectionNote}>{editorNote}</p>
            </div>
          </div>

          {isLoading && !settings ? (
            <p className={styles.loading}>
              {localize(locale, { zh: "正在读取配置。", en: "Loading settings." })}
            </p>
          ) : (
            <>
              <div className={styles.grid}>
                <label className={styles.field}>
                  <span>{localize(locale, { zh: "模型", en: "Model" })}</span>
                  <select
                    className={styles.control}
                    disabled={Boolean(settings?.read_only) || isSaving || !settings}
                    onChange={(event) => handleModelChange(event.target.value)}
                    value={draftModel}
                  >
                    {settings?.available_models.map((model) => (
                      <option key={model.slug} value={model.slug}>
                        {model.display_name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.field}>
                  <span>{localize(locale, { zh: "推理", en: "Reasoning" })}</span>
                  <select
                    className={styles.control}
                    disabled={
                      Boolean(settings?.read_only) ||
                      isSaving ||
                      !settings ||
                      reasoningLevels.length === 0
                    }
                    onChange={(event) => setDraftReasoning(event.target.value)}
                    value={draftReasoning}
                  >
                    {reasoningLevels.length === 0 ? (
                      <option value="">
                        {localize(locale, { zh: "模型默认", en: "Model default" })}
                      </option>
                    ) : null}
                    {reasoningLevels.map((level) => (
                      <option key={level.effort} value={level.effort}>
                        {level.effort}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className={styles.saveBar}>
                <p className={styles.saveNote}>
                  {selectedModel?.description ??
                    (reasoningLevels.length > 0
                      ? localize(locale, {
                          zh: `可用推理强度：${reasoningLevels.map((level) => level.effort).join(", ")}`,
                          en: `Available reasoning levels: ${reasoningLevels
                            .map((level) => level.effort)
                            .join(", ")}`
                        })
                      : localize(locale, {
                          zh: "当前模型没有额外可选推理强度。",
                          en: "This model does not expose extra reasoning levels."
                        }))}
                </p>
                <div className={styles.saveActions}>
                  <button
                    className={styles.secondaryButton}
                    disabled={isSaving || isLoading || !hasChanges}
                    onClick={() => syncDrafts(settings)}
                    type="button"
                  >
                    {localize(locale, { zh: "还原", en: "Reset" })}
                  </button>
                  <button
                    className={styles.primaryButton}
                    disabled={!canSave}
                    onClick={() => void handleSave()}
                    type="button"
                  >
                    {isSaving
                      ? localize(locale, { zh: "保存中", en: "Saving" })
                      : localize(locale, { zh: "保存", en: "Save" })}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        <div className={styles.advancedList}>
          <details className={styles.disclosure}>
            <summary>
              <span className={styles.disclosureLabel}>
                <strong>{isZh ? "模型列表" : "Models"}</strong>
                <span>
                  {settings?.available_models.length
                    ? localize(locale, {
                        zh: `${settings.available_models.length} 个可用模型`,
                        en: `${settings.available_models.length} available models`
                      })
                    : localize(locale, {
                        zh: "当前没有模型缓存",
                        en: "No cached models"
                      })}
                </span>
              </span>
              <span className={styles.disclosureHint}>{isZh ? "展开" : "Open"}</span>
            </summary>
            <div className={styles.disclosureBody}>
              {settings?.available_models.length ? (
                <div className={styles.readList}>
                  {settings.available_models.map((model) => (
                    <article className={styles.readItem} key={model.slug}>
                      <span>{model.display_name}</span>
                      <strong>
                        {model.slug}
                        {model.default_reasoning_effort
                          ? ` · ${model.default_reasoning_effort}`
                          : ""}
                      </strong>
                    </article>
                  ))}
                </div>
              ) : (
                <p className={styles.empty}>
                  {localize(locale, {
                    zh: "当前没有可展示的模型缓存。",
                    en: "No shared model cache is available right now."
                  })}
                </p>
              )}
            </div>
          </details>

          <details className={styles.disclosure}>
            <summary>
              <span className={styles.disclosureLabel}>
                <strong>{isZh ? "约束与特性" : "Requirements and features"}</strong>
                <span>{isZh ? "批准、沙箱、搜索和实验开关" : "Policies, sandbox, search, and flags"}</span>
              </span>
              <span className={styles.disclosureHint}>{isZh ? "展开" : "Open"}</span>
            </summary>
            <div className={styles.disclosureBody}>
              {requirements ||
              (settings?.experimental_features.length ?? 0) > 0 ? (
                <div className={styles.readList}>
                  {requirements?.allowed_approval_policies?.length ? (
                    <article className={styles.readItem}>
                      <span>{localize(locale, { zh: "批准策略", en: "Approval policies" })}</span>
                      <strong>{requirements.allowed_approval_policies.join(", ")}</strong>
                    </article>
                  ) : null}
                  {requirements?.allowed_sandbox_modes?.length ? (
                    <article className={styles.readItem}>
                      <span>{localize(locale, { zh: "沙箱模式", en: "Sandbox modes" })}</span>
                      <strong>{requirements.allowed_sandbox_modes.join(", ")}</strong>
                    </article>
                  ) : null}
                  {requirements?.allowed_web_search_modes?.length ? (
                    <article className={styles.readItem}>
                      <span>{localize(locale, { zh: "搜索模式", en: "Web search modes" })}</span>
                      <strong>{requirements.allowed_web_search_modes.join(", ")}</strong>
                    </article>
                  ) : null}
                  {requirements?.enforce_residency ? (
                    <article className={styles.readItem}>
                      <span>{localize(locale, { zh: "驻留要求", en: "Residency" })}</span>
                      <strong>{requirements.enforce_residency}</strong>
                    </article>
                  ) : null}
                  {requirements?.feature_requirements &&
                  Object.keys(requirements.feature_requirements).length > 0 ? (
                    <article className={styles.readItem}>
                      <span>{localize(locale, { zh: "功能要求", en: "Feature requirements" })}</span>
                      <strong>
                        {Object.entries(requirements.feature_requirements)
                          .map(([key, value]) => `${key}: ${value ? "required" : "optional"}`)
                          .join(", ")}
                      </strong>
                    </article>
                  ) : null}
                  {settings?.experimental_features.map((feature) => (
                    <article className={styles.readItem} key={feature.name}>
                      <span>{localize(locale, { zh: "实验特性", en: "Experimental" })}</span>
                      <strong>{feature.display_name ?? feature.name}</strong>
                    </article>
                  ))}
                </div>
              ) : (
                <p className={styles.empty}>
                  {localize(locale, {
                    zh: "当前没有额外约束或实验特性数据。",
                    en: "No requirements or experimental feature data is available."
                  })}
                </p>
              )}
            </div>
          </details>

          <details className={styles.disclosure}>
            <summary>
              <span className={styles.disclosureLabel}>
                <strong>{isZh ? "诊断与来源" : "Diagnostics and source"}</strong>
                <span>{isZh ? "账号、配额、MCP 和配置文件" : "Account, limits, MCP, and config file"}</span>
              </span>
              <span className={styles.disclosureHint}>{isZh ? "展开" : "Open"}</span>
            </summary>
            <div className={styles.disclosureBody}>
              {diagnosticsError ? (
                <p className={styles.empty}>{diagnosticsError}</p>
              ) : diagnostics ? (
                <div className={styles.readList}>
                  <article className={styles.readItem}>
                    <span>{localize(locale, { zh: "账号", en: "Account" })}</span>
                    <strong>
                      {diagnostics.account?.type === "chatgpt"
                        ? `${diagnostics.account.email} · ${diagnostics.account.plan_type}`
                        : diagnostics.account?.type === "apiKey"
                          ? localize(locale, { zh: "API Key", en: "API key" })
                          : localize(locale, { zh: "未登录", en: "Not connected" })}
                    </strong>
                  </article>
                  <article className={styles.readItem}>
                    <span>{localize(locale, { zh: "主配额", en: "Primary limit" })}</span>
                    <strong>
                      {diagnostics.rate_limits?.primary
                        ? `${diagnostics.rate_limits.primary.used_percent}%`
                        : localize(locale, { zh: "暂无数据", en: "No data" })}
                    </strong>
                  </article>
                  <article className={styles.readItem}>
                    <span>{localize(locale, { zh: "MCP 服务", en: "MCP servers" })}</span>
                    <strong>
                      {diagnostics.mcp_servers.length > 0
                        ? diagnostics.mcp_servers
                            .map(
                              (server) =>
                                `${server.name} (${server.auth_status}, ${server.tool_count})`
                            )
                            .join(", ")
                        : localize(locale, { zh: "暂无数据", en: "No data" })}
                    </strong>
                  </article>
                  {diagnostics.errors.account ? (
                    <article className={styles.readItem}>
                      <span>{localize(locale, { zh: "账号错误", en: "Account error" })}</span>
                      <strong>{diagnostics.errors.account}</strong>
                    </article>
                  ) : null}
                  {diagnostics.errors.rate_limits ? (
                    <article className={styles.readItem}>
                      <span>{localize(locale, { zh: "配额错误", en: "Limit error" })}</span>
                      <strong>{diagnostics.errors.rate_limits}</strong>
                    </article>
                  ) : null}
                  {diagnostics.errors.mcp_servers ? (
                    <article className={styles.readItem}>
                      <span>{localize(locale, { zh: "MCP 错误", en: "MCP error" })}</span>
                      <strong>{diagnostics.errors.mcp_servers}</strong>
                    </article>
                  ) : null}
                  <article className={styles.readItem}>
                    <span>{localize(locale, { zh: "配置文件", en: "Config file" })}</span>
                    <strong>
                      {sourceLabel} · {updatedLabel}
                    </strong>
                  </article>
                </div>
              ) : (
                <p className={styles.empty}>
                  {localize(locale, { zh: "正在读取诊断。", en: "Loading diagnostics." })}
                </p>
              )}
            </div>
          </details>
        </div>
      </div>
    </PrimaryMobileShell>
  );
}

export default SettingsScreen;
