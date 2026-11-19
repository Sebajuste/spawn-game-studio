// Scénarios du contrat (§5) contre le vrai Godot. Sans Godot, ces tests échouent ;
// SPAWN_NO_GODOT=1 les saute explicitement.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveExecutable } from "../src/executable.ts";
import { after, describe, test } from "node:test";
import { invoke, readLog, type Invocation } from "./invoke.ts";

// Même résolution que l'adaptateur : variable, réglage machine, PATH ou recherche.
function godotAvailable(): boolean {
  try {
    resolveExecutable(undefined);
    return true;
  } catch {
    return false;
  }
}

const withoutGodot = process.env.SPAWN_NO_GODOT === "1";
const available = godotAvailable();
const skip = withoutGodot ? "SPAWN_NO_GODOT=1 : tests d'intégration Godot sautés" : false;

const temp = mkdtempSync(join(tmpdir(), "spawn-godot-integration-"));
after(() => rmSync(temp, { recursive: true, force: true }));

let counter = 0;
function example(scenario: string): { project: string; scene: string } {
  const project = join(temp, `${scenario}-${++counter}`);
  const { result } = invoke(["example", "--project", project, "--scenario", scenario]);
  assert.ok(result.ok, JSON.stringify(result));
  return { project, scene: String(result.data.scene) };
}

function codes(a: Invocation): string[] {
  return a.result.errors.map((e) => e.code);
}

function capture(project: string, scene: string, name: string): Invocation {
  return invoke(["capture", "--project", project, "--scene", scene, "--output", join(temp, "captures", `${name}.png`)]);
}

