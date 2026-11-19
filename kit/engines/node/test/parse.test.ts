// Relecture des sorties de tsc, eslint, cargo, Node et du lanceur de tests de Node.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { moduleDirs } from "../src/commands/prepare-worktree.ts";
import { parseErrors, parseTestOutput, Paths } from "../src/parse.ts";
import { parseNodeSection, workspaceDirs } from "../src/project.ts";
import { Failure } from "../src/result.ts";

const project = mkdtempSync(join(tmpdir(), "spawn-node-parse-"));
after(() => rmSync(project, { recursive: true, force: true }));
mkdirSync(join(project, "pkg", "test"), { recursive: true });
writeFileSync(join(project, "package.json"), JSON.stringify({ name: "root", workspaces: ["pkg"] }));
writeFileSync(join(project, "pkg", "package.json"), JSON.stringify({ name: "@x/pkg" }));
writeFileSync(join(project, "pkg", "test", "a.test.ts"), "");
const paths = () => new Paths(project, workspaceDirs(project));

test("tsc: both formats give file and line, relative to the project", () => {
  const out = [
    "src/app.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    `${join(project, "src", "b.ts")}:3:1 - error TS1005: ';' expected.`,
    "Found 2 errors.",
  ].join("\n");
  assert.deepEqual(parseErrors(out, paths()), [
    { code: "compile-error", message: "TS2322 : Type 'string' is not assignable to type 'number'.", file: "src/app.ts", line: 12 },
    { code: "compile-error", message: "TS1005 : ';' expected.", file: "src/b.ts", line: 3 },
  ]);
});

test("eslint stylish: errors under their file header, warnings ignored", () => {
  const out = [
    "",
    join(project, "src", "c.ts"),
    "  4:7   error    'x' is assigned a value but never used  @typescript-eslint/no-unused-vars",
    "  9:1   warning  Unexpected console statement             no-console",
    "",
    "✖ 2 problems (1 error, 1 warning)",
  ].join("\n");
  assert.deepEqual(parseErrors(out, paths()), [
    { code: "lint-error", message: "'x' is assigned a value but never used (@typescript-eslint/no-unused-vars)", file: "src/c.ts", line: 4 },
  ]);
});

test("cargo: error then --> location; warnings skipped", () => {
  const out = [
    "warning: unused variable: `y`",
    " --> src/lib.rs:1:5",
    "error[E0425]: cannot find value `x` in this scope",
    "  --> src-tauri/src/main.rs:7:13",
    "error: could not compile `app` due to 1 previous error",
  ].join("\n");
  assert.deepEqual(parseErrors(out, paths()), [
    { code: "compile-error", message: "E0425 : cannot find value `x` in this scope", file: "src-tauri/src/main.rs", line: 7 },
  ]);
});

test("Node: uncaught error located by its header or its first project frame", () => {
  const file = join(project, "src", "server.mjs");
  const header = [`file:///${file.replaceAll("\\", "/")}:5`, 'throw new Error("boom");', "^", "", "Error: boom", "    at file:///x"].join("\n");
  assert.deepEqual(parseErrors(header, paths()), [{ code: "runtime-error", message: "Error : boom", file: "src/server.mjs", line: 5 }]);
  const frames = ["TypeError [ERR_X]: bad", "    at node:internal/a:1:1", `    at start (${file}:8:3)`].join("\n");
  assert.deepEqual(parseErrors(frames, paths()), [{ code: "runtime-error", message: "TypeError : bad", file: "src/server.mjs", line: 8 }]);
  const syntax = [`${join(project, "src", "app.mjs")}:2`, "  return 1 +;", "SyntaxError: Unexpected token ';'"].join("\n");
  assert.equal(parseErrors(syntax, paths())[0]?.code, "compile-error");
});

test("node:test: suites of several workspaces add up; failing names with their file", () => {
  const out = [
    "> root@1.0.0 test:unit",
    "> npm test --workspaces",
    "",
    "> @x/pkg@0.1.0 test",
    "> node --test",
    "✔ ok (1ms)",
    "ℹ tests 3",
    "ℹ pass 1",
    "ℹ fail 1",
    "ℹ cancelled 0",
    "ℹ skipped 1",
    "ℹ todo 0",
    "",
    "✖ failing tests:",
    "",
    "test at test\\a.test.ts:4:38",
    "✖ adds numbers (0.8ms)",
    "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
    "",
    "> root@1.0.0 test",
    "ℹ tests 2",
    "ℹ pass 2",
    "ℹ fail 0",
    "ℹ skipped 0",
  ].join("\n");
  const s = parseTestOutput(out, paths());
  assert.deepEqual(
    { suites: s.suites, total: s.total, passed: s.passed, failed: s.failed, skipped: s.skipped },
    { suites: 2, total: 5, passed: 3, failed: 1, skipped: 1 },
  );
  assert.deepEqual(s.failures, [{ name: "adds numbers", file: "pkg/test/a.test.ts", line: 4 }]);
});

test("npm 12 headers (npm notice run) also locate the workspace", () => {
  const out = ["npm notice run root@1.0.0 test:unit", "npm notice run npm test --workspaces", "npm notice run @x/pkg@0.1.0 test", "src/x.ts(1,1): error TS1005: ';' expected."].join("\n");
  // Absent du dossier de l'espace de travail : laissé relatif à la racine.
  assert.equal(parseErrors(out, paths())[0]?.file, "src/x.ts");
  const failing = ["npm notice run @x/pkg@0.1.0 test", "ℹ tests 1", "ℹ fail 1", "✖ failing tests:", "test at test\\a.test.ts:2:1", "✖ breaks (1ms)"].join("\n");
  assert.deepEqual(parseTestOutput(failing, paths()).failures, [{ name: "breaks", file: "pkg/test/a.test.ts", line: 2 }]);
});

test("node:test TAP: counts and failing names", () => {
  const s = parseTestOutput(["not ok 1 - breaks", "# tests 2", "# pass 1", "# fail 1"].join("\n"), paths());
  assert.equal(s.total, 2);
  assert.deepEqual(s.failures, [{ name: "breaks" }]);
});

test("prepare-worktree shares every node_modules of the lock, workspaces included", () => {
  const lock = JSON.stringify({
    packages: { "": {}, "kit/core": {}, "node_modules/a": {}, "node_modules/a/node_modules/b": {}, "kit/core/node_modules/ajv": {} },
  });
  assert.deepEqual(moduleDirs(lock), ["kit/core/node_modules", "node_modules"]);
  assert.deepEqual(moduleDirs("pas du JSON"), ["node_modules"]);
});

test("spawn.json node section: declarations checked, unknown keys refused", () => {
  assert.deepEqual(parseNodeSection({ compile: ["typecheck", "lint"], test: "test:unit", capture: { path: "/a", wait_ms: 10 }, end_to_end: ["t/*.ts"] }), {
    compile: ["typecheck", "lint"],
    test: "test:unit",
    capture: { path: "/a", wait_ms: 10 },
    end_to_end: ["t/*.ts"],
  });
  for (const bad of [{ compile: [] }, { test: "a && b" }, { capture: { path: "a" } }, { smoke: "x" }, { end_to_end: "t" }, []]) {
    assert.throws(() => parseNodeSection(bad), (e: unknown) => e instanceof Failure && e.code === "spawn-json-invalid", JSON.stringify(bad));
  }
});
