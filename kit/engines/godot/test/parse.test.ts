// Analyse de journaux Godot et de sorties GUT enregistrées sur Godot 4.7.2 / GUT 9.6.0.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseCompile } from "../src/commands/compile.ts";
import { parseJUnit, parseTests } from "../src/gut.ts";
import { parseLog, stripAnsi } from "../src/log.ts";

const fixture = (name: string): string => readFileSync(new URL(`./data/${name}`, import.meta.url), "utf8");

test("runtime error: SCRIPT ERROR located by the following « at: » line", () => {
  const errors = parseLog(fixture("capture-runtime-error.txt"));
  assert.deepEqual(errors, [
    { code: "script-error", message: "Cannot call method 'get_name' on a null value.", file: "principal.gd", line: 6 },
  ]);
});

test("syntax errors: one per file, « Failed to load script » deduplicated", () => {
  const errors = parseLog(fixture("compile.txt"));
  assert.deepEqual(
    errors.map((e) => [e.code, e.file, e.line]),
    [
      ["syntax-error", "casse.gd", 4],
      ["syntax-error", "sub/compile.gd", 4],
    ],
  );
});

test("compile: checker markers read back", () => {
  const summary = parseCompile(fixture("compile.txt"));
  assert.equal(summary.files_checked, 7);
  assert.equal(summary.errors.length, 2);
});

test("compile: truncated output (no SPAWN-CHECKED) = failure", () => {
  const summary = parseCompile("Godot Engine v4.7.2\nSPAWN-FAILED res://a.gd\n");
  assert.deepEqual(
    summary.errors.map((e) => e.code),
    ["invalid-script", "check-incomplete"],
  );
  assert.equal(summary.errors[0]?.file, "a.gd");
});

test("benign engine noise: neither bare ERROR: nor Condition is true", () => {
  const text = [
    'ERROR: Condition "!is_inside_tree()" is true. Returning: Transform3D()',
    "   at: get_global_transform (scene/3d/node_3d.cpp:345)",
    "ERROR: Something minor happened.",
    "WARNING: ObjectDB instances leaked at exit.",
  ].join("\n");
  assert.deepEqual(parseLog(text), []);
});

test("render and null-instance patterns taken from Deep Front", () => {
  const text = [
    "ERROR: Attempt to call function 'foo' in base 'null instance' on a null instance.",
    "ERROR: Uniforms were never supplied for set (0) at the time of drawing, which are required by the pipeline.",
    'ERROR: Parameter "uniform_set" is null.',
    "ERROR: 'res://a.png' is not a valid texture.",
    'ERROR: Cannot open file "res://manque.tres".',
    "USER SCRIPT ERROR: assertion",
    "   at: _process (res://joueur.gd:12)",
  ].join("\n");
  assert.deepEqual(
    parseLog(text).map((e) => [e.code, e.file, e.line]),
    [
      ["script-error", undefined, undefined],
      ["render-error", undefined, undefined],
      ["render-error", undefined, undefined],
      ["render-error", "a.png", undefined],
      ["file-unreadable", "manque.tres", undefined],
      ["script-error", "joueur.gd", 12],
    ],
  );
});

test("ANSI colour codes stripped", () => {
  assert.equal(stripAnsi("\u001b[31m[Failed]\u001b[0m:  x"), "[Failed]:  x");
});

test("GUT: failing test and unexpected error read from the JUnit", () => {
  const summary = parseTests(fixture("gut-mixed.txt"), fixture("junit-mixed.xml"), 1);
  assert.deepEqual([summary.total, summary.passed, summary.failed, summary.skipped], [4, 1, 2, 1]);
  const codes = summary.errors.map((e) => [e.code, e.file, e.line]);
  assert.deepEqual(codes, [
    ["test-not-loaded", "test/test_casse.gd", 4],
    ["test-failed", "test/test_a.gd", 7],
    ["test-failed", "test/test_a.gd", undefined],
  ]);
  assert.match(summary.errors[1]?.message ?? "", /^test_rouge : \[1\] expected to equal \[2\]/);
});

test("GUT: test file not loaded although GUT exits with 0 and « All tests passed! »", () => {
  const output = fixture("gut-not-loaded.txt");
  assert.match(stripAnsi(output), /All tests passed!/);
  const summary = parseTests(output, fixture("junit-not-loaded.xml"), 0);
  assert.equal(summary.passed, 1);
  assert.deepEqual(
    summary.errors.map((e) => [e.code, e.file]),
    [["test-not-loaded", "test/test_casse.gd"]],
  );
});

test("GUT: « Nothing was run. » with exit 0 gives no-tests", () => {
  const summary = parseTests(fixture("gut-nothing.txt"), fixture("junit-nothing.xml"), 0);
  assert.equal(summary.total, 0);
  assert.deepEqual(
    summary.errors.map((e) => e.code),
    ["no-tests"],
  );
});

test("GUT: missing report, or non-zero exit without an identifiable failure", () => {
  assert.deepEqual(
    parseTests("rien", null, 0).errors.map((e) => e.code),
    ["report-missing"],
  );
  const xml = '<testsuites><testsuite name="test/t.gd"><testcase name="a" status="pass"></testcase></testsuite></testsuites>';
  assert.deepEqual(
    parseTests("", xml, 1).errors.map((e) => e.code),
    ["gut-failed"],
  );
});

test("failing JUnit: name, file and line", () => {
  const summary = parseJUnit(fixture("junit-failing.xml"));
  assert.deepEqual(summary.errors, [
    {
      code: "test-failed",
      message: "test_rouge : [1] expected to equal [2]: échec voulu par le scénario test-rouge",
      file: "test/test_rouge.gd",
      line: 5,
    },
  ]);
});
