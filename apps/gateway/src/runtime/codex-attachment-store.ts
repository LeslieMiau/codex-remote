import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { UploadedImageAttachment } from "@codex-remote/protocol";

import { ensureWithinRoot } from "../lib/path";
import { addHours, nowIso } from "../lib/time";
import { createUlid } from "../lib/ulid";

interface StoredAttachmentRecord extends UploadedImageAttachment {
  local_path: string;
}

interface CodexAttachmentStoreOptions {
  codexHome?: string;
  ttlHours?: number;
}

function sanitizeFileName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "image";
  }

  return trimmed.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
}

export class CodexAttachmentStore {
  readonly codexHome: string;
  readonly rootDir: string;
  readonly ttlHours: number;

  constructor(options: CodexAttachmentStoreOptions = {}) {
    this.codexHome =
      options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
    this.rootDir = path.join(this.codexHome, "remote-attachments");
    this.ttlHours = options.ttlHours ?? 24;
  }

  async saveImage(input: {
    threadId: string;
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<UploadedImageAttachment> {
    await this.cleanupExpired();

    const attachmentId = `attachment_${createUlid()}`;
    const uploadedAt = nowIso();
    const expiresAt = addHours(uploadedAt, this.ttlHours);
    const safeFileName = sanitizeFileName(input.fileName);
    const threadDir = ensureWithinRoot(this.rootDir, path.join(this.rootDir, input.threadId));
    const filePath = ensureWithinRoot(
      threadDir,
      path.join(threadDir, `${attachmentId}-${safeFileName}`)
    );
    const metadataPath = ensureWithinRoot(threadDir, path.join(threadDir, `${attachmentId}.json`));

    const record: StoredAttachmentRecord = {
      attachment_id: attachmentId,
      thread_id: input.threadId,
      file_name: safeFileName,
      content_type: input.contentType,
      byte_size: input.bytes.byteLength,
      uploaded_at: uploadedAt,
      expires_at: expiresAt,
      local_path: filePath
    };

    await fs.mkdir(threadDir, { recursive: true });
    await fs.writeFile(filePath, input.bytes);
    await fs.writeFile(metadataPath, JSON.stringify(record, null, 2), "utf8");

    return {
      attachment_id: record.attachment_id,
      thread_id: record.thread_id,
      file_name: record.file_name,
      content_type: record.content_type,
      byte_size: record.byte_size,
      uploaded_at: record.uploaded_at,
      expires_at: record.expires_at
    };
  }

  async resolveImageAttachment(attachmentId: string): Promise<StoredAttachmentRecord | null> {
    const metadataPath = await this.findMetadataPath(attachmentId);
    if (!metadataPath) {
      return null;
    }

    const raw = await fs.readFile(metadataPath, "utf8");
    const record = JSON.parse(raw) as StoredAttachmentRecord;
    if (Date.parse(record.expires_at) <= Date.now()) {
      await this.removeRecord(record, metadataPath);
      return null;
    }

    try {
      await fs.access(record.local_path);
    } catch {
      return null;
    }

    return record;
  }

  private async cleanupExpired() {
    try {
      const threadDirs = await fs.readdir(this.rootDir, {
        withFileTypes: true
      });

      for (const threadDir of threadDirs) {
        if (!threadDir.isDirectory()) {
          continue;
        }

        const absoluteThreadDir = path.join(this.rootDir, threadDir.name);
        const files = await fs.readdir(absoluteThreadDir);
        for (const file of files) {
          if (!file.endsWith(".json")) {
            continue;
          }

          const metadataPath = path.join(absoluteThreadDir, file);
          try {
            const raw = await fs.readFile(metadataPath, "utf8");
            const record = JSON.parse(raw) as StoredAttachmentRecord;
            if (Date.parse(record.expires_at) <= Date.now()) {
              await this.removeRecord(record, metadataPath);
            }
          } catch {
            // Ignore malformed metadata and leave it for future cleanup.
          }
        }
      }
    } catch {
      // The attachment directory may not exist yet.
    }
  }

  private async findMetadataPath(attachmentId: string) {
    try {
      const threadDirs = await fs.readdir(this.rootDir, {
        withFileTypes: true
      });
      for (const threadDir of threadDirs) {
        if (!threadDir.isDirectory()) {
          continue;
        }

        const candidate = path.join(this.rootDir, threadDir.name, `${attachmentId}.json`);
        try {
          await fs.access(candidate);
          return candidate;
        } catch {
          // Continue scanning sibling directories.
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private async removeRecord(record: StoredAttachmentRecord, metadataPath: string) {
    await Promise.allSettled([
      fs.rm(record.local_path, { force: true }),
      fs.rm(metadataPath, { force: true })
    ]);
  }
}
