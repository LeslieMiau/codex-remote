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
  attachmentCount: number;
  capabilitiesInterrupt: boolean;
  composerDisabledReason: string | null;
  composerInputDisabled: boolean;
  composerRef: MutableRefObject<HTMLTextAreaElement | null>;
  hasAttachmentCapability: boolean;
  imageInputRef: MutableRefObject<HTMLInputElement | null>;
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
  onOpenAttachmentSheet(): void;
  onOpenApprovalSheet(): void;
  onOpenNativeRequestSheet(): void;
  onOpenPatchReview(patchId: string): void;
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

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="m8 8 8 8M16 8l-8 8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function ChatComposer({
  attachmentCount,
  capabilitiesInterrupt,
  composerDisabledReason,
  composerInputDisabled,
  composerRef,
  hasAttachmentCapability,
  imageInputRef,
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
  onOpenAttachmentSheet,
  onOpenApprovalSheet,
  onOpenNativeRequestSheet,
  onOpenPatchReview,
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
  const hasAttachmentTray = selectedSkills.length > 0 || selectedImages.length > 0;

  return (
    <footer className={styles.composerShell}>
      {leadNativeRequest ? (
        <div className={styles.composerGate}>
          <div className={styles.composerGateCopy}>
            <p>{localize(locale, { zh: "补充输入", en: "Extra input" })}</p>
            <strong>
              {leadNativeRequest.title ??
                translateNativeRequestKind(locale, leadNativeRequest.kind)}
            </strong>
            <span>
              {leadNativeRequest.prompt ??
                describeNativeRequestGateBody(
                  locale,
                  leadNativeRequest.kind,
                  pendingNativeRequestCount
                )}
            </span>
          </div>
          <button className="secondary-button" onClick={onOpenNativeRequestSheet} type="button">
            {describeNativeRequestActionLabel(locale, leadNativeRequest.kind)}
          </button>
        </div>
      ) : leadApproval ? (
        <div className={styles.composerGate}>
          <div className={styles.composerGateCopy}>
            <p>{localize(locale, { zh: "请求", en: "Request" })}</p>
            <strong>{translateApprovalKind(locale, leadApproval.kind)}</strong>
            <span>
              {leadApproval.recoverable
                ? localize(locale, {
                    zh: "先处理这条批准请求，Codex 才会继续执行。",
                    en: "Handle this approval before Codex can continue."
                  })
                : localize(locale, {
                  zh: "这条批准请求已经失去原生绑定，只能回到桌面 Codex app 处理。",
                  en: "This approval lost its native binding and must be resolved from desktop Codex app."
                })}
            </span>
          </div>
          <button className="secondary-button" onClick={onOpenApprovalSheet} type="button">
            {localize(locale, { zh: "处理请求", en: "Open request" })}
          </button>
        </div>
      ) : leadPatch ? (
        <div className={styles.composerGate}>
          <div className={styles.composerGateCopy}>
            <p>{localize(locale, { zh: "变更审查", en: "Change review" })}</p>
            <strong>{localize(locale, { zh: "查看最新变更", en: "Review the latest change" })}</strong>
            <span>
              {leadPatch.files.length > 0
                ? `${leadPatch.summary} · ${leadPatch.files.map((file) => file.path).join(", ")}`
                : leadPatch.summary}
            </span>
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

      {hasAttachmentTray ? (
        <div className={styles.attachmentTray}>
          {selectedSkills.map((skill) => (
            <button
              key={skill.path}
              className={styles.attachmentPill}
              onClick={() => onToggleSelectedSkill(skill)}
              type="button"
            >
              <span className={styles.attachmentPillIcon}>#</span>
              <span>{skill.display_name ?? skill.name}</span>
              <span aria-hidden="true">
                <CloseIcon />
              </span>
            </button>
          ))}

          {selectedImages.map((image) => (
            <div
              key={image.local_id}
              className={[
                styles.attachmentCard,
                image.status === "failed" ? styles.attachmentCardError : ""
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {image.preview_url ? (
                <button
                  className={styles.attachmentPreview}
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
                <div className={styles.attachmentPreview}>
                  <div className={styles.imageMedia} />
                </div>
              )}
              <div className={styles.attachmentMeta}>
                <strong>{image.file_name ?? localize(locale, { zh: "图片", en: "Image" })}</strong>
                {image.status !== "ready" ? (
                  <span>
                    {image.status === "uploading"
                      ? localize(locale, { zh: "上传中", en: "Uploading" })
                      : image.error ??
                        localize(locale, { zh: "上传失败", en: "Upload failed" })}
                  </span>
                ) : null}
              </div>
              <button
                aria-label={localize(locale, { zh: "移除图片", en: "Remove image" })}
                className={styles.attachmentRemove}
                onClick={() => onRemoveImage(image.local_id)}
                type="button"
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.composerRow}>
        {hasAttachmentCapability ? (
          <div className={styles.composerActions}>
            <button
              className={[
                styles.attachmentTrigger,
                attachmentCount > 0 ? styles.attachmentTriggerActive : ""
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label={localize(locale, {
                zh: "打开附件菜单",
                en: "Open attachments"
              })}
              disabled={isMutating || isUploadingImages}
              onClick={onOpenAttachmentSheet}
              type="button"
            >
              <span aria-hidden="true">+</span>
              {attachmentCount > 0 ? (
                <span className={styles.attachmentTriggerBadge}>{attachmentCount}</span>
              ) : null}
            </button>
          </div>
        ) : null}

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
              zh: "发消息给 Codex",
              en: "Message Codex"
            })}
            rows={1}
            value={prompt}
          />
        </div>

        {isRunActive ? (
          <button
            aria-label={localize(locale, { zh: "停止", en: "Stop" })}
            className={[styles.actionButton, styles.actionButtonStop].join(" ")}
            disabled={isMutating || !capabilitiesInterrupt}
            onClick={onInterrupt}
            type="button"
          >
            {localize(locale, { zh: "停", en: "Stop" })}
          </button>
        ) : (
          <button
            aria-label={
              isMutating
                ? localize(locale, { zh: "发送中", en: "Sending" })
                : localize(locale, { zh: "发送", en: "Send" })
            }
            className={styles.actionButton}
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
        )}

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
