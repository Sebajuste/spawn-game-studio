// Rangement d'un fil fusionné par l'outil (tidyMerged) : worktree, branche et état, y compris après un rangement
// interrompu (essai du 18/11 : dossier vide resté, branche gardée, fil « done »).
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { tidyMerged } from "../src/cleanup.ts";
import { ledgerPath } from "../src/context.ts";
import { git, gitOk } from "../src/git.ts";
import { createWorktree } from "../src/hooks/worktree.ts";
import { write } from "../src/ledger.ts";
import { readStory, updateStory } from "../src/stories.ts";
import { cleanDirs, commit, configure, spawnProject } from "./git-helper.ts";

after(cleanDirs);
const ENGINES = fileURLToPath(new URL("./adapters/", import.meta.url));
const silence = { engines: ENGINES, log: () => {} };
const branches = (repo: string) => gitOk(repo, ["branch", "--format=%(refname:short)"]).split(/\r?\n/).filter(Boolean);

// Fil « pont » fusionné par squash dans develop, état « done », worktree encore là.
async function merged(): Promise<{ root: string; path: string }> {
  const root = spawnProject();
  const path = await createWorktree({ cwd: root, name: "pont" }, silence);
  configure(path);
  const head = commit(path, "pont.fx", "PONT\n");
  gitOk(root, ["checkout", "--quiet", "develop"]);
  gitOk(root, ["merge", "--quiet", "--squash", "feature/pont"]);
  gitOk(root, ["commit", "--quiet", "-m", `pont\n\nStory-Head: ${head}`]);
  gitOk(root, ["checkout", "--quiet", "main"]);
  updateStory(root, "pont", { status: "done" });
  return { root, path };
}

test("tidy: a merged story is closed by the tool (worktree, branch, state)", async () => {
  const { root, path } = await merged();
  assert.equal(tidyMerged(root, "pont"), false, "pas de fusion au ledger : rien n'est touché");
  assert.ok(existsSync(path));
  write(ledgerPath(root, "pont"), { date: new Date().toISOString(), type: "merged", commit: gitOk(root, ["rev-parse", "develop"]) });
  assert.equal(tidyMerged(root, "pont"), true);
  assert.ok(!existsSync(path));
  assert.ok(!branches(root).includes("feature/pont"));
  assert.deepEqual([readStory(root, "pont")?.status, readStory(root, "pont")?.worktree], ["cleaned", null]);
  assert.ok(branches(root).includes("develop"));
});

test("tidy: an interrupted cleanup (empty folder, branch kept) is finished", async () => {
  const { root, path } = await merged();
  write(ledgerPath(root, "pont"), { date: new Date().toISOString(), type: "merged", commit: gitOk(root, ["rev-parse", "develop"]) });
  gitOk(root, ["worktree", "remove", "--force", path]);
  mkdirSync(path);
  assert.equal(git(root, ["worktree", "list"]).stdout.split(/\r?\n/).length, 1);
  assert.equal(tidyMerged(root, "pont"), true);
  assert.ok(!existsSync(path));
  assert.ok(!branches(root).includes("feature/pont"));
  assert.equal(readStory(root, "pont")?.status, "cleaned");
});
