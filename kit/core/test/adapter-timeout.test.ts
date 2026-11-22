import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adapterTimeoutMs, callAdapter, loadAdapter } from "../src/adapter/call.ts";

// Le délai du kit n'est qu'un filet contre un adaptateur pendu : l'adaptateur borne lui-même le moteur (contrat §2),
// jusqu'à 900 s pour une suite de tests. Le 22/11, le filet de 600 s a tué une suite saine de map-editor.
test("safety timeout: well above what an adapter gives itself by default", () => {
  assert.ok(adapterTimeoutMs({}) >= 30 * 60_000);
  assert.ok(adapterTimeoutMs({ project: "/p" }) > 900_000);
});

test("safety timeout: --timeout given is honoured, with a margin for the adapter to answer", () => {
  assert.ok(adapterTimeoutMs({ timeout: "3600" }) > 3_600_000);
  const short = adapterTimeoutMs({ timeout: "30" });
  assert.ok(short > 30_000 && short <= 120_000, `--timeout 30 : ${short} ms`);
});

test("safety timeout: smoke-test --seconds lengthens it", () => {
  assert.ok(adapterTimeoutMs({ seconds: "7200" }) > 7_200_000);
});

test("safety timeout: unreadable values fall back to the default", () => {
  assert.equal(adapterTimeoutMs({ timeout: "abc" }), adapterTimeoutMs({}));
  assert.equal(adapterTimeoutMs({ timeout: true }), adapterTimeoutMs({}));
});

// Le 22/11, une suite lancée depuis un tour d'agent (ou par spawn merge) héritait de SPAWN_RUNNER=service, le marqueur
// de l'enchaîneur ; les tests du projet qui le lisent changeaient de comportement et la fusion était refusée.
test("the adapter never inherits the orchestrator's markers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spawn-env-"));
  try {
    writeFileSync(join(dir, "adapter.json"), JSON.stringify({ contract: 1, engine: "echo", command: ["node", "./echo.mjs"] }));
    writeFileSync(join(dir, "echo.mjs"), "process.stdout.write(process.env.SPAWN_RUNNER ?? 'absent');\n");
    const r = await callAdapter(loadAdapter(dir), "compile", {}, { env: { ...process.env, SPAWN_RUNNER: "service" } });
    assert.equal(r.stdout, "absent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
