// Sous-commandes de l'adaptateur Node sur de petits projets sans dépendance externe (node et npm du PATH).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { isAlive, killTree } from "../src/process.ts";
import { cleanEnv, invoke } from "./invoke.ts";

const temp = mkdtempSync(join(tmpdir(), "spawn-node-cli-"));
after(() => rmSync(temp, { recursive: true, force: true, maxRetries: 5 }));
let counter = 0;
const dir = (name: string) => join(temp, `${name}-${counter++}`);

function example(scenario: string): string {
  const project = dir(scenario);
  const { result } = invoke(["example", "--project", project, "--scenario", scenario]);
  assert.ok(result.ok, JSON.stringify(result));
  return project;
}

function project(spawn: object | null, scripts: Record<string, string> = {}, extra: object = {}): string {
  const p = dir("project");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "package.json"), JSON.stringify({ name: "p", version: "1.0.0", private: true, scripts, ...extra }));
  if (spawn !== null) writeFileSync(join(p, "spawn.json"), JSON.stringify(spawn));
  return p;
}

const major = process.versions.node.split(".")[0] ?? "";

test("adapter.json: contract 1, engine node, app domain, scene checks not applicable", () => {
  const d = JSON.parse(readFileSync(new URL("../adapter.json", import.meta.url), "utf8")) as Record<string, unknown>;
  assert.equal(d.contract, 1);
  assert.equal(d.engine, "node");
  assert.deepEqual(d.domain, {
    product: "app",
    entry: "point d'entrée de l'app",
    user: "utilisateur",
    framing: "tout se fait avec la pile que déclarent package.json et les conventions du projet (langage, bibliothèques, outils) ; n'en introduis pas d'autre",
  });
  assert.deepEqual(d.not_applicable, ["invalid-scene", "empty-main-scene"]);
});

test("new-project: a starter that passes compile, test, smoke-test, and refuses an existing project", () => {
  const p = dir("starter");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "spawn.json"), JSON.stringify({ engine: "node", version: major, tag: "ST" }));
  const created = invoke(["new-project", "--project", p, "--name", "Mon App"]);
  assert.ok(created.result.ok, JSON.stringify(created.result));
  assert.ok((created.result.data.files as string[]).includes("package.json"));
  const config = JSON.parse(readFileSync(join(p, "spawn.json"), "utf8")) as { tag: string; node: { launch: string } };
  assert.equal(config.tag, "ST");
  assert.equal(config.node.launch, "start");
  for (const sub of ["compile", "test", "smoke-test"]) {
    const r = invoke([sub, "--project", p]);
    assert.ok(r.result.ok, `${sub} : ${JSON.stringify(r.result)}`);
  }
  assert.ok(((invoke(["test", "--project", p]).result.data.end_to_end as string[]) ?? []).length > 0);
  assert.equal(invoke(["new-project", "--project", p, "--name", "Autre"]).result.errors[0]?.code, "project-exists");

  // Sans lancement déclaré, la capture répond not-declared : le cœur y reconnaît un projet sans rien à montrer.
  const config2 = JSON.parse(readFileSync(join(p, "spawn.json"), "utf8")) as { node: Record<string, unknown> };
  delete config2.node.launch;
  writeFileSync(join(p, "spawn.json"), JSON.stringify(config2));
  const shot = invoke(["capture", "--project", p, "--output", join(p, "x.png")]);
  assert.equal(shot.result.errors[0]?.code, "not-declared");
});

test("usage: unknown subcommand, missing option, relative path, scene scenario", () => {
  for (const args of [["unknown"], [], ["compile"], ["compile", "--project", "relative"], ["example", "--project", dir("e"), "--scenario", "invalid-scene"]]) {
    const { code, result } = invoke(args);
    assert.equal(code, 2, args.join(" "));
    assert.equal(result.errors[0]?.code, "usage", args.join(" "));
  }
});

