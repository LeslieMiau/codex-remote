"use client";

import * as React from "react";
import type {
  ApprovalRequest,
  CodexPatchRecord,
  NativeRequestRecord
} from "@codex-remote/protocol";
import type { ChangeEvent, KeyboardEvent, MutableRefObject } from "react";

import { type Locale, localize, translateApprovalKind } from "../lib/locale";
import type {
  PendingSendImage,
  PendingSendSkill
} from "../lib/pending-send";
import {
  describeNativeRequestActionLabel,
  describeNativeRequestGateBody
} from "../lib/native-input-copy";
import styles from "./shared-thread-workspace-refreshed.module.css";

interface ChatComposerProps {
  capabilitiesInterrupt: boolean;
  composerDisabledReason: string | null;
  composerInputDisabled: boolean;
  composerRef: MutableRefObject<HTMLTextAreaElement | null>;
  hasImageCapability: boolean;
  hasSkillCapability: boolean;
  imageInputRef: MutableRefObject<HTMLInputElement | null>;
  isLoadingSkills: boolean;
  isMutating: boolean;
  isRunActive: boolean;
  isUploadingImages: boolean;
  leadApproval: ApprovalRequest | null;
  leadNativeRequest: NativeRequestRecord | null;
  leadPatch: CodexPatchRecord | null;
  locale: Locale;
  onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void;
  onImageSelection(event: ChangeEvent<HTMLInputElement>): void;
  onInterrupt(): void;
  onOpenApprovalSheet(): void;
  onOpenNativeRequestSheet(): void;
  onOpenPatchReview(patchId: string): void;
  onOpenSkillSheet(): void;
  onPromptChange(value: string): void;
  onRemoveImage(localId: string): void;
  onRun(): void;
  onToggleSelectedSkill(skill: PendingSendSkill): void;
  onViewImage(imageUrl: string): void;
  pendingNativeRequestCount: number;
  prompt: string;
  selectedImages: PendingSendImage[];
  selectedSkills: PendingSendSkill[];
}

function translateNativeRequestKind(locale: Locale, kind: NativeRequestRecord["kind"]) {
  switch (kind) {
    case "dynamic_tool":
      return localize(locale, { zh: "动态工具", en: "Dynamic tool" });
    case "auth_refresh":
      return localize(locale, { zh: "认证刷新", en: "Auth refresh" });
    default:
      return localize(locale, { zh: "补充输入", en: "Extra input" });
  }
}

