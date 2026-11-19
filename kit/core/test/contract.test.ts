// Suite de contrat lancée sur chaque adaptateur, avec son contrôle négatif : l'adaptateur menteur
// (toujours ok: true) doit être pris en défaut sur chaque scénario où le moteur échoue.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { callAdapter, loadAdapter } from "../src/adapter/call.ts";
import { checkContract, type Finding } from "../src/adapter/contract.ts";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function workDir(name: string): string {
  const d = mkdtempSync(join(tmpdir(), `spawn-contract-${name}-`));
  dirs.push(d);
  return d;
}

const readable = (findings: Finding[]) => findings.map((c) => `- [${c.rule}] ${c.detail}`).join("\n");

test("fake adapter: contract respected", async () => {
  const findings = await checkContract(loadAdapter(here("./adapters/fake")), { workDir: workDir("fake") });
  assert.deepEqual(findings, [], readable(findings));
});

test("fake adapter: launch returns a pid at once, with or without a scene", async () => {
  const adapter = loadAdapter(here("./adapters/fake"));
  const project = workDir("fake-launch");
  assert.equal((await callAdapter(adapter, "example", { project, scenario: "healthy" })).result?.ok, true);

  const main = await callAdapter(adapter, "launch", { project });
  assert.deepEqual(main.defects, []);
  assert.ok(main.result?.ok);
  assert.equal(typeof main.result.data.pid, "number");
  assert.equal(main.result.data.scene, null);

  const scene = await callAdapter(adapter, "launch", { project, scene: "game.fx" });
  assert.ok(scene.result?.ok);
  assert.equal(scene.result.data.scene, "game.fx");

  const missing = await callAdapter(adapter, "launch", { project, scene: "missing.fx" });
  assert.equal(missing.result?.errors[0]?.code, "scene-not-found");
});

test("liar adapter: caught on every expected failure", async () => {
  const findings = await checkContract(loadAdapter(here("./adapters/liar")), { workDir: workDir("liar") });
  const rules = new Set(findings.map((c) => c.rule));
  for (const expected of [
    "launch",
    "new-project",
    "scenario code-error",
    "scenario runtime-error",
    "scenario failing-test",
    "scenario test-not-loaded",
    "scenario no-tests",
    "scenario invalid-scene",
    "scenario no-main-scene",
    "scenario empty-main-scene",
  ]) {
    assert.ok(rules.has(expected), `règle « ${expected} » non relevée sur le menteur :\n${readable(findings)}`);
  }
  assert.ok(!rules.has("scenario healthy"), `le scénario healthy ne doit rien relever :\n${readable(findings)}`);
});

test("not_applicable: declared checks are skipped and said, the others still judged", async () => {
  const liar = loadAdapter(here("./adapters/liar"));
  const adapter = { ...liar, descriptor: { ...liar.descriptor, not_applicable: ["invalid-scene" as const, "empty-main-scene" as const] } };
  const skipped: string[] = [];
  const findings = await checkContract(adapter, { workDir: workDir("liar-not-applicable"), onSkip: (check) => skipped.push(check) });
  const rules = new Set(findings.map((c) => c.rule));
  assert.deepEqual(skipped, ["invalid-scene", "empty-main-scene"]);
  assert.ok(!rules.has("scenario invalid-scene") && !rules.has("scenario empty-main-scene"), readable(findings));
  for (const expected of ["new-project", "scenario code-error", "scenario no-main-scene"]) assert.ok(rules.has(expected), expected);
});

test("not_applicable: an unknown check or healthy is refused in adapter.json", () => {
  for (const value of [["healthy"], ["no-such-check"], "invalid-scene"]) {
    const dir = workDir("descriptor");
    writeFileSync(join(dir, "adapter.json"), JSON.stringify({ contract: 1, engine: "x", command: ["node", "cli.ts"], not_applicable: value }));
    assert.throws(() => loadAdapter(dir), /not_applicable/, JSON.stringify(value));
  }
});

// Node : rien d'externe (node et npm du PATH) ; sans Edge, les captures sont sautées et la suite le dit.
test("Node adapter: contract respected", { timeout: 10 * 60_000 }, async (t) => {
  const adapter = loadAdapter(here("../../engines/node"));
  const tools = (await callAdapter(adapter, "prerequisites")).result?.data.tools as { name: string; present: boolean }[] | undefined;
  const edge = tools?.find((x) => x.name === "edge")?.present === true;
  const findings = await checkContract(adapter, {
    workDir: workDir("node"),
    ...(edge ? {} : { skipCapture: "Edge absent de la machine : capture non vérifiée" }),
    onSkip: (check, reason) => t.diagnostic(`sauté : ${check} (${reason})`),
  });
  assert.deepEqual(findings, [], readable(findings));
});

// Godot se trouve seul (variable, réglage machine, PATH ou recherche) ; introuvable, l'adaptateur le dit dans
// les constats. SPAWN_NO_GODOT=1 saute le test explicitement.
const withoutGodot = process.env.SPAWN_NO_GODOT === "1";

test("Godot adapter: contract respected", { skip: withoutGodot && "SPAWN_NO_GODOT=1 : Godot non testé", timeout: 15 * 60_000 }, async () => {
  const findings = await checkContract(loadAdapter(here("../../engines/godot")), { workDir: workDir("godot") });
  assert.deepEqual(findings, [], readable(findings));
});