test("file-types and git-patterns cover the stack", () => {
  const types = invoke(["file-types"]).result.data.types as { extension: string; category: string }[];
  const byExt = new Map(types.map((t) => [t.extension, t.category]));
  for (const ext of [".ts", ".tsx", ".rs", ".css", ".json", ".md", ".png", ".svg"]) assert.ok(byExt.has(ext), ext);
  assert.equal(byExt.get(".ts"), "code");
  const g = invoke(["git-patterns"]).result.data as { gitignore: string[]; lfs: string[] };
  for (const p of ["node_modules/", "dist/", "target/"]) assert.ok(g.gitignore.includes(p), p);
  assert.deepEqual(g.lfs, []);
});

test("undeclared command: the failure says what to add to spawn.json", () => {
  const p = project({ engine: "node", version: major, node: {} }, { test: "node --test" });
  for (const [command, key] of [["compile", '"compile"'], ["test", '"test"'], ["launch", '"launch"']] as const) {
    const { result } = invoke([command, "--project", p]);
    assert.equal(result.errors[0]?.code, "not-declared", command);
    assert.match(result.errors[0]?.message ?? "", /spawn\.json, section "node"/);
    assert.ok(result.errors[0]?.message.includes(key), command);
    assert.equal(result.log, null);
  }
  const smoke = invoke(["smoke-test", "--project", p]).result;
  assert.equal(smoke.errors[0]?.code, "main-scene-missing");
  assert.match(smoke.errors[0]?.message ?? "", /"smoke_test"/);
});

test("declared script absent from package.json, missing or invalid spawn.json", () => {
  const missing = invoke(["test", "--project", project({ engine: "node", version: major, node: { test: "nope" } })]).result;
  assert.equal(missing.errors[0]?.code, "script-missing");
  assert.equal(missing.errors[0]?.file, "package.json");
  assert.equal(invoke(["test", "--project", project(null)]).result.errors[0]?.code, "spawn-json-missing");
  assert.equal(invoke(["test", "--project", project({ engine: "node", node: { tests: "x" } })]).result.errors[0]?.code, "spawn-json-invalid");
  assert.equal(invoke(["test", "--project", project({ engine: "godot" })]).result.errors[0]?.code, "engine-mismatch");
  assert.equal(invoke(["launch", "--project", dir("empty")]).result.errors[0]?.code, "project-not-found");
});

test("prerequisites: Node and npm found, version compared, dependencies checked", () => {
  const ok = invoke(["prerequisites", "--project", example("healthy")]).result;
  assert.ok(ok.ok, JSON.stringify(ok));
  const data = ok.data as { version: string; expected_version: string; tools: { name: string; present: boolean }[] };
  assert.equal(data.version, process.versions.node);
  assert.equal(data.expected_version, major);
  assert.ok(data.tools.find((t) => t.name === "npm")?.present);

  const old = invoke(["prerequisites", "--project", project({ engine: "node", version: "1" })]).result;
  assert.equal(old.errors[0]?.code, "version-mismatch");

  const p = project({ engine: "node", version: major }, {}, { dependencies: { left: "1.0.0" } });
  writeFileSync(join(p, "package-lock.json"), "{}");
  const deps = invoke(["prerequisites", "--project", p]).result;
  assert.equal(deps.errors[0]?.code, "dependencies-missing");
  assert.match(deps.errors[0]?.message ?? "", /« npm ci »/);
});