describe("Godot integration", { skip, concurrency: false }, () => {
  test("Godot is available", () => {
    assert.ok(available, "Godot introuvable : spawn engines set godot <version> \"<exécutable>\", ou SPAWN_NO_GODOT=1 pour sauter ces tests");
  });

  test("prerequisites: executable and version", { skip: !available }, () => {
    const { result } = invoke(["prerequisites"]);
    assert.ok(result.ok, JSON.stringify(result));
    assert.match(String(result.data.version), /^4\.\d+/);
  });

  test("healthy: compile, test and capture succeed", { skip: !available }, () => {
    const { project, scene } = example("healthy");
    const c = invoke(["compile", "--project", project]);
    assert.ok(c.result.ok, JSON.stringify(c.result));
    assert.ok(Number(c.result.data.files_checked) >= 2);
    assert.equal(c.result.data.scenes_checked, 1);

    const t = invoke(["test", "--project", project]);
    assert.ok(t.result.ok, JSON.stringify(t.result));
    assert.ok(Number(t.result.data.passed) >= 1);
    assert.ok(t.result.artifacts.some((a) => a.role === "test-report"));
    assert.deepEqual(t.result.data.end_to_end, ["test/test_main.gd"]);

    const f = invoke(["smoke-test", "--project", project, "--seconds", "1"]);
    assert.ok(f.result.ok, JSON.stringify(f.result));
    assert.deepEqual({ scene: f.result.data.scene, seconds: f.result.data.seconds }, { scene: "res://main.tscn", seconds: 1 });

    const cap = capture(project, scene, "healthy");
    assert.ok(cap.result.ok, JSON.stringify(cap.result));
    const png = cap.result.artifacts.find((a) => a.role === "capture");
    assert.ok(png !== undefined && statSync(png.path).size > 0);

    // Le dossier des journaux est protégé de l'import de Godot.
    assert.ok(existsSync(join(project, ".spawn", ".gdignore")));
  });

  test("code-error: compile fails with file and line", { skip: !available }, () => {
    const { project } = example("code-error");
    const c = invoke(["compile", "--project", project]);
    assert.equal(c.result.ok, false);
    assert.ok(
      c.result.errors.some((e) => e.file === "main.gd" && e.line === 5),
      JSON.stringify(c.result.errors),
    );
  });

  test("runtime-error: compile succeeds, capture fails although Godot exits with 0", { skip: !available }, () => {
    const { project, scene } = example("runtime-error");
    const c = invoke(["compile", "--project", project]);
    assert.ok(c.result.ok, JSON.stringify(c.result));

    const cap = capture(project, scene, "runtime-error");
    assert.equal(cap.result.ok, false);
    assert.equal(cap.code, 1);
    assert.equal(cap.result.data.engine_exit_code, 0, "Godot doit être sorti en 0 : c'est le piège mesuré");
    assert.match(readLog(cap.result), /code de sortie du moteur : 0/);
    assert.ok(cap.result.errors.some((e) => e.code === "script-error" && e.file === "main.gd"));

    const f = invoke(["smoke-test", "--project", project, "--seconds", "1"]);
    assert.equal(f.result.ok, false);
    assert.equal(f.result.data.engine_exit_code, 0);
    assert.ok(
      f.result.errors.some((e) => e.code === "runtime-error" && e.file === "main.gd" && e.line === 7),
      JSON.stringify(f.result.errors),
    );
  });

  test("invalid-scene: scripts green, compile fails on the scene Godot refuses to instantiate", { skip: !available }, () => {
    const { project } = example("invalid-scene");
    const c = invoke(["compile", "--project", project]);
    assert.equal(c.result.ok, false);
    assert.deepEqual(
      c.result.errors.map((e) => [e.code, e.file]),
      [["invalid-scene", "level.tscn"]],
    );
    assert.equal(c.result.data.scenes_checked, 2);
  });

  test("no-main-scene: smoke-test fails without launching the game, no end-to-end test", { skip: !available }, () => {
    const { project } = example("no-main-scene");
    const f = invoke(["smoke-test", "--project", project]);
    assert.deepEqual(codes(f), ["main-scene-missing"]);
    const t = invoke(["test", "--project", project]);
    assert.ok(t.result.ok, JSON.stringify(t.result));
    assert.deepEqual(t.result.data.end_to_end, []);
  });

  test("empty-main-scene: the scene runs without error but carries no script", { skip: !available }, () => {
    const { project } = example("empty-main-scene");
    const f = invoke(["smoke-test", "--project", project, "--seconds", "1"]);
    assert.deepEqual(codes(f), ["main-scene-empty"]);
  });

  // Godot charge sans erreur ce qui ne fera rien : c'est compile qui le dit (essai du 19/11).
  test("compile: a script written as a string, and a project without main scene, are red", { skip: !available }, () => {
    const { project } = example("healthy");
    writeFileSync(join(project, "chaine.tscn"), '[gd_scene format=3]\n\n[node name="Chaine" type="Node2D"]\nscript = "res://chaine.gd"\n');
    const c = invoke(["compile", "--project", project]);
    assert.equal(c.result.ok, false);
    assert.deepEqual(
      c.result.errors.map((e) => [e.code, e.file, e.line]),
      [["invalid-scene", "chaine.tscn", 4]],
    );
    const none = invoke(["compile", "--project", example("no-main-scene").project]);
    assert.deepEqual(codes(none), ["main-scene-missing"]);
  });

  test("failing-test: test fails with failed >= 1", { skip: !available }, () => {
    const { project } = example("failing-test");
    const t = invoke(["test", "--project", project]);
    assert.equal(t.result.ok, false);
    assert.ok(Number(t.result.data.failed) >= 1);
    assert.ok(codes(t).includes("test-failed"));
  });

  test("test-not-loaded: test fails although GUT exits with 0", { skip: !available }, () => {
    const { project } = example("test-not-loaded");
    const t = invoke(["test", "--project", project]);
    assert.equal(t.result.ok, false);
    assert.equal(t.result.data.engine_exit_code, 0);
    assert.ok(t.result.errors.some((e) => e.code === "test-not-loaded" && e.file === "test/test_broken.gd"));
  });

  test("no-tests: test fails with no-tests", { skip: !available }, () => {
    const { project } = example("no-tests");
    const t = invoke(["test", "--project", project]);
    assert.equal(t.result.ok, false);
    assert.ok(codes(t).includes("no-tests"));
  });

  test("timeout: killed by PID, timeout error", { skip: !available }, () => {
    const { project } = example("healthy");
    const start = Date.now();
    const c = invoke(["compile", "--project", project, "--timeout", "1"]);
    assert.deepEqual(codes(c), ["timeout"]);
    assert.ok(Date.now() - start < 30_000);
  });

  test("new-project then prepare-worktree, idempotent; existing project refused", { skip: !available }, () => {
    const project = join(temp, "new");
    mkdirSync(project);
    const n = invoke(["new-project", "--project", project, "--name", "New", "--exclude", "docs", "--exclude", "art/sources"]);
    assert.ok(n.result.ok, JSON.stringify(n.result));
    const files = n.result.data.files as string[];
    for (const f of ["project.godot", ".gutconfig.json", "addons/gut/plugin.cfg", "docs/.gdignore", "art/sources/.gdignore"]) {
      assert.ok(files.includes(f), f);
      assert.ok(existsSync(join(project, f)), f);
    }
    assert.equal(codes(invoke(["new-project", "--project", project, "--name", "x"]))[0], "project-exists");

    for (let i = 0; i < 2; i++) {
      const w = invoke(["prepare-worktree", "--project", project]);
      assert.ok(w.result.ok, JSON.stringify(w.result));
      assert.equal(w.result.data.cache, "none");
      assert.ok(existsSync(join(project, ".godot")));
    }
  });
});
