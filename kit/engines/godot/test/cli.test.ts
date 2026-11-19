// Appels de l'adaptateur qui ne lancent pas Godot.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { launchArgs } from "../src/commands/launch.ts";
import { invoke, readLog } from "./invoke.ts";

const temp = mkdtempSync(join(tmpdir(), "spawn-godot-cli-"));
after(() => rmSync(temp, { recursive: true, force: true }));

test("unknown or missing subcommand: usage, exit 2", () => {
  for (const args of [["unknown"], []]) {
    const { code, result } = invoke(args);
    assert.equal(code, 2);
    assert.equal(result.errors[0]?.code, "usage");
  }
});

test("missing or unknown option, relative path or invalid timeout: usage", () => {
  for (const args of [
    ["compile"],
    ["compile", "--project", temp, "--unknown", "x"],
    ["compile", "--project", "relative"],
    ["compile", "--project", temp, "--timeout", "zero"],
    ["example", "--project", join(temp, "e"), "--scenario", "whatever"],
    ["new-project", "--project", temp, "--name", "x", "--exclude", "../outside"],
  ]) {
    const { code, result } = invoke(args);
    assert.equal(code, 2, args.join(" "));
    assert.equal(result.errors[0]?.code, "usage", args.join(" "));
  }
});

test("Godot not found: engine-not-found, log null", () => {
  writeFileSync(join(temp, "project.godot"), "config_version=5\n");
  const env = { ...process.env, SPAWN_GODOT: join(temp, "missing.exe"), PATH: "" };
  const { code, result } = invoke(["compile", "--project", temp], env);
  assert.equal(code, 1);
  assert.equal(result.errors[0]?.code, "engine-not-found");
  assert.equal(result.log, null);
});

test("file-types: contract categories and openers", () => {
  const { result } = invoke(["file-types"]);
  const types = result.data.types as { extension: string; category: string; open: string }[];
  const byExt = new Map(types.map((t) => [t.extension, t]));
  assert.equal(byExt.get(".tscn")?.open, "engine");
  assert.equal(byExt.get(".gd")?.open, "editor");
  assert.equal(byExt.get(".gd")?.category, "code");
  assert.equal(byExt.get(".png")?.open, "system");
  const categories = ["code", "scene", "resource", "shader", "image", "model-3d", "audio", "video", "project", "text"];
  for (const t of types) {
    assert.ok(categories.includes(t.category), t.extension);
    assert.ok(["engine", "editor", "system"].includes(t.open), t.extension);
  }
  for (const ext of [".gd", ".tscn", ".scn", ".tres", ".res", ".gdshader", ".godot", ".glb", ".gltf", ".wav", ".cfg", ".md"]) {
    assert.ok(byExt.has(ext), ext);
  }
});

test("git-patterns: .godot/ ignored, .uid versioned, scenes in LF, binaries in LFS", () => {
  const { result } = invoke(["git-patterns"]);
  const d = result.data as Record<string, string[]>;
  assert.ok(d.gitignore?.includes(".godot/"));
  assert.ok(!d.gitignore?.some((m) => m.includes("uid")));
  assert.ok(d.gitattributes?.includes("*.tscn text eol=lf"));
  assert.ok(d.gitattributes?.includes("*.tres text eol=lf"));
  for (const m of ["*.png", "*.wav", "*.glb"]) assert.ok(d.lfs?.includes(m), m);
  assert.deepEqual(d.lockable, []);
});

test("read-log: missing file, then a recorded log", () => {
  assert.equal(invoke(["read-log", "--file", join(temp, "missing.log")]).result.errors[0]?.code, "file-not-found");
  const recorded = new URL("./data/capture-runtime-error.txt", import.meta.url);
  const { code, result } = invoke(["read-log", "--file", fileURLToPath(recorded)]);
  assert.equal(code, 1);
  assert.equal(result.data.lines, 8);
  assert.equal(result.errors[0]?.file, "principal.gd");
});

