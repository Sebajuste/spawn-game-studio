import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readStory, updateStory } from "../src/stories.ts";
import { git, gitOk } from "../src/git.ts";
import { createWorktree, removeWorktree, deleteWorktree } from "../src/hooks/worktree.ts";
import { applyCleanup, inventory } from "../src/cleanup.ts";
import { commit, configure, tempDir, cleanDirs, spawnProject } from "./git-helper.ts";

after(cleanDirs);
const ENGINES = fileURLToPath(new URL("./adapters/", import.meta.url));
const silence = { engines: ENGINES, log: () => {} };
const branches = (repo: string) => gitOk(repo, ["branch", "--format=%(refname:short)"]).split(/\r?\n/).filter(Boolean).sort();

test("creation: feature/<name> branch from develop, worktree prepared, story active", async () => {
  const root = spawnProject();
  const develop = gitOk(root, ["rev-parse", "develop"]);
  const path = await createWorktree({ cwd: root, name: "Caserne Cibles" }, silence);
  assert.equal(path, join(root, ".claude", "worktrees", "caserne-cibles"));
  assert.equal(gitOk(path, ["rev-parse", "HEAD"]), develop, "base = develop, pas main");
  assert.equal(gitOk(path, ["symbolic-ref", "--short", "HEAD"]), "feature/caserne-cibles");
  assert.ok(existsSync(join(path, ".fake-cache")), "prepare-worktree de l'adaptateur a tourné");
  const story = readStory(root, "caserne-cibles");
  assert.equal(story?.status, "active");
  assert.equal(story?.base, develop);
  assert.equal(story?.worktree, ".claude/worktrees/caserne-cibles");
  assert.equal(await createWorktree({ cwd: root, name: "caserne-cibles" }, silence), path, "idempotent");
});

test("creation: based on origin/develop when the remote is ahead", async () => {
  const root = spawnProject();
  const bare = tempDir("remote");
  gitOk(bare, ["init", "--quiet", "--bare"]);
  gitOk(root, ["remote", "add", "origin", bare]);
  gitOk(root, ["push", "--quiet", "origin", "main", "develop"]);
  const other = tempDir("autre-clone");
  gitOk(other, ["clone", "--quiet", "-b", "develop", bare, "."]);
  configure(other);
  const ahead = commit(other, "autre.fx", "AUTRE\n");
  gitOk(other, ["push", "--quiet", "origin", "develop"]);

  const path = await createWorktree({ cwd: root, name: "vol" }, silence);
  assert.equal(gitOk(path, ["rev-parse", "HEAD"]), ahead, "le develop local en retard ne sert pas de base");
});

test("creation refused by the adapter: neither worktree nor branch remain", async () => {
  const root = spawnProject("refus");
  const engines = tempDir("engines");
  mkdirSync(join(engines, "refus"));
  writeFileSync(join(engines, "refus", "adapter.json"), JSON.stringify({ contract: 1, engine: "refus", command: ["node", "refus.mjs"] }));
  const result = { contract: 1, engine: "refus", command: "prepare-worktree", ok: false, errors: [{ code: "import-incomplete", message: "import impossible" }], warnings: [], artifacts: [], log: null, duration_ms: 1, data: {} };
  writeFileSync(join(engines, "refus", "refus.mjs"), `process.stdout.write(${JSON.stringify(JSON.stringify(result))}); process.exitCode = 1;`);

  await assert.rejects(createWorktree({ cwd: root, name: "mer" }, { engines, log: () => {} }), /import-incomplete/);
  assert.ok(!existsSync(join(root, ".claude", "worktrees", "mer")));
  assert.deepEqual(branches(root), ["develop", "main"]);
  assert.equal(readStory(root, "mer"), null);
});

test("outside a Spawn project: Claude Code default behaviour, without story or adapter", async () => {
  const repo = tempDir("ordinaire");
  gitOk(repo, ["init", "--quiet", "-b", "main"]);
  configure(repo);
  commit(repo, "a.txt", "a\n");
  const path = await createWorktree({ cwd: repo, name: "essai" }, silence);
  assert.equal(gitOk(path, ["symbolic-ref", "--short", "HEAD"]), "worktree-essai");
  assert.ok(!existsSync(join(repo, ".spawn")));
});

test("removal: uncommitted work protected, unmerged branch kept", async () => {
  const root = spawnProject();
  const path = await createWorktree({ cwd: root, name: "terrain" }, silence);
  writeFileSync(join(path, "brouillon.fx"), "EN COURS\n");
  assert.throws(() => deleteWorktree({ cwd: root, worktree_path: path }, silence), /non commitées/);
  assert.ok(existsSync(path), "le worktree sale reste");

  configure(path);
  gitOk(path, ["add", "brouillon.fx"]);
  gitOk(path, ["commit", "--quiet", "-m", "brouillon"]);
  deleteWorktree({ cwd: root, worktree_path: path }, silence);
  assert.ok(!existsSync(path));
  assert.ok(branches(root).includes("feature/terrain"), "le travail non fusionné garde sa branche");
  assert.equal(readStory(root, "terrain")?.worktree, null);
  assert.equal(readStory(root, "terrain")?.status, "active");
});

