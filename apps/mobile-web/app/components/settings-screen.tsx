"use client";

import { useEffect, useRef, useState } from "react";

import { getCachedSharedSettings, setCachedSharedSettings } from "../lib/client-cache";
import { getCodexSharedSettings } from "../lib/gateway-client";
import { formatDateTime, localize, useLocale } from "../lib/locale";
import { CodexShell } from "./codex-shell";

export function SettingsScreen() {
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const [settings, setSettings] = useState(() => getCachedSharedSettings());
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!getCachedSharedSettings());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const load = async (background = false) => {
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
        if (!cancelled) {
          setSettings(nextSettings);
          setCachedSharedSettings(nextSettings);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        inFlightRef.current = false;
        if (!cancelled) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <CodexShell
      eyebrow={isZh ? "设置" : "Settings"}
      subtitle={
        isZh
          ? "这里展示共享 Codex 配置和当前模型。"
          : "Shared Codex configuration and the active model live here."
      }
      title={isZh ? "共享配置" : "Shared configuration"}
      actions={
        <div className="codex-header-cues">
          {isRefreshing ? (
            <span className="status-dot">
              {localize(locale, { zh: "同步中", en: "Syncing" })}
            </span>
          ) : null}
        </div>
      }
    >
      <div className="codex-page-stack">
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
                  zh: "暂时无法读取共享配置",
                  en: "Unable to load shared configuration right now"
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
                : localize(locale, { zh: "可读取", en: "Readable" })}
            </span>
          </div>
        </section>

        <section className="codex-page-section">
          <div className="codex-page-section__header">
            <div>
              <p className="section-label">{isZh ? "可用模型" : "Available models"}</p>
              <h2>{isZh ? "共享模型列表" : "Shared model list"}</h2>
            </div>
          </div>

          {isLoading && !settings ? (
            <div className="codex-empty-state">
              <strong>{isZh ? "正在读取配置" : "Loading settings"}</strong>
            </div>
          ) : settings?.available_models.length ? (
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
              <p>
                {localize(locale, {
                  zh: "如果桌面 Codex app 还没有同步模型列表，这里会暂时为空。",
                  en: "This stays empty until the desktop Codex app syncs the model list."
                })}
              </p>
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
