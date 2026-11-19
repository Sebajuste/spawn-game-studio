import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { validateResponse } from "../src/adapter/validate.ts";

const dir = mkdtempSync(join(tmpdir(), "spawn-validate-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const log = join(dir, "log.log");
writeFileSync(log, "output\n");

function result(overrides: Record<string, unknown> = {}) {
  return {
    contract: 1,
    engine: "fake",
    command: "compile",
    ok: true,
    errors: [],
    warnings: [],
    artifacts: [],
    log,
    duration_ms: 12,
    data: {},
    ...overrides,
  };
}

function defects(object: unknown, exitCode: number | null = 0, stdout?: string): string[] {
  return validateResponse({ subcommand: "compile", engine: "fake", exitCode, stdout: stdout ?? JSON.stringify(object) }).defects;
}

const failure = { ok: false, errors: [{ code: "code-error", message: "x", file: "a.gd", line: 3 }] };

describe("validateResponse", () => {
  test("a conforming response has no defect", () => {
    assert.deepEqual(defects(result()), []);
    assert.deepEqual(defects(result(failure), 1), []);
    assert.deepEqual(defects(result({ ok: false, errors: [{ code: "usage", message: "x" }] }), 2), []);
  });

  const cases: [string, () => string[], RegExp][] = [
    ["empty stdout", () => defects(null, 0, ""), /pas un unique objet JSON/],
    ["text before the JSON", () => defects(null, 0, "bonjour\n" + JSON.stringify(result())), /pas un unique objet JSON/],
    ["missing field", () => defects({ ...result(), duration_ms: undefined }), /schéma/],
    ["unknown field", () => defects(result({ chatty: 1 })), /schéma/],
    ["error code not in kebab-case", () => defects(result({ ok: false, errors: [{ code: "Code Error", message: "x" }] }), 1), /schéma/],
    ["file with a backslash", () => defects(result({ ok: false, errors: [{ code: "e", message: "x", file: "a\\b.gd" }] }), 1), /schéma/],
    ["line 0", () => defects(result({ ok: false, errors: [{ code: "e", message: "x", line: 0 }] }), 1), /schéma/],
    ["ok: true with errors", () => defects(result({ errors: failure.errors })), /ok: true avec des erreurs/],
    ["ok: false without error", () => defects(result({ ok: false }), 1), /ok: false sans erreur/],
    ["exit code 0 on a failure", () => defects(result(failure), 0), /code de sortie 0 au lieu de 1/],
    ["exit code 1 on a success", () => defects(result(), 1), /code de sortie 1 au lieu de 0/],
    ["usage exiting with 1", () => defects(result({ ok: false, errors: [{ code: "usage", message: "x" }] }), 1), /au lieu de 2/],
    ["different engine", () => defects(result({ engine: "godot" })), /engine/],
    ["different command", () => defects(result({ command: "test" })), /command/],
    ["log not found", () => defects(result({ log: join(dir, "missing.log") })), /journal introuvable/],
    ["relative log", () => defects(result({ log: "log.log" })), /journal non absolu/],
    ["artifact not found", () => defects(result({ artifacts: [{ path: join(dir, "x.png"), role: "capture", type: "png" }] })), /artefact capture introuvable/],
    ["absolute diagnostic file", () => defects(result({ ok: false, errors: [{ code: "e", message: "x", file: "/abs/a.gd" }] }), 1), /fichier absolu/],
  ];
  for (const [name, compute, expected] of cases) {
    test(`defect reported: ${name}`, () => {
      const d = compute();
      assert.ok(d.some((x) => expected.test(x)), `attendu ${expected} dans ${JSON.stringify(d)}`);
    });
  }
});