test("removal after merge (fast-forward or Story-Head squash): branch deleted, story cleaned", async () => {
  for (const mode of ["avance-rapide", "squash"] as const) {
    const root = spawnProject();
    const path = await createWorktree({ cwd: root, name: "pont" }, silence);
    configure(path);
    const head = commit(path, "pont.fx", "PONT\n");
    gitOk(root, ["checkout", "--quiet", "develop"]);
    if (mode === "avance-rapide") gitOk(root, ["merge", "--quiet", "--ff-only", "feature/pont"]);
    else {
      gitOk(root, ["merge", "--quiet", "--squash", "feature/pont"]);
      gitOk(root, ["commit", "--quiet", "-m", `pont\n\nStory-Head: ${head}`]);
    }
    gitOk(root, ["checkout", "--quiet", "main"]);
    updateStory(root, "pont", { status: "done" });

    deleteWorktree({ cwd: root, worktree_path: path }, silence);
    assert.ok(!branches(root).includes("feature/pont"), `${mode} : branche supprimée`);
    assert.equal(readStory(root, "pont")?.status, "cleaned", `${mode} : fil nettoyé`);
    assert.equal(git(root, ["worktree", "list"]).stdout.split(/\r?\n/).length, 1);
  }
});

test("removal after merge with the worktree switched to develop: develop kept, story branch deleted, story cleaned", async () => {
  const root = spawnProject();
  const path = await createWorktree({ cwd: root, name: "gue" }, silence);
  configure(path);
  const head = commit(path, "gue.fx", "GUE\n");
  gitOk(root, ["checkout", "--quiet", "develop"]);
  gitOk(root, ["merge", "--quiet", "--squash", "feature/gue"]);
  gitOk(root, ["commit", "--quiet", "-m", `gue\n\nStory-Head: ${head}`]);
  gitOk(root, ["checkout", "--quiet", "main"]);
  // Protection gardée même si la cause réelle était un dossier oublié par git (test suivant) : un tronc ne part jamais.
  gitOk(path, ["switch", "--quiet", "develop"]);
  updateStory(root, "gue", { status: "done" });

  deleteWorktree({ cwd: root, worktree_path: path }, silence);
  assert.ok(branches(root).includes("develop"), "develop jamais supprimée");
  assert.ok(!branches(root).includes("feature/gue"), "la branche du fil est supprimée");
  assert.equal(readStory(root, "gue")?.status, "cleaned");
});

test("removing a worktree containing « nul » (Windows reserved name, left by an agent redirection)", { skip: process.platform !== "win32" }, async () => {
  const root = spawnProject();
  const wt = await createWorktree({ cwd: root, name: "piege" }, { engines: fileURLToPath(new URL("./adapters/", import.meta.url)), log: () => {} });
  // Le préfixe \?\ contourne les noms réservés : c'est ainsi qu'un tel fichier existe sur le disque.
  writeFileSync("\\\\?\\" + join(wt, "nul"), "x");
  assert.notEqual(git(root, ["worktree", "remove", "--force", wt]).code, 0, "git seul échoue");
  removeWorktree(root, wt);
  assert.ok(!existsSync(wt));
  assert.doesNotMatch(gitOk(root, ["worktree", "list"]), /worktrees.piege/);
});

// Essais 2 et 3 : le rangement depuis le worktree échoue à moitié, git oublie le worktree mais le dossier vide reste.
// Dans ce dossier, git répond pour le dépôt principal (sur develop) : ce n'était pas une bascule du worktree.
test("leftover folder forgotten by git: not read as develop; an empty one is tidied, a non-empty one is kept", async () => {
  const root = spawnProject();
  const path = await createWorktree({ cwd: root, name: "gue" }, silence);
  configure(path);
  const head = commit(path, "gue.fx", "GUE\n");
  gitOk(root, ["checkout", "--quiet", "develop"]);
  gitOk(root, ["merge", "--quiet", "--squash", "feature/gue"]);
  gitOk(root, ["commit", "--quiet", "-m", `gue\n\nStory-Head: ${head}`]);
  updateStory(root, "gue", { status: "done" });
  gitOk(root, ["worktree", "remove", "--force", path]);
  mkdirSync(path);

  const { candidates } = inventory(root);
  assert.deepEqual(candidates.map((c) => [c.name, c.branch, c.reason]), [["gue", null, "dossier vide laissé par un rangement interrompu"]]);
  applyCleanup(root, candidates);
  assert.ok(!existsSync(path));
  assert.ok(branches(root).includes("develop"));
  assert.ok(!branches(root).includes("feature/gue"));
  assert.equal(readStory(root, "gue")?.status, "cleaned");

  // Non vide : on ne sait pas ce qu'il contient, rien n'est supprimé.
  const other = join(root, ".claude", "worktrees", "autre");
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, "note.txt"), "à garder");
  assert.deepEqual(inventory(root).kept.map((k) => k.reason), ["pas un worktree git (à examiner à la main)"]);
  assert.throws(() => deleteWorktree({ cwd: root, worktree_path: other }, silence), /n'est pas un worktree git/);
  assert.ok(existsSync(join(other, "note.txt")));
});
