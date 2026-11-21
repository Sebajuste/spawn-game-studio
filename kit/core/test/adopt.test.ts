import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { listAdapters } from "../src/adapters.ts";
import { adoptProject, AdoptionRefused } from "../src/adopt/adopt.ts";
import { diagnose, type Diagnosis } from "../src/adopt/diagnose.ts";
import { proposeTag } from "../src/adopt/files.ts";
import { git, gitOk } from "../src/git.ts";
import type { Runner } from "../src/prerequisites.ts";
import { ENGINES_DIR, readConfig } from "../src/project.ts";
import { readRegistry } from "../src/registry.ts";
import { createWorkspace, readWorkspaces } from "../src/workspaces.ts";
import { cleanDirs, commit, configure, tempDir } from "./git-helper.ts";

after(cleanDirs);
const ENGINES = fileURLToPath(new URL("./adapters/", import.meta.url));

// Claude Code simulé (les commandes plugin), git réel.
function fake(commands: string[] = [], failInstall = false): Runner {
  return (program, args, cwd) => {
    commands.push(`${program} ${args.join(" ")}`);
    if (program === "git") return git(cwd, args);
    if (failInstall && args[1] === "install") return { code: 1, stdout: "", stderr: "marketplace injoignable" };
    if (args[1] === "list" || (args[1] === "marketplace" && args[2] === "list")) return { code: 0, stdout: "[]", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
}

// Un projet du moteur factice : commité sur main, dépôt distant dont origin/HEAD vise main.
function existing(name = "mon-site"): string {
  const repo = join(tempDir("adopt"), name);
  mkdirSync(repo);
  gitOk(repo, ["init", "--quiet", "-b", "main"]);
  configure(repo);
  commit(repo, ".gitignore", "node_modules\n/.spawn\n", "ignorés");
  commit(repo, "fake.project", "projet\nmain=jeu.fx\n", "existant");
  const bare = join(tempDir("remote"), "site.git");
  gitOk(repo, ["init", "--quiet", "--bare", "-b", "main", bare]);
  gitOk(repo, ["remote", "add", "origin", bare]);
  gitOk(repo, ["push", "--quiet", "-u", "origin", "main"]);
  gitOk(repo, ["remote", "set-head", "origin", "main"]);
  return repo;
}

const statuses = (d: Diagnosis) => Object.fromEntries(d.points.map((p) => [p.label, p.status]));
const request = (dir: string, commands: string[] = []) => ({ dir, engine: "fake", version: "1.0", tag: "MS", engines: ENGINES, run: fake(commands), log: () => {} });

test("diagnosis: every point said, nothing written", async () => {
  const repo = existing();
  const d = await diagnose(repo, { engines: ENGINES });
  assert.equal(d.ready, true);
  assert.equal(d.engine, "fake");
  assert.equal(d.tag, "MS");
  assert.deepEqual(statuses(d), {
    "arbre de travail propre": "ok",
    "branche develop": "add",
    "origin/HEAD ne pointe pas sur develop": "warn",
    fake: "ok",
    "spawn.json": "add",
    "test/test_project.fx": "add",
    ".gitignore": "complete",
    "hooks git du kit": "add",
    "plugin spawnstudio pour ce projet": "add",
  });
  assert.deepEqual(d.gitignore, [".claude/worktrees/", ".claude/settings.local.json", ".fake-cache/"], "/.spawn couvre déjà .spawn/");
  assert.equal(git(repo, ["status", "--porcelain"]).stdout, "");
  assert.ok(!existsSync(join(repo, "spawn.json")));
});

test("diagnosis stops: not a repo, sub-folder, dirty tree, other hooks, Husky, no engine", async () => {
  const stops = async (dir: string) => (await diagnose(dir, { engines: ENGINES })).points.filter((p) => p.status === "stop").map((p) => p.label);
  const plain = tempDir("plain");
  writeFileSync(join(plain, "fake.project"), "projet\n");
  assert.deepEqual(await stops(plain), ["pas un dépôt git"]);

  const repo = existing();
  mkdirSync(join(repo, "sous"));
  writeFileSync(join(repo, "sous", "fake.project"), "projet\n");
  assert.deepEqual(await stops(join(repo, "sous")), ["pas la racine du dépôt"]);
  const dirty = await diagnose(repo, { engines: ENGINES });
  assert.equal(dirty.ready, false);
  assert.match(dirty.points.find((p) => p.label === "modifications non commitées")?.detail ?? "", /sous\/fake\.project/);

  const hooks = existing();
  gitOk(hooks, ["config", "core.hooksPath", ".githooks"]);
  assert.deepEqual(await stops(hooks), ["autres hooks git"]);
  const husky = existing();
  mkdirSync(join(husky, ".husky"));
  writeFileSync(join(husky, ".husky", "pre-commit"), "npm test\n");
  commit(husky, ".husky/pre-commit", "npm test\n");
  assert.deepEqual(await stops(husky), ["hooks Husky (.husky/)"]);

  const other = existing();
  gitOk(other, ["rm", "--quiet", "fake.project"]);
  gitOk(other, ["commit", "--quiet", "-m", "plus de moteur"]);
  assert.deepEqual(await stops(other), ["aucun moteur reconnu"]);
});

test("adoption: develop, spawn.json, engine template, .gitignore completed, hooks, plugin, one commit, baseline, registry and workspace", async () => {
  const repo = existing();
  const commands: string[] = [];
  createWorkspace("Produit", []);
  const a = await adoptProject({ ...request(repo, commands), workspace: "produit" });

  assert.equal(gitOk(repo, ["symbolic-ref", "--short", "HEAD"]), "develop");
  assert.equal(gitOk(repo, ["log", "-1", "--format=%s"]), "spawn : adoption");
  assert.equal(gitOk(repo, ["rev-parse", "main"]), gitOk(repo, ["rev-parse", "HEAD~1"]), "main n'a pas bougé");
  assert.equal(git(repo, ["ls-remote", "--heads", "origin", "develop"]).stdout, "", "rien n'est poussé");
  assert.deepEqual(readConfig(join(repo, "spawn.json")).tag, "MS");
  assert.ok(existsSync(join(repo, "test", "test_project.fx")));
  assert.equal(readFileSync(join(repo, ".gitignore"), "utf8"), "node_modules\n/.spawn\n.claude/worktrees/\n.claude/settings.local.json\n.fake-cache/\n");
  assert.match(gitOk(repo, ["config", "core.hooksPath"]), /git-hooks/);
  assert.ok(commands.some((c) => c.includes("plugin install spawnstudio@spawn-game-studio --scope project")));
  assert.ok(gitOk(repo, ["ls-files"]).split(/\r?\n/).includes(".claude/settings.json"));

  assert.deepEqual(a.baseline, { ok: true, total: 1, passed: 1, failed: 0, message: null });
  assert.deepEqual(a.leftovers, []);
  assert.equal(a.commit, gitOk(repo, ["rev-parse", "--short", "HEAD"]));
  assert.ok(readRegistry().some((p) => p.id === a.project.id));
  assert.ok(readWorkspaces().find((w) => w.id === "produit")?.projects.includes(a.project.id));

  // Déjà un projet Spawn : inscrit, rien d'autre.
  const again = await adoptProject(request(repo));
  assert.equal(again.commit, null);
  assert.equal(again.project.id, a.project.id);
  assert.equal((await diagnose(repo, { engines: ENGINES })).spawn, true);
});

test("adoption: a refused folder brings the new diagnosis; a failure before the commit leaves the repo as it was", async () => {
  const dirty = existing();
  writeFileSync(join(dirty, "brouillon.txt"), "en cours\n");
  await assert.rejects(adoptProject(request(dirty)), (e: unknown) => e instanceof AdoptionRefused && e.diagnosis.ready === false);

  const repo = existing();
  const head = gitOk(repo, ["rev-parse", "HEAD"]);
  await assert.rejects(adoptProject({ ...request(repo), run: fake([], true) }), /installation du plugin/);
  assert.equal(gitOk(repo, ["symbolic-ref", "--short", "HEAD"]), "main");
  assert.equal(gitOk(repo, ["rev-parse", "HEAD"]), head);
  assert.equal(git(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/develop"]).code, 1, "develop retirée");
  assert.equal(git(repo, ["status", "--porcelain", "--untracked-files=all"]).stdout, "");
  assert.equal(git(repo, ["config", "--get", "core.hooksPath"]).code, 1);
  await assert.rejects(adoptProject({ ...request(repo), tag: "ms" }), /préfixe d'exigences invalide/);
});

test("adoption: without Claude Code, no plugin step and no Claude settings; the adoption goes through", async () => {
  const repo = existing();
  const commands: string[] = [];
  const noClaude: Runner = (program, args, cwd) => {
    commands.push(`${program} ${args.join(" ")}`);
    if (program === "git") return git(cwd, args);
    return { code: -1, stdout: "", stderr: "spawnSync claude ENOENT" };
  };
  const a = await adoptProject({ ...request(repo), run: noClaude });
  assert.ok(a.commit);
  assert.deepEqual(commands.filter((c) => c.startsWith("claude")), ["claude --version"]);
  assert.ok(!existsSync(join(repo, ".claude", "settings.json")));
});

test("adapters listed with their title; requirement prefix proposed from the folder", () => {
  assert.deepEqual(listAdapters(ENGINES), [{ engine: "fake", title: "fake" }], "un dossier qui ne porte pas le nom de son moteur est ignoré");
  const real = listAdapters(ENGINES_DIR);
  assert.deepEqual(real.filter((a) => ["godot", "node"].includes(a.engine)), [
    { engine: "godot", title: "Godot" },
    { engine: "node", title: "Node (web, services)" },
  ]);
  assert.equal(proposeTag("C:/x/mon-site"), "MS");
  assert.equal(proposeTag("/x/morpion"), "MOR");
  assert.equal(proposeTag("/x/2048"), "P204");
  assert.equal(proposeTag("/x/é"), "PRJ");
});
