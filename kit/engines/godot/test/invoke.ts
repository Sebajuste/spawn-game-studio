// Lance l'adaptateur comme le fera la suite de contrat et vérifie les invariants du §3.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterResult } from "../../../core/src/adapter/types.ts";

const ADAPTER_DIR = fileURLToPath(new URL("..", import.meta.url));

export interface Invocation {
  code: number | null;
  result: AdapterResult;
  stderr: string;
}

export function invoke(args: readonly string[], env: NodeJS.ProcessEnv = process.env): Invocation {
  const p = spawnSync(process.execPath, ["src/cli.ts", ...args], {
    cwd: ADAPTER_DIR,
    env,
    encoding: "utf8",
    timeout: 900_000,
  });
  const raw = p.stdout.trim();
  let result: AdapterResult;
  try {
    result = JSON.parse(raw) as AdapterResult;
  } catch {
    assert.fail(`stdout n'est pas un objet JSON unique :\n${p.stdout}\n--- stderr ---\n${p.stderr}`);
  }
  checkInvariants(result, p.status);
  return { code: p.status, result, stderr: p.stderr };
}

const IDENTIFIER = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function checkInvariants(r: AdapterResult, code: number | null): void {
  const context = JSON.stringify(r, null, 2);
  assert.equal(r.contract, 1, context);
  assert.equal(r.engine, "godot", context);
  assert.equal(r.ok, r.errors.length === 0, `ok ⇔ errors vides\n${context}`);
  const usage = r.errors.some((e) => e.code === "usage");
  assert.equal(code, usage ? 2 : r.ok ? 0 : 1, `code de sortie\n${context}`);
  for (const d of [...r.errors, ...r.warnings]) {
    assert.match(d.code, IDENTIFIER, context);
    assert.ok(d.message.length > 0, context);
    if (d.file !== undefined) {
      assert.ok(!d.file.includes("\\") && !isAbsolute(d.file), `fichier relatif en /\n${context}`);
    }
    if (d.line !== undefined) assert.ok(Number.isInteger(d.line) && d.line >= 1, context);
  }
  for (const a of r.artifacts) {
    assert.ok(isAbsolute(a.path) && existsSync(a.path) && statSync(a.path).isFile(), `artefact ${a.path}`);
    assert.match(a.role, IDENTIFIER);
  }
  if (r.log !== null) {
    assert.ok(isAbsolute(r.log) && existsSync(r.log), `journal ${r.log}`);
  }
  assert.ok(Number.isInteger(r.duration_ms) && r.duration_ms >= 0, context);
  assert.equal(typeof r.data, "object");
}

export function readLog(r: AdapterResult): string {
  assert.ok(r.log !== null, "journal attendu");
  return readFileSync(r.log, "utf8");
}
