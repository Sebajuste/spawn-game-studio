// Adoption d'un projet Node existant : detect, puis adopt (section node déduite des scripts, premier test au besoin).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { invoke } from "./invoke.ts";

const temp = mkdtempSync(join(tmpdir(), "spawn-node-adopt-"));
after(() => rmSync(temp, { recursive: true, force: true, maxRetries: 5 }));
let counter = 0;

function project(pkg: object, files: Record<string, string> = {}): string {
  const p = join(temp, `p-${counter++}`);
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "package.json"), `${JSON.stringify({ name: "p", version: "1.0.0", ...pkg }, null, 4)}\n`);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(p, rel, ".."), { recursive: true });
    writeFileSync(join(p, rel), content);
  }
  return p;
}

const codes = (gaps: unknown) => (gaps as { code: string }[]).map((g) => g.code);

test("detect: package.json recognised, version from engines, .nvmrc, then the machine; other folders not matched", () => {
  const empty = join(temp, "empty");
  mkdirSync(empty);
  assert.deepEqual(invoke(["detect", "--project", empty]).result.data, { match: false, version: null, evidence: null });
  assert.equal(invoke(["detect", "--project", join(temp, "missing")]).result.errors[0]?.code, "project-not-found");
  assert.deepEqual(invoke(["detect", "--project", project({ engines: { node: ">=20.11" } })]).result.data, { match: true, version: "20", evidence: "package.json" });
  assert.equal(invoke(["detect", "--project", project({}, { ".nvmrc": "v22.1.0\n" })]).result.data.version, "22");
  assert.equal(invoke(["detect", "--project", project({})]).result.data.version, process.versions.node.split(".")[0]);
});

test("adopt: scripts declared, dry-run writes nothing, a second pass changes nothing", () => {
  const p = project(
    { scripts: { typecheck: "tsc --noEmit", lint: "eslint .", test: "vitest run", dev: "vite" } },
    { "src/main.ts": "console.log(`SPAWN-URL ${url}`);\n", "spawn.json": '{ "engine": "node", "version": "24" }\n' },
  );
  const before = readFileSync(join(p, "spawn.json"), "utf8");
  const dry = invoke(["adopt", "--project", p, "--dry-run"]);
  assert.ok(dry.result.ok, JSON.stringify(dry.result));
  assert.deepEqual(dry.result.data.files, [{ path: "spawn.json", change: "complete" }]);
  assert.deepEqual(dry.result.data.declared, { compile: ["typecheck", "lint"], test: "test", launch: "dev" });
  assert.deepEqual(dry.result.data.gaps, []);
  assert.equal(readFileSync(join(p, "spawn.json"), "utf8"), before);

  const real = invoke(["adopt", "--project", p]);
  assert.deepEqual(real.result.data.files, dry.result.data.files);
  const config = JSON.parse(readFileSync(join(p, "spawn.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(config, { engine: "node", version: "24", node: { compile: ["typecheck", "lint"], test: "test", launch: "dev" } });
  assert.deepEqual(invoke(["adopt", "--project", p]).result.data.files, []);
});

test("adopt: without a test script, a first node:test test that passes; gaps said", () => {
  const p = project({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }, { "spawn.json": '{ "engine": "node" }' });
  const r = invoke(["adopt", "--project", p]);
  assert.ok(r.result.ok, JSON.stringify(r.result));
  assert.deepEqual(r.result.data.files, [
    { path: "spawn.json", change: "complete" },
    { path: "test/spawn.test.mjs", change: "add" },
    { path: "package.json", change: "complete" },
  ]);
  assert.deepEqual(codes(r.result.data.gaps), ["compile-missing", "launch-missing"]);
  // L'indentation du package.json est gardée.
  assert.match(readFileSync(join(p, "package.json"), "utf8"), /^ {4}"name"/m);
  const tests = invoke(["test", "--project", p]);
  assert.ok(tests.result.ok, JSON.stringify(tests.result));
  assert.equal(tests.result.data.passed, 1);
  assert.deepEqual(invoke(["adopt", "--project", p]).result.data.files, []);
});

test("adopt: an existing node section is kept; unknown runner and missing SPAWN-URL are gaps", () => {
  const kept = project({ scripts: { test: "node --test", start: "node server.js" } }, { "spawn.json": '{ "engine": "node", "node": { "test": "test" } }' });
  const r = invoke(["adopt", "--project", kept, "--dry-run"]);
  assert.deepEqual(r.result.data.files, []);
  assert.deepEqual(r.result.data.declared, { test: "test" });

  const other = project({ scripts: { test: "mocha", start: "node server.js", build: "tsc" } });
  const g = invoke(["adopt", "--project", other, "--dry-run"]);
  assert.ok(g.result.ok, JSON.stringify(g.result));
  assert.deepEqual(codes(g.result.data.gaps), ["launch-protocol", "test-runner-unknown"]);
  assert.ok(!existsSync(join(other, "spawn.json")));
});

test("adopt: a folder without package.json is not a project; the real run needs spawn.json", () => {
  const empty = join(temp, "not-node");
  mkdirSync(empty);
  assert.equal(invoke(["adopt", "--project", empty, "--dry-run"]).result.errors[0]?.code, "not-a-project");
  assert.equal(invoke(["adopt", "--project", project({})]).result.errors[0]?.code, "spawn-json-missing");
  assert.equal(invoke(["adopt", "--project", project({}), "--dry-run", "x"]).result.errors[0]?.code, "usage");
});
