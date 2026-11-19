// Contrôle négatif de la phase 0 : un témoin cassé doit rendre la suite rouge.
// Le témoin et son test sont copiés dans un dossier temporaire, puis lancés
// dans un processus `node --test` séparé, intact puis cassé.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const coreRoot = fileURLToPath(new URL("..", import.meta.url));
const copies: string[] = [];

after(() => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

function copyCanary(): string {
  const dir = mkdtempSync(join(tmpdir(), "spawn-canary-"));
  copies.push(dir);
  cpSync(join(coreRoot, "src", "canary.ts"), join(dir, "src", "canary.ts"));
  cpSync(join(coreRoot, "test", "canary.test.ts"), join(dir, "test", "canary.test.ts"));
  writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
  return dir;
}

function runTests(dir: string) {
  // NODE_TEST_CONTEXT ferait remonter le résultat au lanceur parent au lieu du code de sortie.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ["--test", join("test", "canary.test.ts")], {
    cwd: dir,
    env,
    encoding: "utf8",
  });
}

test("intact canary copy: the suite passes", () => {
  const result = runTests(copyCanary());
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("broken canary: the suite fails and names the test", () => {
  const dir = copyCanary();
  const source = join(dir, "src", "canary.ts");
  const original = readFileSync(source, "utf8");
  const broken = original.replace('"spawn"', '"broken"');
  assert.notEqual(broken, original, "la valeur du témoin n'a pas été trouvée dans sa source");
  writeFileSync(source, broken);

  const result = runTests(dir);
  assert.notEqual(result.status, 0, "un témoin cassé doit faire échouer node --test");
  assert.match(result.stdout, /the canary returns its expected value/);
});
