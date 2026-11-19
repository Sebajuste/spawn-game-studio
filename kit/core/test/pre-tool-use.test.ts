// Point d'entrée du hook de périmètre lancé comme Claude Code le lance : JSON sur stdin, verdict par le code de sortie.
// Seule la sortie 2 bloque ; toute panne doit donc finir en 2, jamais en 1.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readRefusals } from "../src/guard/log.ts";
import { tempDir, cleanDirs, spawnProject } from "./git-helper.ts";

after(cleanDirs);
const ENTRY = fileURLToPath(new URL("../src/hooks/pre-tool-use.ts", import.meta.url));

function run(stdin: string, script = ENTRY) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [script], { input: stdin, encoding: "utf8", env });
  return { code: r.status, stderr: r.stderr };
}
const call = (cwd: string, tool_name: string, tool_input: Record<string, unknown>) =>
  JSON.stringify({ session_id: "essai", cwd, tool_name, tool_input });

test("allowed call: exit 0, nothing in the log", () => {
  const root = spawnProject();
  const r = run(call(root, "Write", { file_path: join(root, "a.txt"), content: "x" }));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(readRefusals(root), []);
});

test("refused call: exit 2, reason on stderr, refusal logged", () => {
  const root = spawnProject();
  const r = run(call(root, "Bash", { command: "git push --force origin feature/x" }));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /refusé par le périmètre/);
  const refusal = readRefusals(root);
  assert.equal(refusal.length, 1);
  assert.equal(refusal[0]?.tool, "Bash");
  assert.equal(refusal[0]?.target, "git push --force origin feature/x");
  assert.equal(refusal[0]?.session, "essai");
});

test("outside a Spawn project: exit 0", () => {
  const r = run(call(tempDir("hors"), "Bash", { command: "git push --force" }));
  assert.equal(r.code, 0, r.stderr);
});

test("faults: unreadable or unexpected input, missing module → exit 2, never 1", () => {
  assert.equal(run("{pas du json").code, 2, "stdin illisible");
  assert.equal(run(JSON.stringify({ cwd: "x", tool_name: "Bash", tool_input: null })).code, 2, "tool_input nul");
  assert.equal(run("").code, 2, "stdin vide");

  // Le point d'entrée seul, sans ses modules : l'import échoue, l'appel doit être bloqué.
  const isolated = tempDir("isole");
  writeFileSync(join(isolated, "package.json"), '{ "type": "module" }\n');
  const copy = join(isolated, "pre-tool-use.ts");
  copyFileSync(ENTRY, copy);
  const r = run(call(isolated, "Bash", { command: "ls" }), copy);
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /en panne, appel bloqué/);
});

test("unreadable spawn.json: everything blocked except its repair", () => {
  const root = spawnProject();
  writeFileSync(join(root, "spawn.json"), "{cassé");
  assert.equal(run(call(root, "Bash", { command: "ls" })).code, 2);
  assert.equal(run(call(root, "Write", { file_path: join(root, "spawn.json"), content: "{}" })).code, 0);
});
