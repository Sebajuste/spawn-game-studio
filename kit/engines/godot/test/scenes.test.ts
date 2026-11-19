// Scènes et scène principale : sorties de tools/check-scenes.gd et tools/smoke-test.gd enregistrées sur Godot 4.7.2.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { parseScenes } from "../src/commands/compile.ts";
import { parseSmokeTest } from "../src/commands/smoke-test.ts";
import { parseJUnit } from "../src/gut.ts";
import { readMainScene, mainScene, endToEndTests } from "../src/main-scene.ts";
import { checkMainScene, checkSceneScripts } from "../src/scene-text.ts";

const fixture = (name: string): string => readFileSync(new URL(`./data/${name}`, import.meta.url), "utf8");

const temp = mkdtempSync(join(tmpdir(), "spawn-godot-scenes-"));
after(() => rmSync(temp, { recursive: true, force: true }));

function project(name: string, files: Record<string, string>): string {
  const dir = join(temp, name);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

test("scenes: unreadable, missing resource, broken text resource; one located error per file", () => {
  const summary = parseScenes(fixture("scenes-broken.txt"));
  assert.equal(summary.scenes_checked, 4);
  assert.deepEqual(
    summary.errors.map((e) => [e.code, e.file, e.line]),
    [
      ["invalid-scene", "a/garbage.tres", 1],
      ["invalid-scene", "a/garbage.tscn", 5],
      ["invalid-scene", "a/manque.tscn", 7],
    ],
  );
  assert.match(summary.errors[2]?.message ?? "", /referenced non-existent resource/);
});

test("scenes: root declaring a parent, refused only at instantiation (tic-tac-toe case)", () => {
  const summary = parseScenes(fixture("scenes-root-parent.txt"));
  assert.equal(summary.scenes_checked, 3);
  assert.deepEqual(
    summary.errors.map((e) => [e.code, e.file]),
    [
      ["invalid-scene", "core/actors/grille/case.tscn"],
      ["invalid-scene", "core/actors/grille/grille.tscn"],
    ],
  );
  assert.match(summary.errors[1]?.message ?? "", /cannot specify a parent node/);
});

test("scenes: failure marker without a recognised message, truncated output", () => {
  const summary = parseScenes("SPAWN-SCENE res://a.tscn\nSPAWN-SCENE-FAILED res://a.tscn\nSPAWN-SCENE res://b.tscn\n");
  assert.deepEqual(
    summary.errors.map((e) => [e.code, e.file]),
    [
      ["invalid-scene", "a.tscn"],
      ["check-incomplete", undefined],
    ],
  );
});

test("smoke test: healthy output, scene without script, script error, stop before the end", () => {
  assert.deepEqual(parseSmokeTest("SPAWN-SMOKE-SCRIPTS 2 5\nSPAWN-SMOKE-END\n", 3), []);

  assert.deepEqual(
    parseSmokeTest("SPAWN-SMOKE-SCRIPTS 0 9\nSPAWN-SMOKE-END\n", 3, undefined, "main.tscn").map((e) => [e.code, e.file]),
    [["main-scene-empty", "main.tscn"]],
  );
  // Le message donne les lignes exactes à écrire (essai du 19/11 : une heure à chercher comment attacher un script).
  assert.match(
    parseSmokeTest("SPAWN-SMOKE-SCRIPTS 0 9\nSPAWN-SMOKE-END\n", 3, undefined, "core/games/main/main.tscn")[0]?.message ?? "",
    /le programme ne fait rien\. Attacher son script au nœud racine de core\/games\/main\/main\.tscn, en tête du fichier.*\[ext_resource type="Script" path="res:\/\/core\/games\/main\/main\.gd" id="1_script"\].*script = ExtResource\("1_script"\)/,
  );

  const error = parseSmokeTest(
    [
      "SPAWN-SMOKE-SCRIPTS 1 2",
      "SCRIPT ERROR: Cannot call method 'get_name' on a null value.",
      "   at: _ready (res://main.gd:6)",
      "SPAWN-SMOKE-END",
    ].join("\n"),
    3,
  );
  assert.deepEqual(error, [
    { code: "runtime-error", message: "Cannot call method 'get_name' on a null value.", file: "main.gd", line: 6 },
  ]);

  assert.deepEqual(
    parseSmokeTest("SPAWN-SMOKE-SCRIPTS 1 1\n", 3).map((e) => e.code),
    ["runtime-error"],
  );
  assert.deepEqual(
    parseSmokeTest("SPAWN-SMOKE-ERROR scène illisible : res://x.tscn\n", 3).map((e) => [e.code, e.message]),
    [["runtime-error", "scène illisible : res://x.tscn"]],
  );
});

test("main scene: read in [application] only, uid:// resolved through the scene headers", () => {
  assert.equal(readMainScene('[application]\nconfig/name="x"\nrun/main_scene="res://a.tscn"\n'), "res://a.tscn");
  assert.equal(readMainScene('[application]\nconfig/name="x"\n\n[other]\nrun/main_scene="res://a.tscn"\n'), null);
  assert.equal(readMainScene('[application]\nrun/main_scene=""\n'), null);

  const p = project("uid", {
    "project.godot": '[application]\nrun/main_scene="uid://abc"\n',
    "core/games/main/main.tscn": '[gd_scene format=3 uid="uid://abc"]\n',
    "addons/x/main.tscn": '[gd_scene format=3 uid="uid://abc"]\n',
  });
  assert.equal(mainScene(p), "res://core/games/main/main.tscn");
  assert.equal(mainScene(project("none", { "project.godot": '[application]\nconfig/name="x"\n' })), null);
});

test("end to end: the launched tests that cite the main scene, by path or by uid", () => {
  const p = project("e2e", {
    "main.tscn": '[gd_scene format=3 uid="uid://m1"]\n',
    "tests/test_round.gd": 'var s = preload("res://main.tscn")\n',
    "tests/test_uid.gd": 'get_tree().change_scene_to_file("uid://m1")\n',
    "tests/test_rules.gd": 'var r = load("res://rules.gd")\n',
    "tests/test_other.gd": 'var s = load("res://other/main.tscn")\n',
  });
  const launched = ["tests/test_rules.gd", "tests/test_round.gd", "tests/test_uid.gd", "tests/test_other.gd", "tests/missing.gd"];
  assert.deepEqual(endToEndTests(p, launched, "res://main.tscn"), ["tests/test_round.gd", "tests/test_uid.gd"]);
  assert.deepEqual(endToEndTests(p, launched, null), []);
});

test("JUnit: launched test files recorded", () => {
  const xml = '<testsuites><testsuite name="core/a/tests/test_a.gd"><testcase name="t" status="pass"/></testsuite><testsuite name="test/test_b.gd"></testsuite></testsuites>';
  assert.deepEqual(parseJUnit(xml).files, ["core/a/tests/test_a.gd", "test/test_b.gd"]);
});

test("scene text: a script written as a string or load() is refused with the exact lines; main scene declared and present", () => {
  // Fichiers de l'essai du 19/11 : scène principale déclarée à un chemin vide (écrite sous un chemin doublé), scripts en chaîne.
  const p = project("night", {
    "project.godot": '[application]\nrun/main_scene="res://core/games/morpion2/main.tscn"\n',
    "core/games/main/main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\nscript = "res://core/games/main/main.gd"\n',
    "core/games/core/games/morpion2/main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\nscript = load("res://core/games/morpion2/main.gd")\n',
    "core/games/main/ok.tscn": '[gd_scene format=3]\n[ext_resource type="Script" path="res://ok.gd" id="1_a"]\n[node name="Ok" type="Node"]\nscript = ExtResource("1_a")\n',
    "addons/x/bad.tscn": '[node name="X" type="Node"]\nscript = "res://x.gd"\n',
    ".spawn/temp/bad.tscn": '[node name="X" type="Node"]\nscript = "res://x.gd"\n',
  });
  const written = checkSceneScripts(p);
  assert.deepEqual(
    written.map((e) => [e.code, e.file, e.line]),
    [
      ["invalid-scene", "core/games/core/games/morpion2/main.tscn", 4],
      ["invalid-scene", "core/games/main/main.tscn", 4],
    ],
  );
  assert.match(
    written[1]?.message ?? "",
    /core\/games\/main\/main\.tscn:4 : « script = "res:\/\/core\/games\/main\/main\.gd" » n'attache aucun script[\s\S]*\[ext_resource type="Script" path="res:\/\/core\/games\/main\/main\.gd" id="1_script"\][\s\S]*script = ExtResource\("1_script"\)/,
  );
  assert.match(written[0]?.message ?? "", /path="res:\/\/core\/games\/morpion2\/main\.gd"/, "le chemin est repris de load()");

  const main = checkMainScene(p);
  assert.deepEqual(main.map((e) => [e.code, e.file, e.line]), [["scene-not-found", "project.godot", 2]]);
  assert.match(main[0]?.message ?? "", /res:\/\/core\/games\/morpion2\/main\.tscn n'existe pas[\s\S]*Scène\(s\) du même nom dans le projet : res:\/\/core\/games\/core\/games\/morpion2\/main\.tscn, res:\/\/core\/games\/main\/main\.tscn/);
  assert.deepEqual(checkMainScene(project("undeclared", { "project.godot": '[application]\nconfig/name="x"\n' })).map((e) => e.code), ["main-scene-missing"]);
  assert.deepEqual(checkMainScene(project("present", { "project.godot": '[application]\nrun/main_scene="res://m.tscn"\n', "m.tscn": "[gd_scene format=3]\n" })), []);
});
