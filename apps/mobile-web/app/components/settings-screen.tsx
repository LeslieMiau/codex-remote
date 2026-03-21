"use client";

import { useEffect, useRef, useState } from "react";

import {
  getCachedSharedSettings,
  setCachedSharedSettings
} from "../lib/client-cache";
import {
  getCodexSharedSettings,
  updateCodexSharedSettings
} from "../lib/gateway-client";
import { formatDateTime, localize, useLocale } from "../lib/locale";
import { CodexShell } from "./codex-shell";

function describeSaveError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function SettingsScreen() {
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const [settings, setSettings] = useState(() => getCachedSharedSettings());
  const [draftModel, setDraftModel] = useState(() => getCachedSharedSettings()?.model ?? "");
  const [draftReasoning, setDraftReasoning] = useState(
    () => getCachedSharedSettings()?.model_reasoning_effort ?? ""
  );
  const [error, setError] = useState<string | null>(null);
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
      const nextSettings = await getCodexSharedSettings();
      setSettings(nextSettings);
      setCachedSharedSettings(nextSettings);
      syncDrafts(nextSettings);
      setError(null);
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

  return (
    <CodexShell
      eyebrow={isZh ? "设置" : "Settings"}
      subtitle={
        isZh
          ? "这里可以查看并调整共享 Codex 的模型与推理配置。"
          : "Review and adjust the shared Codex model and reasoning configuration here."
      }
      title={isZh ? "共享配置" : "Shared configuration"}
      actions={
        <div className="codex-header-cues">
          {isRefreshing ? (
            <span className="status-dot">
              {localize(locale, { zh: "同步中", en: "Syncing" })}
            </span>
          ) : null}
          <button
            className="secondary-button"
            disabled={isLoading || isRefreshing || isSaving}
            onClick={() => void loadSettings(true)}
            type="button"
          >
            {localize(locale, { zh: "刷新", en: "Refresh" })}
          </button>
        </div>
      }
    >
      <div className="codex-page-stack settings-home">
        {toastMessage ? (
          <div aria-live="polite" className="codex-toast" role="status">
            {toastMessage}
          </div>
        ) : null}

        {error ? (
          <section
            aria-live="assertive"
            className="codex-status-strip codex-status-strip--stacked tone-danger"
            role="alert"
          >
            <div className="codex-status-strip__copy">
              <p className="section-label">
                {localize(locale, { zh: "读取失败", en: "Read failed" })}
              </p>
              <strong>
                {localize(locale, {
                  zh: "暂时无法读取或更新共享配置",
                  en: "Unable to load or update shared configuration right now"
                })}
              </strong>
              <p>{error}</p>
            </div>
          </section>
        ) : null}

        <section className="codex-status-strip">
          <div className="codex-status-strip__copy">
            <p className="section-label">{isZh ? "当前模型" : "Current model"}</p>
            <strong>{settings?.model ?? (isZh ? "未设置" : "Not set")}</strong>
            <p>
              {settings?.model_reasoning_effort
                ? localize(locale, {
                    zh: `推理强度：${settings.model_reasoning_effort}`,
                    en: `Reasoning effort: ${settings.model_reasoning_effort}`
                  })
                : localize(locale, {
                    zh: "当前没有显式推理强度配置。",
                    en: "No explicit reasoning effort is configured."
                  })}
            </p>
          </div>
          <div className="codex-header-cues">
            <span className="state-pill">
              {settings?.read_only
                ? localize(locale, { zh: "只读", en: "Read only" })
                : localize(locale, { zh: "可编辑", en: "Editable" })}
            </span>
          </div>
        </section>

        <section className="codex-page-section settings-home__group">
          <div className="settings-home__group-head">
            <div>
              <p className="section-label">{isZh ? "编辑" : "Edit"}</p>
              <h2>{isZh ? "共享模型配置" : "Shared model configuration"}</h2>
            </div>
          </div>

          <div className="settings-home__note">
            <strong>
              {settings?.read_only
                ? localize(locale, {
                    zh: "当前环境只能读取共享配置。",
                    en: "This host can read shared configuration but cannot edit it."
                  })
                : localize(locale, {
                    zh: "这里的保存会直接更新共享 Codex 配置。",
                    en: "Saving here updates the shared Codex configuration directly."
                  })}
            </strong>
            <p>
              {settings?.read_only
                ? localize(locale, {
                    zh: "如果要在手机端修改模型，需要让这台机器上的共享 config.toml 可写。",
                    en: "To edit from mobile, the shared config.toml on this host needs write access."
                  })
                : localize(locale, {
                    zh: "新的模型和推理设置会在后续共享线程中生效。",
                    en: "New model and reasoning settings apply to subsequent shared thread runs."
                  })}
            </p>
          </div>

          {isLoading && !settings ? (
            <div className="codex-empty-state">
              <strong>{isZh ? "正在读取配置" : "Loading settings"}</strong>
            </div>
          ) : (
            <>
              <div className="settings-home__field-grid">
                <label className="codex-form-field settings-home__field">
                  <span>{localize(locale, { zh: "模型", en: "Model" })}</span>
                  <select
                    className="chrome-input"
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

                <label className="codex-form-field settings-home__field">
                  <span>{localize(locale, { zh: "推理", en: "Reasoning" })}</span>
                  <select
                    className="chrome-input"
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
                        {localize(locale, {
                          zh: "模型默认",
                          en: "Model default"
                        })}
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

              <div className="settings-home__save-bar">
                <p className="settings-home__save-note">
                  {selectedModel?.description ??
                    (reasoningLevels.length > 0
                      ? localize(locale, {
                          zh: `可用推理强度：${reasoningLevels.map((level) => level.effort).join(", ")}`,
                          en: `Available reasoning levels: ${reasoningLevels
                            .map((level) => level.effort)
                            .join(", ")}`
                        })
                      : localize(locale, {
                          zh: "当前模型没有单独暴露可选推理强度。",
                          en: "This model does not expose separate reasoning levels."
                        }))}
                </p>
                <div className="feed-actions">
                  <button
                    className="secondary-button"
                    disabled={isSaving || isLoading || !hasChanges}
                    onClick={() => syncDrafts(settings)}
                    type="button"
                  >
                    {localize(locale, { zh: "还原", en: "Reset" })}
                  </button>
                  <button
                    className="primary-button"
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

        <section className="codex-page-section">
          <div className="codex-page-section__header">
            <div>
              <p className="section-label">{isZh ? "可用模型" : "Available models"}</p>
              <h2>{isZh ? "共享模型列表" : "Shared model list"}</h2>
            </div>
          </div>

          {settings?.available_models.length ? (
            <div className="codex-card-stack">
              {settings.available_models.map((model) => (
                <article className="codex-thread-card" key={model.slug}>
                  <div className="codex-thread-card__header">
                    <div>
                      <h3>{model.display_name}</h3>
                      <p>{model.slug}</p>
                    </div>
                    {settings.model === model.slug ? (
                      <span className="state-pill">
                        {localize(locale, { zh: "当前", en: "Active" })}
                      </span>
                    ) : null}
                  </div>
                  {model.description ? <p>{model.description}</p> : null}
                  <div className="codex-thread-card__meta">
                    <span>
                      {localize(locale, { zh: "默认推理", en: "Default reasoning" })}:{" "}
                      {model.default_reasoning_effort ?? "-"}
                    </span>
                    <span>
                      {localize(locale, { zh: "层级数", en: "Levels" })}:{" "}
                      {model.reasoning_levels.length}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="codex-empty-state">
              <strong>
                {localize(locale, {
                  zh: "当前没有可展示的模型缓存",
                  en: "No shared model cache is available right now"
                })}
              </strong>
            </div>
          )}
        </section>

        <section className="codex-page-section">
          <div className="codex-page-section__header">
            <div>
              <p className="section-label">{isZh ? "实验特性" : "Experimental features"}</p>
              <h2>{isZh ? "当前特性开关" : "Current feature flags"}</h2>
            </div>
          </div>

          {settings?.experimental_features.length ? (
            <div className="settings-home__read-list">
              {settings.experimental_features.map((feature) => (
                <article className="settings-home__read-item" key={feature.name}>
                  <span>{feature.name}</span>
                  <strong>{feature.display_name ?? feature.name}</strong>
                </article>
              ))}
            </div>
          ) : (
            <div className="codex-empty-state">
              <strong>
                {localize(locale, {
                  zh: "当前没有实验特性数据",
                  en: "No experimental feature data is available"
                })}
              </strong>
            </div>
          )}
        </section>

        <section className="codex-page-section">
          <div className="codex-page-section__header">
            <div>
              <p className="section-label">{isZh ? "来源" : "Source"}</p>
              <h2>{isZh ? "配置文件" : "Configuration file"}</h2>
            </div>
          </div>
          <article className="codex-thread-card">
            <div className="codex-thread-card__meta">
              <span>{settings?.source ?? "-"}</span>
              <span>
                {settings?.updated_at
                  ? formatDateTime(locale, settings.updated_at)
                  : localize(locale, { zh: "未知时间", en: "Unknown time" })}
              </span>
            </div>
          </article>
        </section>
      </div>
    </CodexShell>
  );
}

export default SettingsScreen;
