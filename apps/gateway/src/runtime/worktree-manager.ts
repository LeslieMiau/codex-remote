import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { PatchChange, ProjectSummary, ThreadSnapshot } from "@codex-remote/protocol";

import { ensureWithinRoot, slugify } from "../lib/path";

const execFileAsync = promisify(execFile);

function patchConflict(message: string) {
  return new Error(`patch_apply_conflict:${message}`);
}

function patchInvalid(message: string) {
  return new Error(`patch_apply_invalid:${message}`);
}

function splitLines(value: string) {
  return value.split("\n");
}

function applyUnifiedDiff(currentContent: string | null, unifiedDiff: string) {
  const sourceLines = splitLines(currentContent ?? "");
  const diffLines = unifiedDiff.replace(/\r\n/g, "\n").split("\n");
  const hunks = diffLines.filter((line) => line.startsWith("@@"));

  if (hunks.length === 0) {
    throw patchInvalid("missing_hunk");
  }

  const result: string[] = [];
  let sourceIndex = 0;
  let lineIndex = 0;

  while (lineIndex < diffLines.length) {
    const header = diffLines[lineIndex];
    if (!header.startsWith("@@")) {
      lineIndex += 1;
      continue;
    }

    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
    if (!match) {
      throw patchInvalid("invalid_hunk_header");
    }

    const sourceStart = Math.max(0, Number.parseInt(match[1], 10) - 1);
    if (sourceStart < sourceIndex) {
      throw patchInvalid("overlapping_hunk");
    }

    result.push(...sourceLines.slice(sourceIndex, sourceStart));
    sourceIndex = sourceStart;
    lineIndex += 1;

    while (lineIndex < diffLines.length && !diffLines[lineIndex].startsWith("@@")) {
      const diffLine = diffLines[lineIndex];

      if (
        diffLine.startsWith("--- ") ||
        diffLine.startsWith("+++ ") ||
        diffLine.startsWith("diff --git ") ||
        diffLine.startsWith("index ")
      ) {
        lineIndex += 1;
        continue;
      }
      if (diffLine === "\\ No newline at end of file") {
        lineIndex += 1;
        continue;
      }
      if (diffLine.length === 0 && lineIndex === diffLines.length - 1) {
        lineIndex += 1;
        continue;
      }

      const prefix = diffLine[0];
      const content = diffLine.slice(1);
      const currentLine = sourceLines[sourceIndex];

      if (prefix === " ") {
        if (currentLine !== content) {
          throw patchConflict("context_mismatch");
        }
        result.push(currentLine);
        sourceIndex += 1;
        lineIndex += 1;
        continue;
      }

      if (prefix === "-") {
        if (currentLine !== content) {
          throw patchConflict("delete_mismatch");
        }
        sourceIndex += 1;
        lineIndex += 1;
        continue;
      }

      if (prefix === "+") {
        result.push(content);
        lineIndex += 1;
        continue;
      }

      throw patchInvalid("unsupported_diff_line");
    }
  }

  result.push(...sourceLines.slice(sourceIndex));
  return result.join("\n");
}

function resolveNextContent(currentContent: string | null, change: PatchChange) {
  if (typeof change.unified_diff === "string" && change.unified_diff.trim().length > 0) {
    if (change.before_content !== null && currentContent !== change.before_content) {
      throw patchConflict("before_content_mismatch");
    }
    return applyUnifiedDiff(currentContent, change.unified_diff);
  }

  if (change.after_content === null) {
    if (change.before_content !== null && currentContent !== change.before_content) {
      throw patchConflict("delete_base_mismatch");
    }
    if (change.before_content === null && currentContent !== null) {
      throw patchConflict("delete_requires_base");
    }
    return null;
  }

  if (change.before_content !== null) {
    if (currentContent !== change.before_content) {
      throw patchConflict("replace_base_mismatch");
    }
  } else if (currentContent !== null && currentContent !== change.after_content) {
    throw patchConflict("unexpected_existing_file");
  }

  return change.after_content;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export class WorktreeManager {
  async ensureThreadWorktree(
    project: ProjectSummary,
    thread: ThreadSnapshot,
    baseRef?: string
  ): Promise<string> {
    const isPendingSharedCodexThread =
      thread.adapter_kind === "codex-app-server" &&
      thread.thread_id.startsWith("shared_pending_");
    const isSharedCodexThread =
      thread.adapter_kind === "codex-app-server" &&
      Boolean(thread.adapter_thread_ref) &&
      thread.adapter_thread_ref === thread.thread_id;

    if (isPendingSharedCodexThread || isSharedCodexThread) {
      return project.repo_root;
    }

    if (thread.worktree_path) {
      await fs.mkdir(thread.worktree_path, { recursive: true });
      return thread.worktree_path;
    }

    const managerRoot = path.join(project.repo_root, ".codex-remote", "worktrees");
    const worktreePath = path.join(managerRoot, slugify(thread.thread_id));
    await fs.mkdir(managerRoot, { recursive: true });

    if (await pathExists(worktreePath)) {
      return worktreePath;
    }

    const gitDir = path.join(project.repo_root, ".git");

    if (await pathExists(gitDir)) {
      try {
        await execFileAsync("git", [
          "-C",
          project.repo_root,
          "worktree",
          "add",
          "--detach",
          worktreePath,
          baseRef ?? "HEAD"
        ]);
        return worktreePath;
      } catch {
        // Fall back to a managed directory when git worktree setup is unavailable.
      }
    }

    await fs.mkdir(worktreePath, { recursive: true });
    await fs.writeFile(
      path.join(worktreePath, ".codex-remote-worktree.json"),
      JSON.stringify(
        {
          project_id: project.project_id,
          thread_id: thread.thread_id
        },
        null,
        2
      ),
      "utf8"
    );
    return worktreePath;
  }

  async applyPatch(worktreePath: string, changes: PatchChange[]): Promise<PatchChange[]> {
    const applied: PatchChange[] = [];

    for (const change of changes) {
      const absolutePath = ensureWithinRoot(
        worktreePath,
        path.join(worktreePath, change.path)
      );
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });

      let beforeContent: string | null = null;
      try {
        beforeContent = await fs.readFile(absolutePath, "utf8");
      } catch {
        beforeContent = null;
      }

      const nextContent = resolveNextContent(beforeContent, change);

      if (nextContent === null) {
        await fs.rm(absolutePath, { force: true });
      } else {
        await fs.writeFile(absolutePath, nextContent, "utf8");
      }

      applied.push({
        ...change,
        before_content: beforeContent,
        after_content: nextContent
      });
    }

    return applied;
  }

  async rollbackPatch(worktreePath: string, changes: PatchChange[]): Promise<void> {
    for (const change of changes) {
      const absolutePath = ensureWithinRoot(
        worktreePath,
        path.join(worktreePath, change.path)
      );
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });

      if (change.before_content === null) {
        await fs.rm(absolutePath, { force: true });
      } else {
        await fs.writeFile(absolutePath, change.before_content, "utf8");
      }
    }
  }

  async cleanupWorktree(worktreePath: string): Promise<void> {
    await fs.rm(worktreePath, { recursive: true, force: true });
  }
}
