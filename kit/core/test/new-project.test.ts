import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { git, gitOk } from "../src/git.ts";
import { newProject, slug } from "../src/new-project.ts";
import type { Runner } from "../src/prerequisites.ts";
import { DEFAULT_LIMITS, readConfig, findProject } from "../src/project.ts";
import { tempDir, cleanDirs } from "./git-helper.ts";

after(cleanDirs);
const ENGINES = fileURLToPath(new URL("./adapters/", import.meta.url));

// Claude Code simulé (les commandes plugin), git réel.
function fake(commands: string[]): Runner {
  return (program, args, cwd) => {
    commands.push(`${program} ${args.join(" ")}`);
    if (program === "git") {
      const r = git(cwd, args);
      return { code: r.code, stdout: r.stdout, stderr: r.stderr };
    }
    if (args[1] === "list" || (args[1] === "marketplace" && args[2] === "list")) return { code: 0, stdout: "[]", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
}

const request = (parent: string, commands: string[] = []) => ({
  name: "Morpion",
  parent,
  engine: "fake",
  version: "1.0",
  tag: "MRP",
  remote: "local",
  engines: ENGINES,
  run: fake(commands),
  log: () => {},
});

test("new project: template, engine, git (main, develop), local remote with origin/HEAD on develop, first test green", async () => {
  const parent = tempDir("jeux");
  const commands: string[] = [];
  const game = await newProject(request(parent, commands));
  const r = game.root;

  assert.equal(r, join(parent, "morpion"));
  assert.deepEqual(readConfig(join(r, "spawn.json")), { engine: "fake", version: "1.0", tag: "MRP", limits: DEFAULT_LIMITS });
  assert.match(readFileSync(join(r, "CLAUDE.md"), "utf8"), /# Morpion[\s\S]*Décider par l'objectif[\s\S]*## Analyser[\s\S]*Chercher à réfuter, pas à confirmer[\s\S]*MRP-NN[\s\S]*PowerShell 5\.1[\s\S]*Pas de `&&`[\s\S]*git commit -F/);
  assert.doesNotMatch(readFileSync(join(r, "CLAUDE.md"), "utf8"), /\{\{/, "aucun gabarit non remplacé");
  for (const f of ["context/vision.md", "knowledge/README.md", "docs/specs/.gitkeep", "fake.project", "test/test_project.fx"]) assert.ok(existsSync(join(r, f)), f);
  assert.match(readFileSync(join(r, ".gitignore"), "utf8"), /^\.spawn\/$/m);
  assert.match(readFileSync(join(r, ".gitignore"), "utf8"), /\.fake-cache\//, "motifs de l'adaptateur");

  assert.equal(gitOk(r, ["symbolic-ref", "--short", "HEAD"]), "develop");
  assert.equal(gitOk(r, ["rev-parse", "main"]), gitOk(r, ["rev-parse", "develop"]));
  assert.equal(gitOk(r, ["log", "--format=%s"]), "initial : Morpion");
  assert.equal(git(r, ["status", "--porcelain"]).stdout, "", "dépôt propre");
  assert.match(gitOk(r, ["config", "core.hooksPath"]), /git-hooks/);
  assert.ok(gitOk(r, ["ls-files"]).split(/\r?\n/).includes(".claude/settings.json"), "réglages versionnés");
  assert.match(readFileSync(join(r, ".claude", "settings.json"), "utf8"), /CLAUDE_CODE_AUTO_COMPACT_WINDOW/);

  assert.equal(game.remote, join(parent, "morpion.git"));
  assert.equal(gitOk(r, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]), "origin/develop");
  assert.equal(gitOk(game.remote, ["symbolic-ref", "HEAD"]), "refs/heads/develop");
  assert.equal(game.tests, 1);
  assert.ok(commands.some((c) => c.includes("plugin install spawnstudio@spawn-game-studio --scope project")));
  assert.ok(!commands.some((c) => c.includes("--scope user")));
  assert.equal(findProject(r)?.config.tag, "MRP");
});

test("refusals: non-empty dir, invalid prefix or version; a failure before the commit leaves nothing", async () => {
  const parent = tempDir("jeux");
  await newProject(request(parent));
  await assert.rejects(newProject(request(parent)), /existe déjà et n'est pas vide/);
  await assert.rejects(newProject({ ...request(parent), name: "Autre", tag: "mrp" }), /préfixe d'exigences invalide/);
  await assert.rejects(newProject({ ...request(parent), name: "Autre", version: "dernière" }), /version du moteur invalide/);

  const failing: Runner = (program, args, cwd) =>
    args[1] === "install" ? { code: 1, stdout: "", stderr: "marketplace injoignable" } : fake([])(program, args, cwd);
  await assert.rejects(newProject({ ...request(parent), name: "Echec", run: failing }), /installation du plugin/);
  assert.ok(!existsSync(join(parent, "echec")), "rien ne reste après un échec avant le commit");
});

test("slug of the dir name", () => {
  assert.equal(slug("Morpion"), "morpion");
  assert.equal(slug("  Le Jeu d'Été 2 "), "le-jeu-d-ete-2");
  writeFileSync(join(tempDir("x"), "y"), "");
});
