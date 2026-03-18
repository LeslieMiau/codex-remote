"use client";

import { useEffect, useState } from "react";

import { localize, useLocale } from "../lib/locale";
import { MobileSheet } from "./mobile-sheet";

interface ProjectOption {
  label: string;
  project_id: string;
  repo_root: string;
}

interface NewThreadSheetProps {
  disableDismiss?: boolean;
  error: string | null;
  isSubmitting: boolean;
  open: boolean;
  projects: ProjectOption[];
  onClose(): void;
  onSubmit(input: { prompt: string; repoRoot: string }): Promise<void> | void;
}

export function NewThreadSheet({
  disableDismiss = false,
  error,
  isSubmitting,
  open,
  projects,
  onClose,
  onSubmit
}: NewThreadSheetProps) {
  const { locale } = useLocale();
  const [prompt, setPrompt] = useState("");
  const [repoRoot, setRepoRoot] = useState(projects[0]?.repo_root ?? "");

  useEffect(() => {
    if (!open) {
      return;
    }
    setRepoRoot((current) => current || projects[0]?.repo_root || "");
  }, [open, projects]);

  const canSubmit = prompt.trim().length > 0 && repoRoot.trim().length > 0 && !isSubmitting;

  return (
    <MobileSheet
      disableDismiss={disableDismiss}
      eyebrow={localize(locale, { zh: "新聊天", en: "New chat" })}
      footer={
        <>
          <button
            className="chrome-button"
            disabled={disableDismiss}
            onClick={onClose}
            type="button"
          >
            {localize(locale, { zh: "取消", en: "Cancel" })}
          </button>
          <button
            className="chrome-button chrome-button--primary"
            disabled={!canSubmit}
            onClick={() =>
              void onSubmit({
                prompt: prompt.trim(),
                repoRoot: repoRoot.trim()
              })
            }
            type="button"
          >
            {isSubmitting
              ? localize(locale, { zh: "发起中", en: "Starting" })
              : localize(locale, { zh: "开始聊天", en: "Start chat" })}
          </button>
        </>
      }
      onClose={onClose}
      open={open}
      title={localize(locale, { zh: "发起共享聊天", en: "Start shared chat" })}
    >
      <div className="codex-page-stack">
        <label className="codex-form-field">
          <span>{localize(locale, { zh: "聊天所在工作区", en: "Chat workspace" })}</span>
          <select
            className="chrome-input"
            disabled={isSubmitting || projects.length === 0}
            onChange={(event) => setRepoRoot(event.target.value)}
            value={repoRoot}
          >
            {projects.map((project) => (
              <option key={project.project_id} value={project.repo_root}>
                {project.label}
              </option>
            ))}
          </select>
        </label>

        <label className="codex-form-field">
          <span>{localize(locale, { zh: "第一条消息", en: "First message" })}</span>
          <textarea
            className="chrome-input"
            disabled={isSubmitting}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={localize(locale, {
              zh: "像发微信或 Telegram 一样，告诉 Codex 你想开始聊什么。",
              en: "Write the first message for Codex, like starting a chat in WeChat or Telegram."
            })}
            rows={5}
            value={prompt}
          />
        </label>

        {error ? (
          <p className="codex-inline-note tone-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </MobileSheet>
  );
}
