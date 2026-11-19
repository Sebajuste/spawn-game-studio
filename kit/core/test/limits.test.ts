// Limites du projet (spawn.json) et registre des sous-agents en cours.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { RESERVATION_DURATION_MS, start, running, reserve, stop } from "../src/agents.ts";
import { readStory } from "../src/stories.ts";
import { createWorktree } from "../src/hooks/worktree.ts";
import { DEFAULT_LIMITS, readConfig } from "../src/project.ts";
import { tempDir, cleanDirs, spawnProject } from "./git-helper.ts";

after(cleanDirs);
const ENGINES = fileURLToPath(new URL("./adapters/", import.meta.url));
const HOOK = fileURLToPath(new URL("../src/hooks/agents.ts", import.meta.url));

test("limits: defaults, partial override, reasoned refusals", () => {
  const d = tempDir("limits");
  const write = (limits: unknown) => {
    writeFileSync(join(d, "spawn.json"), JSON.stringify({ engine: "godot", version: "4.7.2", ...(limits === undefined ? {} : { limits }) }));
    return join(d, "spawn.json");
  };
  assert.deepEqual(readConfig(write(undefined)).limits, DEFAULT_LIMITS);
  assert.deepEqual(readConfig(write({ parallel_agents: 2 })).limits, { ...DEFAULT_LIMITS, parallel_agents: 2 });
  assert.throws(() => readConfig(write({ parallel_agents: 0 })), /parallel_agents.*entier de 1 à 10/);
  assert.throws(() => readConfig(write({ rounds: 2.5 })), /rounds/);
  assert.throws(() => readConfig(write({ subagents: 3 })), /limite inconnue subagents/);
});

test("registry: reservation, start, stop; the limit counts running agents and recent reservations", () => {
  const root = tempDir("registry");
  const t0 = new Date("2026-11-18T10:00:00Z");
  assert.equal(reserve(root, 2, "appel-1", t0).allowed, true);
  assert.equal(reserve(root, 2, "appel-2", t0).allowed, true);
  const refusal = reserve(root, 2, "appel-3", t0);
  assert.equal(refusal.allowed, false, "deux lancements en attente occupent la limite");
  assert.match(refusal.allowed ? "" : refusal.reason, /limite parallel_agents = 2.*Ensuite : attendre/);

  start(root, { agent_id: "a1", agent_type: "spawnstudio:implementer", story: null }, t0);
  assert.deepEqual(running(root, t0.getTime()), { agents: [{ agent_id: "a1", agent_type: "spawnstudio:implementer", story: null, since: t0.toISOString() }], reservations: 1 });
  start(root, { agent_id: "a1", agent_type: "spawnstudio:implementer", story: null }, t0);
  assert.equal(running(root, t0.getTime()).reservations, 1, "une reprise du même agent ne consomme pas de réservation");
  stop(root, "a1");
  assert.equal(running(root, t0.getTime()).agents.length, 0);

  const later = new Date(t0.getTime() + RESERVATION_DURATION_MS + 1);
  assert.equal(running(root, later.getTime()).reservations, 0, "une réservation jamais suivie d'un démarrage expire");
  assert.equal(reserve(root, 2, "appel-4", later).allowed, true);
});

test("story subagents kept up to date by start and stop", async () => {
  const root = spawnProject();
  await createWorktree({ cwd: root, name: "grille" }, { engines: ENGINES, log: () => {} });
  start(root, { agent_id: "a7", agent_type: "spawnstudio:task-reviewer", story: "grille" });
  assert.deepEqual(readStory(root, "grille")?.subagents, ["a7"]);
  stop(root, "a7");
  assert.deepEqual(readStory(root, "grille")?.subagents, []);
});

function hook(action: string, input: object) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [HOOK, action], { input: JSON.stringify(input), encoding: "utf8", env });
  return { code: r.status, stderr: r.stderr };
}

test("real hook: the extra agent is refused with exit 2; unreadable input blocks too", () => {
  const root = spawnProject();
  writeFileSync(join(root, "spawn.json"), JSON.stringify({ engine: "fake", version: "1.0", limits: { parallel_agents: 1 } }));
  assert.equal(hook("reserve", { cwd: root, tool_use_id: "t1" }).code, 0);
  assert.equal(hook("start", { cwd: root, agent_id: "x1", agent_type: "spawnstudio:implementer" }).code, 0);
  const refusal = hook("reserve", { cwd: root, tool_use_id: "t2" });
  assert.equal(refusal.code, 2);
  assert.match(refusal.stderr, /limite parallel_agents = 1/);
  assert.equal(hook("stop", { cwd: root, agent_id: "x1" }).code, 0);
  assert.equal(hook("reserve", { cwd: root, tool_use_id: "t3" }).code, 0, "place libérée");
  assert.equal(hook("start", { cwd: root, agent_id: "interne", agent_type: "" }).code, 0, "agent interne ignoré");
  const d = tempDir("hors-projet");
  assert.equal(hook("reserve", { cwd: d, tool_use_id: "t4" }).code, 0, "hors projet Spawn : rien");
  const broken = spawnSync(process.execPath, [HOOK, "reserve"], { input: "{pas du json", encoding: "utf8" });
  assert.equal(broken.status, 2, "panne : bloque");
});