export function ChatComposer({
  capabilitiesInterrupt,
  composerDisabledReason,
  composerInputDisabled,
  composerRef,
  hasImageCapability,
  hasSkillCapability,
  imageInputRef,
  isLoadingSkills,
  isMutating,
  isRunActive,
  isUploadingImages,
  leadApproval,
  leadNativeRequest,
  leadPatch,
  locale,
  onComposerKeyDown,
  onImageSelection,
  onInterrupt,
  onOpenApprovalSheet,
  onOpenNativeRequestSheet,
  onOpenPatchReview,
  onOpenSkillSheet,
  onPromptChange,
  onRemoveImage,
  onRun,
  onToggleSelectedSkill,
  onViewImage,
  pendingNativeRequestCount,
  prompt,
  selectedImages,
  selectedSkills
}: ChatComposerProps) {
  return (
    <footer className={styles.composerShell}>
      {leadNativeRequest ? (
        <div className={styles.composerGate}>
          <div className={styles.composerGateCopy}>
            <p className="section-label">
              {localize(locale, { zh: "补充输入", en: "Extra input" })}
            </p>
            <strong>
              {leadNativeRequest.title ??
                translateNativeRequestKind(locale, leadNativeRequest.kind)}
            </strong>
            <p>
              {leadNativeRequest.prompt ??
                describeNativeRequestGateBody(
                  locale,
                  leadNativeRequest.kind,
                  pendingNativeRequestCount
                )}
            </p>
          </div>
          <button className="secondary-button" onClick={onOpenNativeRequestSheet} type="button">
            {describeNativeRequestActionLabel(locale, leadNativeRequest.kind)}
          </button>
        </div>
      ) : leadApproval ? (
        <div className={styles.composerGate}>
          <div className={styles.composerGateCopy}>
            <p className="section-label">{localize(locale, { zh: "请求", en: "Request" })}</p>
            <strong>{translateApprovalKind(locale, leadApproval.kind)}</strong>
            <p>
              {leadApproval.recoverable
                ? localize(locale, {
                    zh: "先处理这条批准请求，Codex 才会继续执行。",
                    en: "Handle this approval before Codex can continue."
                  })
                : localize(locale, {
                    zh: "这条批准请求已经失去原生绑定，只能回到桌面 Codex app 处理。",
                    en: "This approval lost its native binding and must be resolved from desktop Codex app."
                  })}
            </p>
          </div>
          <button className="secondary-button" onClick={onOpenApprovalSheet} type="button">
            {localize(locale, { zh: "处理请求", en: "Open request" })}
          </button>
        </div>
      ) : leadPatch ? (
        <div className={styles.composerGate}>
          <div className={styles.composerGateCopy}>
            <p className="section-label">
              {localize(locale, { zh: "变更审查", en: "Change review" })}
            </p>
            <strong>{localize(locale, { zh: "查看最新变更", en: "Review the latest change" })}</strong>
            <p>
              {leadPatch.files.length > 0
                ? `${leadPatch.summary} · ${leadPatch.files.map((file) => file.path).join(", ")}`
                : leadPatch.summary}
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={() => onOpenPatchReview(leadPatch.patch_id)}
            type="button"
          >
            {localize(locale, { zh: "打开变更审查", en: "Open review" })}
          </button>
        </div>
      ) : null}

      {selectedSkills.length > 0 ? (
        <div className={styles.chipRow}>
          {selectedSkills.map((skill) => (
            <button
              key={skill.path}
              className={styles.composerChip}
              onClick={() => onToggleSelectedSkill(skill)}
              type="button"
            >
              <span>{skill.display_name ?? skill.name}</span>
              <span aria-hidden="true">x</span>
            </button>
          ))}
        </div>
      ) : null}

      {selectedImages.length > 0 ? (
        <div className={styles.imageRow}>
          {selectedImages.map((image) => (
            <div
              key={image.local_id}
              className={[
                styles.imagePreview,
                image.status === "failed" ? styles.imagePreviewError : ""
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {image.preview_url ? (
                <button
                  className={styles.imageOpen}
                  onClick={() => onViewImage(image.preview_url ?? "")}
                  type="button"
                >
                  <img
                    alt={image.file_name ?? localize(locale, { zh: "图片预览", en: "Image preview" })}
                    className={styles.imageMedia}
                    src={image.preview_url}
                  />
                </button>
              ) : (
                <div className={styles.imageOpen}>
                  <div className={styles.imageMedia} />
                </div>
              )}
              <div className={styles.imageMeta}>
                <strong>{image.file_name ?? localize(locale, { zh: "图片", en: "Image" })}</strong>
                <span>
                  {image.status === "uploading"
                    ? localize(locale, { zh: "上传中", en: "Uploading" })
                    : image.status === "failed"
                      ? image.error ??
                        localize(locale, { zh: "上传失败", en: "Upload failed" })
                      : localize(locale, { zh: "已就绪", en: "Ready" })}
                </span>
              </div>
              <button
                aria-label={localize(locale, { zh: "移除图片", en: "Remove image" })}
                className={styles.imageRemove}
                onClick={() => onRemoveImage(image.local_id)}
                type="button"
              >
                x
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.composerRow}>
        <div className={styles.composerActions}>
          {hasImageCapability ? (
            <button
              className={[
                styles.composeTrigger,
                selectedImages.length > 0 ? styles.composeTriggerActive : ""
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={isMutating || isUploadingImages}
              onClick={() => imageInputRef.current?.click()}
              type="button"
            >
              <span>{localize(locale, { zh: "图片", en: "Image" })}</span>
              {selectedImages.length > 0 ? (
                <span className={styles.composeBadge}>{selectedImages.length}</span>
              ) : null}
            </button>
          ) : null}

          {hasSkillCapability ? (
            <button
              className={[
                styles.composeTrigger,
                selectedSkills.length > 0 ? styles.composeTriggerActive : ""
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={isMutating || isLoadingSkills}
              onClick={onOpenSkillSheet}
              type="button"
            >
              <span>{localize(locale, { zh: "技能", en: "Skills" })}</span>
              {selectedSkills.length > 0 ? (
                <span className={styles.composeBadge}>{selectedSkills.length}</span>
              ) : null}
            </button>
          ) : null}
        </div>

        <div className={styles.inputWrap}>
          <textarea
            ref={composerRef}
            className={styles.textarea}
            disabled={composerInputDisabled}
            enterKeyHint="send"
            id="shared-thread-prompt"
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder={localize(locale, {
              zh: "继续发消息，告诉 Codex 下一步要做什么。",
              en: "Send the next message and tell Codex what to do in this chat."
            })}
            rows={1}
            value={prompt}
          />
          <button
            aria-label={
              isMutating
                ? localize(locale, { zh: "发送中", en: "Sending" })
                : isRunActive
                  ? localize(locale, { zh: "继续", en: "Continue" })
                  : localize(locale, { zh: "发送", en: "Send" })
            }
            className={styles.sendButton}
            disabled={Boolean(composerDisabledReason) || isMutating || !prompt.trim()}
            onClick={onRun}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path
                d="M5 7v6a4 4 0 0 0 4 4h10"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
              <path
                d="M14 9l-3 4 3 4"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          </button>
        </div>

        {isRunActive ? (
          <div className={styles.stopWrap}>
            <button
              className="danger-button"
              disabled={isMutating || !capabilitiesInterrupt}
              onClick={onInterrupt}
              type="button"
            >
              {localize(locale, { zh: "停止", en: "Stop" })}
            </button>
          </div>
        ) : null}

        <input
          accept="image/*"
          hidden
          multiple
          onChange={onImageSelection}
          ref={imageInputRef}
          type="file"
        />
      </div>
    </footer>
  );
}

export default ChatComposer;
