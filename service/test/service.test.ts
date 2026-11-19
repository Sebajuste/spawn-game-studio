// Service de l'app : jeton, modules qu'on éteint (routes absentes, dépendants éteints, socle intouchable), projets, stories.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ledgerPath } from "../../kit/core/src/context.ts";
import { createWorktree } from "../../kit/core/src/hooks/worktree.ts";
import { write } from "../../kit/core/src/ledger.ts";
import { tempDir, cleanDirs, spawnProject } from "../../kit/core/test/git-helper.ts";
import { configPath, readConfig } from "../src/config.ts";
import { resolveModules, type ServiceModule } from "../src/module.ts";
import { MODULES } from "../src/modules/index.ts";
import { startService, type Service } from "../src/server.ts";

process.env.SPAWN_ENGINES = fileURLToPath(new URL("../../kit/core/test/adapters/", import.meta.url));
const services: Service[] = [];
after(async () => {
  for (const s of services) await s.close();
  cleanDirs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- réponses JSON lues champ par champ dans les assertions
type Body = Record<string, any>;

async function service(modules: readonly ServiceModule[] = MODULES): Promise<{ s: Service; api: (method: string, path: string, body?: unknown, token?: string) => Promise<{ status: number; body: Body }> }> {
  const s = await startService({ modules, log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown, token = s.token) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as Body };
  };
  return { s, api };
}

const dummy = (id: string, dependencies: string[] = [], defaultOn = true, core = false): ServiceModule => ({
  id,
  title: id.toUpperCase(),
  description: "",
  defaultOn,
  core,
  dependencies,
  start({ routes }) {
    routes.add("GET", `/api/${id}`, () => ({ here: id }));
  },
});

test("module resolution: config, default, a disabled dependency disables and says so, core always active", () => {
  const modules = [dummy("a", [], true, true), dummy("b", ["a"]), dummy("c", ["b"]), dummy("d", [], false)];
  const state = (wanted: Record<string, boolean>) => Object.fromEntries(resolveModules(modules, wanted).map((e) => [e.id, e.active]));
  assert.deepEqual(state({}), { a: true, b: true, c: true, d: false });
  assert.deepEqual(state({ b: false }), { a: true, b: false, c: false, d: false });
  assert.match(resolveModules(modules, { b: false }).find((e) => e.id === "c")?.reason ?? "", /dépend de « B », éteint/);
  assert.deepEqual(state({ a: false, d: true }), { a: true, b: true, c: true, d: true }, "le socle ne s'éteint pas");
  assert.throws(() => resolveModules([dummy("x", ["y"]), dummy("y", ["x"])], {}), /circulaire/);
});

test("app config: module ids from before the English naming are read under their new name", () => {
  const previous = process.env.SPAWN_CONFIG;
  process.env.SPAWN_CONFIG = tempDir("config");
  try {
    writeFileSync(configPath(), JSON.stringify({ modules: { galerie: false, "barre-etat": false, files: true, fichiers: false } }));
    assert.deepEqual(readConfig().modules, { gallery: false, "status-bar": false, files: true });
  } finally {
    if (previous === undefined) delete process.env.SPAWN_CONFIG;
    else process.env.SPAWN_CONFIG = previous;
  }
});

test("token required; a disabled module has no route; the toggle is remembered and refused on core", async () => {
  const { api } = await service([dummy("a", [], true, true), dummy("b", ["a"]), dummy("c", ["b"])]);
  assert.equal((await api("GET", "/api/b", undefined, "faux")).status, 401);
  assert.deepEqual((await api("GET", "/api/c")).body, { here: "c" });

  const toggled = await api("PUT", "/api/modules/b", { active: false });
  assert.equal(toggled.status, 200);
  assert.equal((await api("GET", "/api/b")).status, 404);
  assert.equal((await api("GET", "/api/c")).status, 404, "le dépendant s'éteint avec");
  assert.match((await api("GET", "/api/c")).body.error, /module éteint/);

  const restarted = await service([dummy("a", [], true, true), dummy("b", ["a"]), dummy("c", ["b"])]);
  assert.equal((await restarted.api("GET", "/api/b")).status, 404, "l'état est retenu dans ~/.spawn/app.json");
  assert.equal((await api("PUT", "/api/modules/a", { active: false })).status, 409);
  assert.equal((await api("PUT", "/api/modules/b", { active: "oui" })).status, 400);
  await api("PUT", "/api/modules/b", { active: true });
  assert.deepEqual((await api("GET", "/api/c")).body, { here: "c" });
});

test("projects and stories: registration, list, story detail with ledger and next step", async () => {
  const root = spawnProject();
  await createWorktree({ cwd: root, name: "grille" }, { log: () => {} });
  write(ledgerPath(root, "grille"), { date: "2026-11-18T10:00:00.000Z", type: "spec-approved", path: "docs/specs/s.md" });
  const { api } = await service();

  assert.equal((await api("POST", "/api/projects", { dir: tempDir("pas-un-projet") })).status, 400);
  const registered = (await api("POST", "/api/projects", { dir: root })).body;
  assert.equal(registered.engine, "fake");
  assert.equal(registered.open_stories, 1);
  assert.equal((await api("GET", "/api/projects")).body.length >= 1, true);

  const stories = (await api("GET", `/api/projects/${registered.id}/stories`)).body;
  assert.equal(stories[0].story, "grille");
  assert.equal(stories[0].step, "plan");
  const detail = (await api("GET", `/api/projects/${registered.id}/stories/grille`)).body;
  assert.match(detail.ledger[0], /spec/);
  assert.equal(detail.next.step, "plan");
  assert.equal((await api("GET", `/api/projects/${registered.id}/stories/absent`)).status, 404);

  await api("PUT", "/api/modules/stories", { active: false });
  assert.equal((await api("GET", `/api/projects/${registered.id}/stories`)).status, 404, "module stories éteint");
  assert.equal((await api("GET", "/api/projects")).status, 200, "le socle reste");
  await api("PUT", "/api/modules/stories", { active: true });
  assert.equal((await api("DELETE", `/api/projects/${registered.id}`)).status, 200);
});

test("event stream: module states first, then « stories » when a story changes", async () => {
  const root = spawnProject();
  const { s, api } = await service();
  const registered = (await api("POST", "/api/projects", { dir: root })).body;
  await api("PUT", "/api/modules/stories", { active: true });
  const controller = new AbortController();
  const r = await fetch(`http://127.0.0.1:${s.port}/api/events?token=${s.token}`, { signal: controller.signal });
  const reader = r.body?.getReader();
  assert.ok(reader);
  let text = "";
  const waitFor = async (pattern: RegExp) => {
    const end = Date.now() + 10_000;
    // Une lecture sans donnée bloque : chaque attente est bornée, sinon le test pendrait au lieu d'échouer.
    while (!pattern.test(text) && Date.now() < end) {
      const read = await Promise.race([reader.read(), new Promise<null>((ok) => setTimeout(() => ok(null), end - Date.now()))]);
      if (read === null || read.done) break;
      text += new TextDecoder().decode(read.value);
    }
    return pattern.test(text);
  };
  assert.ok(await waitFor(/event: modules/));
  await createWorktree({ cwd: root, name: "saut" }, { log: () => {} });
  assert.ok(await waitFor(new RegExp(`event: stories\\ndata: \\{"project":"${registered.id}"\\}`)), text);
  controller.abort();
});