// Dépendance locale (`file:`) : npm l'installe sans réseau.
function projectWithLocalDependency(): string {
  const p = project({ engine: "node", version: major }, {}, { dependencies: { local: "file:./local" } });
  mkdirSync(join(p, "local"));
  writeFileSync(join(p, "local", "package.json"), JSON.stringify({ name: "local", version: "1.0.0" }));
  const r = spawnSync("npm install --no-audit --no-fund --offline", { cwd: p, shell: true, encoding: "utf8", env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  return p;
}

test("prepare-worktree: same package-lock shares the source's node_modules, idempotent; otherwise npm ci", () => {
  const source = projectWithLocalDependency();
  const worktree = dir("worktree");
  mkdirSync(worktree);
  for (const f of ["package.json", "package-lock.json", "spawn.json"]) writeFileSync(join(worktree, f), readFileSync(join(source, f)));
  mkdirSync(join(worktree, "local"));
  writeFileSync(join(worktree, "local", "package.json"), readFileSync(join(source, "local", "package.json")));

  const shared = invoke(["prepare-worktree", "--project", worktree, "--source", source]).result;
  assert.deepEqual(shared.data, { cache: "shared" }, JSON.stringify(shared));
  assert.ok(lstatSync(join(worktree, "node_modules")).isSymbolicLink());
  assert.ok(existsSync(join(worktree, "node_modules", "local", "package.json")));
  assert.deepEqual(invoke(["prepare-worktree", "--project", worktree, "--source", source]).result.data, { cache: "shared" });
  // Le lien se retire sans toucher aux dépendances de la source.
  rmSync(join(worktree, "node_modules"), { recursive: true, force: true });
  assert.ok(existsSync(join(source, "node_modules", "local", "package.json")));

  writeFileSync(join(worktree, "package-lock.json"), readFileSync(join(source, "package-lock.json"), "utf8").replace('"name": "p"', '"name": "p "'));
  const installed = invoke(["prepare-worktree", "--project", worktree, "--source", source]).result;
  assert.ok(installed.ok, JSON.stringify(installed));
  assert.deepEqual(installed.data, { cache: "none" });
  assert.ok(!lstatSync(join(worktree, "node_modules")).isSymbolicLink());
  assert.ok(existsSync(join(worktree, "node_modules", "local")));
});

test("compile and test on the example scenarios", () => {
  const healthy = example("healthy");
  const compiled = invoke(["compile", "--project", healthy]).result;
  assert.ok(compiled.ok, JSON.stringify(compiled));
  assert.ok((compiled.data.files_checked as number) >= 5);
  const tests = invoke(["test", "--project", healthy]).result;
  assert.deepEqual(tests.data, { total: 2, passed: 2, failed: 0, skipped: 0, end_to_end: ["test/server.e2e.test.mjs"] });

  const codeError = invoke(["compile", "--project", example("code-error")]).result;
  assert.deepEqual(codeError.errors[0], { code: "compile-error", message: "SyntaxError : Unexpected token ';'", file: "src/app.mjs", line: 2 });

  const failing = invoke(["test", "--project", example("failing-test")]).result;
  assert.equal(failing.data.failed, 1);
  assert.deepEqual(failing.errors[0], { code: "test-failed", message: "greet salue par le nom", file: "test/app.test.mjs", line: 5 });

  const notLoaded = invoke(["test", "--project", example("test-not-loaded")]).result;
  assert.ok(!notLoaded.ok);
  assert.equal(notLoaded.errors[0]?.file, "test/broken.test.mjs");

  assert.equal(invoke(["test", "--project", example("no-tests")]).result.errors[0]?.code, "no-tests");
  const noMain = invoke(["test", "--project", example("no-main-scene")]).result;
  assert.ok(noMain.ok);
  assert.deepEqual(noMain.data.end_to_end, []);
});

test("smoke-test: exit code, error location, time limit", () => {
  const healthy = invoke(["smoke-test", "--project", example("healthy")]).result;
  assert.ok(healthy.ok, JSON.stringify(healthy));
  assert.deepEqual(healthy.data, { scene: "smoke", seconds: 120 });

  const crash = invoke(["smoke-test", "--project", example("runtime-error")]).result;
  assert.deepEqual(crash.errors[0], { code: "runtime-error", message: "Error : configuration absente : le serveur ne peut pas démarrer", file: "src/server.mjs", line: 5 });

  const slow = project({ engine: "node", version: major, node: { smoke_test: "slow" } }, { slow: "node -e \"setTimeout(() => {}, 60000)\"" });
  const start = Date.now();
  const timeout = invoke(["smoke-test", "--project", slow, "--seconds", "2"]).result;
  assert.equal(timeout.errors[0]?.code, "timeout");
  assert.ok(Date.now() - start < 30_000);
  assert.match(readFileSync(timeout.log ?? "", "utf8"), /délai dépassé, arbre arrêté/);
});

test("launch: detached app, pid and SPAWN-URL; stopped by its pid", async () => {
  const healthy = example("healthy");
  // Sans Edge : pas de fenêtre dans les tests, l'app tourne quand même et l'avertissement donne l'adresse.
  const { result } = invoke(["launch", "--project", healthy, "--scene", "/accueil"], cleanEnv({ SPAWN_EDGE: join(temp, "no-edge.exe") }));
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.warnings[0]?.code, "browser-not-found");
  const { pid, url, scene } = result.data as { pid: number; url: string; scene: string };
  try {
    assert.equal(scene, "/accueil");
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/accueil$/);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Exemple Spawn/);
    assert.match(readFileSync(result.log ?? "", "utf8"), /SPAWN-URL http/);
  } finally {
    killTree(pid);
  }
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(!isAlive(pid));
  await assert.rejects(fetch(url));

  const crash = invoke(["launch", "--project", example("runtime-error")]).result;
  assert.equal(crash.errors[0]?.code, "runtime-error");
  assert.equal(crash.errors[0]?.file, "src/server.mjs");
});

