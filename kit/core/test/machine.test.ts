// Charge de la machine (docs/reglages.md §3.2) : limite Agents comptée sur tous les projets inscrits, attente d'une place
// pour l'enchaîneur, une seule suite de tests à la fois, réglages gardés dans app.json à côté des autres clés.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { acquire, machineBusy, reserve, start, stop } from "../src/agents.ts";
import { DEFAULT_LOAD, readLoad, writeLoad } from "../src/load.ts";
import { LOCK_ENV, machineLock } from "../src/machine-lock.ts";
import { register } from "../src/registry.ts";
import { cleanDirs, spawnProject, tempDir } from "./git-helper.ts";

after(cleanDirs);
beforeEach(() => {
  process.env.SPAWN_CONFIG = tempDir("spawn-config-test-machine");
});

const agent = (id: string) => ({ agent_id: id, agent_type: "spawnstudio:implementer", story: null });

test("machine: the Agents limit counts every registered project, under the project's own limit", () => {
  const a = spawnProject();
  const b = spawnProject();
  register(a);
  register(b);
  start(a, agent("a1"));
  start(a, agent("a2"));
  assert.equal(machineBusy(b), 2);

  const refused = reserve(b, 3, "b1", new Date(), 2);
  assert.equal(refused.allowed, false);
  assert.match(refused.allowed ? "" : refused.reason, /2 sous-agent\(s\) déjà en cours sur la machine.*limite Agents = 2/);
  assert.equal(reserve(b, 3, "b1", new Date()).allowed, true, "sans limite de machine : celle du projet seule");
  assert.equal(reserve(b, 3, "b2", new Date(), 4).allowed, true);
  // La limite du projet reste en dessous et garde son propre message.
  start(b, agent("x"));
  const project = reserve(b, 1, "b3", new Date(), 20);
  assert.match(project.allowed ? "" : project.reason, /dans ce projet.*parallel_agents = 1/);
});

test("machine: a project outside the registry (a terminal) counts too", () => {
  const inside = spawnProject();
  register(inside);
  const outside = spawnProject();
  start(outside, agent("o1"));
  start(inside, agent("i1"));
  assert.equal(machineBusy(outside), 2);
});

test("machine: the runner waits for a place, takes it when one frees, gives up on Stop", async () => {
  const root = spawnProject();
  register(root);
  start(root, agent("tient"));
  const waits: string[] = [];
  const pending = acquire(root, 3, 1, "run-1", undefined, (r) => waits.push(r), 20);
  await new Promise((ok) => setTimeout(ok, 100));
  assert.equal(waits.length, 1, "l'attente est dite une fois");
  stop(root, "tient");
  assert.equal(await pending, true);

  start(root, agent("tient-encore"));
  const controller = new AbortController();
  const stopped = acquire(root, 3, 1, "run-2", controller.signal, undefined, 20);
  await new Promise((ok) => setTimeout(ok, 60));
  controller.abort();
  assert.equal(await stopped, false);
});

test("machine: one test suite at a time; a dead holder's lock is taken over; the holder's own suite does not wait", async (t) => {
  // Lancé par `spawn engine test`, ce test tourne lui-même sous le verrou : la variable est retirée le temps du cas.
  const inherited = process.env.SPAWN_MACHINE_LOCK;
  delete process.env.SPAWN_MACHINE_LOCK;
  t.after(() => {
    if (inherited === undefined) delete process.env.SPAWN_MACHINE_LOCK;
    else process.env.SPAWN_MACHINE_LOCK = inherited;
  });
  const release = await machineLock("test", undefined, 20);
  let second = false;
  const told: string[] = [];
  const pending = machineLock("test", (w) => told.push(w), 20).then((r) => {
    second = true;
    return r;
  });
  await new Promise((ok) => setTimeout(ok, 120));
  assert.equal(second, false, "la seconde suite attend");
  assert.equal(told.length, 1);
  release();
  (await pending)();

  const path = join(process.env.SPAWN_CONFIG ?? "", "locks", "test.lock");
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ pid: 2 ** 22 + 12345, since: new Date().toISOString() }));
  const taken = await machineLock("test", undefined, 20);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).pid, process.pid);

  process.env[LOCK_ENV] = "1";
  (await machineLock("test", undefined, 20))();
  delete process.env.SPAWN_MACHINE_LOCK;
  taken();
  assert.equal(existsSync(path), false);
});

test("machine: load settings default, bounded, and written beside the other keys", () => {
  assert.deepEqual(readLoad(), DEFAULT_LOAD);
  const app = join(process.env.SPAWN_CONFIG ?? "", "app.json");
  mkdirSync(join(app, ".."), { recursive: true });
  writeFileSync(app, JSON.stringify({ modules: { gallery: false }, load: { stories: 99, agents: 0, projects: ["p", 3] } }));
  assert.deepEqual(readLoad(), { stories: 10, agents: 1, projects: ["p"] });
  writeLoad({ stories: 3, agents: 6, projects: ["q"] });
  assert.deepEqual(JSON.parse(readFileSync(app, "utf8")), { modules: { gallery: false }, load: { stories: 3, agents: 6, projects: ["q"] } });
});
