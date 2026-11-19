import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { gitOk } from "../src/git.ts";
import { projectAdapter, DEFAULT_LIMITS, readConfig, findProject } from "../src/project.ts";
import { tempDir, cleanDirs, spawnProject } from "./git-helper.ts";

after(cleanDirs);
function projectOf(dir: string) {
  const p = findProject(dir);
  assert.ok(p, `${dir} devrait être un projet Spawn`);
  return p;
}
const samePath = (a: string, b: string) => assert.equal(resolve(a).toLowerCase(), resolve(b).toLowerCase());

test("spawn.json: valid values and reasoned refusals", () => {
  const d = tempDir("config");
  const write = (content: string) => {
    writeFileSync(join(d, "spawn.json"), content);
    return join(d, "spawn.json");
  };
  assert.deepEqual(readConfig(write('{"engine":"godot","version":"4.7.2"}')), { engine: "godot", version: "4.7.2", limits: DEFAULT_LIMITS });
  assert.throws(() => readConfig(write("{")), /illisible/);
  assert.throws(() => readConfig(write("[]")), /objet JSON/);
  assert.throws(() => readConfig(write('{"version":"4.7.2"}')), /engine/);
  assert.throws(() => readConfig(write('{"engine":"Godot 4","version":"4.7.2"}')), /engine/);
  assert.throws(() => readConfig(write('{"engine":"godot","version":"latest"}')), /version/);
});

test("project found from a subdir and from a worktree: root = main checkout", () => {
  const root = spawnProject("godot");
  mkdirSync(join(root, "a", "b"), { recursive: true });
  samePath(findProject(join(root, "a", "b"))?.root ?? "", root);
  const wt = join(root, ".claude", "worktrees", "x");
  gitOk(root, ["worktree", "add", "-b", "feature/x", wt, "develop"]);
  samePath(findProject(wt)?.root ?? "", root);
  assert.equal(findProject(wt)?.config.engine, "godot");
  assert.equal(projectAdapter(projectOf(root)).descriptor.engine, "godot");
});

test("outside a Spawn project: nothing (the kit does not act)", () => {
  const bare = tempDir("sans-spawn");
  assert.equal(findProject(bare), null, "dossier hors dépôt");
  gitOk(bare, ["init", "--quiet"]);
  assert.equal(findProject(bare), null, "dépôt sans spawn.json");
  assert.equal(findProject(join(bare, "absent")), null, "dossier inexistant");
});

test("engine without adapter: named error", () => {
  const root = spawnProject("moteur-inconnu");
  assert.throws(() => projectAdapter(projectOf(root)), /aucun adaptateur pour le moteur « moteur-inconnu »/);
});