// Une « fenêtre » qui se ferme aussitôt (node refuse --app) : l'app s'arrête avec elle, rien ne reste à tourner.
test("launch: closing the window stops the app", async () => {
  const { result } = invoke(["launch", "--project", example("healthy")], cleanEnv({ SPAWN_EDGE: process.execPath }));
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.warnings, []);
  const { pid } = result.data as { pid: number };
  try {
    const end = Date.now() + 15_000;
    while (isAlive(pid) && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
    assert.ok(!isAlive(pid), "l'app est arrêtée quand sa fenêtre se ferme");
  } finally {
    killTree(pid);
  }
});

test("capture: Edge absent is a failure that says so", () => {
  const { result } = invoke(["capture", "--project", example("healthy"), "--output", join(temp, "x.png")], cleanEnv({ SPAWN_EDGE: join(temp, "no-edge.exe") }));
  assert.equal(result.errors[0]?.code, "browser-not-found");
  assert.match(result.errors[0]?.message ?? "", /Edge introuvable/);
});

// Un « Edge » qui s'arrête aussitôt sans image (node refuse ses options) : l'erreur dit code, durée et sortie.
test("capture: Edge that stops without an image says how it stopped", () => {
  const { result } = invoke(["capture", "--project", example("healthy"), "--output", join(temp, "none.png")], cleanEnv({ SPAWN_EDGE: process.execPath }));
  assert.equal(result.errors[0]?.code, "capture-failed");
  assert.match(result.errors[0]?.message ?? "", /arrêté avec le code [1-9]\d* après \d+ ms ; sa sortie : .*bad option/);
});

const edge = invoke(["prerequisites"]).result.data.tools as { name: string; present: boolean }[];
const withoutEdge = edge.find((t) => t.name === "edge")?.present !== true;

test("capture: PNG of the declared route, app stopped afterwards", { skip: withoutEdge && "Edge absent : capture non testée" }, () => {
  const healthy = example("healthy");
  const output = join(temp, "shots", "healthy.png");
  // Avec la variable que Windows pose sur une app lancée depuis l'Explorateur, héritée par tout son arbre : Edge sortait
  // sans image (essai du 18/11).
  const { result } = invoke(["capture", "--project", healthy, "--output", output, "--width", "640", "--height", "360"], cleanEnv({ __COMPAT_LAYER: "DetectorsAppHealth" }));
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.artifacts[0]?.role, "capture");
  assert.deepEqual(readFileSync(output).subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.equal(readFileSync(output).readUInt32BE(16), 640);
  assert.equal(result.data.scene, "/");
});
