import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { PatchChange, ProjectSummary, ThreadSnapshot } from "@codex-remote/protocol";

import { ensureWithinRoot, slugify } from "../lib/path";

const execFileAsync = promisify(execFile);

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

      if (change.after_content === null) {
        await fs.rm(absolutePath, { force: true });
      } else {
        await fs.writeFile(absolutePath, change.after_content, "utf8");
      }

      applied.push({
        ...change,
        before_content: beforeContent
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