test("launch: Godot command line, main scene or given scene", () => {
  assert.deepEqual(launchArgs("C:/game", null), ["--path", "C:/game"]);
  assert.deepEqual(launchArgs("C:/game", "res://levels/one.tscn"), ["--path", "C:/game", "res://levels/one.tscn"]);
});

test("launch: folder without a project or missing scene fails without launching Godot", () => {
  const empty = mkdtempSync(join(temp, "empty-"));
  const noProject = invoke(["launch", "--project", empty]);
  assert.equal(noProject.code, 1);
  assert.equal(noProject.result.errors[0]?.code, "project-not-found");
  assert.equal(noProject.result.log, null);

  const project = mkdtempSync(join(temp, "project-"));
  writeFileSync(join(project, "project.godot"), "config_version=5\n");
  const missing = invoke(["launch", "--project", project, "--scene", "missing.tscn"]);
  assert.equal(missing.result.errors[0]?.code, "scene-not-found");
  assert.equal(missing.result.errors[0]?.file, "missing.tscn");

  const env = { ...process.env, SPAWN_GODOT: join(project, "missing.exe"), PATH: "" };
  assert.equal(invoke(["launch", "--project", project], env).result.errors[0]?.code, "engine-not-found");
});

// Node tient lieu de moteur : il refuse `--path` et s'arrête aussitôt, sans fenêtre.
test("launch: returns the pid without waiting for the engine, log created", () => {
  const project = mkdtempSync(join(temp, "game-"));
  writeFileSync(join(project, "project.godot"), "config_version=5\n");
  writeFileSync(join(project, "main.tscn"), "");
  const { code, result } = invoke(["launch", "--project", project, "--scene", "main.tscn", "--engine", process.execPath]);
  assert.equal(code, 0, JSON.stringify(result));
  assert.equal(typeof result.data.pid, "number");
  assert.equal(result.data.scene, "res://main.tscn");
  assert.ok(result.warnings.some((a) => a.code === "import-missing"));
  assert.match(readLog(result), /# spawn: .* --path .* res:\/\/main\.tscn/);
  waitForExit(result.data.pid as number);
});

// Le moteur détaché tient le journal ouvert : sous Windows, le dossier ne se supprime qu'après sa fin.
function waitForExit(pid: number): void {
  const limit = Date.now() + 10_000;
  while (Date.now() < limit) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  assert.fail(`le moteur ${String(pid)} tourne encore`);
}

test("smoke-test: no project, no main scene or missing main scene fails without launching Godot", () => {
  const env = { ...process.env, SPAWN_GODOT: join(temp, "missing.exe"), PATH: "" };
  const empty = mkdtempSync(join(temp, "smoke-test-empty-"));
  assert.equal(invoke(["smoke-test", "--project", empty], env).result.errors[0]?.code, "project-not-found");

  const project = mkdtempSync(join(temp, "smoke-test-"));
  writeFileSync(join(project, "project.godot"), 'config_version=5\n\n[application]\n\nconfig/name="x"\n');
  const without = invoke(["smoke-test", "--project", project], env);
  assert.equal(without.code, 1);
  assert.deepEqual(without.result.errors.map((e) => e.code), ["main-scene-missing"]);
  assert.deepEqual(without.result.data, { scene: null, seconds: 3 });
  assert.equal(without.result.log, null);

  writeFileSync(join(project, "project.godot"), 'config_version=5\n\n[application]\n\nrun/main_scene="res://main.tscn"\n');
  const missing = invoke(["smoke-test", "--project", project, "--seconds", "5"], env);
  assert.deepEqual(missing.result.errors.map((e) => [e.code, e.file]), [["scene-not-found", "main.tscn"]]);
  assert.deepEqual(missing.result.data, { scene: "res://main.tscn", seconds: 5 });

  assert.equal(invoke(["smoke-test", "--project", project, "--seconds", "0"]).code, 2);
});
