import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorktreeManager } from "./worktree-manager";

const cleanupRoots = new Set<string>();

afterEach(async () => {
  for (const root of cleanupRoots) {
    await fs.rm(root, { recursive: true, force: true });
  }
  cleanupRoots.clear();
});

async function createWorktree() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-manager-"));
  cleanupRoots.add(root);
  return root;
}

describe("WorktreeManager", () => {
  it("applies unified diffs and captures before/after snapshots for rollback", async () => {
    const worktreePath = await createWorktree();
    const manager = new WorktreeManager();
    const filePath = path.join(worktreePath, "notes", "demo.txt");

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "alpha\nbeta\n", "utf8");

    const applied = await manager.applyPatch(worktreePath, [
      {
        path: "notes/demo.txt",
        before_content: null,
        after_content: null,
        unified_diff: [
          "--- a/notes/demo.txt",
          "+++ b/notes/demo.txt",
          "@@ -1,2 +1,2 @@",
          " alpha",
          "-beta",
          "+gamma"
        ].join("\n")
      }
    ]);

    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("alpha\ngamma\n");
    expect(applied[0]).toMatchObject({
      before_content: "alpha\nbeta\n",
      after_content: "alpha\ngamma\n"
    });

    await manager.rollbackPatch(worktreePath, applied);
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("alpha\nbeta\n");
  });

  it("rejects conflicting unified diffs without mutating the file", async () => {
    const worktreePath = await createWorktree();
    const manager = new WorktreeManager();
    const filePath = path.join(worktreePath, "notes", "demo.txt");

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "alpha\ndelta\n", "utf8");

    await expect(
      manager.applyPatch(worktreePath, [
        {
          path: "notes/demo.txt",
          before_content: null,
          after_content: null,
          unified_diff: [
            "--- a/notes/demo.txt",
            "+++ b/notes/demo.txt",
            "@@ -1,2 +1,2 @@",
            " alpha",
            "-beta",
            "+gamma"
          ].join("\n")
        }
      ])
    ).rejects.toThrow("patch_apply_conflict:delete_mismatch");

    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("alpha\ndelta\n");
  });
});
