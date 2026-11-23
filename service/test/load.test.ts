// Charge de la machine (docs/reglages.md §3.2) : au-delà de la limite de stories au travail, une story lancée attend sa
// place ; quand une se libère, démarre celle du premier projet de l'ordre choisi, puis dans l'ordre de son Backlog.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { AgentAdapter } from "../../kit/core/src/agent/type.ts";
import { git } from "../../kit/core/src/git.ts";
import { createStory } from "../../kit/core/src/stories.ts";
import { cleanDirs, spawnProject, tempDir } from "../../kit/core/test/git-helper.ts";
import { backlogModule } from "../src/modules/backlog.ts";
import { conversationModule } from "../src/modules/conversation.ts";
import { projectsModule } from "../src/modules/projects.ts";
import { storiesModule } from "../src/modules/stories.ts";
import { startService, type Service } from "../src/server.ts";

process.env.SPAWN_ENGINES = fileURLToPath(new URL("../../kit/core/test/adapters/", import.meta.url));
const services: Service[] = [];
beforeEach(() => {
  // Réglages et registre propres à chaque cas : la limite et l'ordre sont ceux de la machine.
  process.env.SPAWN_CONFIG = tempDir("config-load");
});
afterEach(async () => {
  for (const s of services.splice(0)) await s.close();
});
after(cleanDirs);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- réponses JSON lues champ par champ dans les assertions
type Body = Record<string, any>;

// Un tour dure jusqu'à Stop : on voit qui tient une place et qui attend.
function holdingAgent(started: string[]): AgentAdapter {
  return {
    name: "claude-code",
    async turn({ dir, output, signal }) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(output, "");
      started.push(dir.replace(/\\/g, "/").split("/").at(-1) ?? "");
      await new Promise<void>((ok) => (signal?.aborted ? ok() : signal?.addEventListener("abort", () => ok(), { once: true })));
      return { code: null, session: "s" };
    },
    read: () => [],
    maxContext: () => Promise.resolve(null),
    check: () => Promise.resolve([]),
    measure: () => Promise.resolve(null),
  };
}

async function machine() {
  const started: string[] = [];
  const conversation = conversationModule(() => holdingAgent(started), { autoRestart: false, runner: false });
  const s = await startService({ modules: [projectsModule, storiesModule, conversation, backlogModule(conversation)], log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, { method, headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: (await r.json()) as Body };
  };
  for (const m of ["stories", "conversation", "backlog"]) await api("PUT", `/api/modules/${m}`, { active: true });
  const project = async () => {
    const root = spawnProject();
    return { root, id: (await api("POST", "/api/projects", { dir: root })).body.id as string };
  };
  const say = (id: string, story: string, message = "go") => api("POST", `/api/projects/${id}/stories/${story}/conversation`, { message });
  const stop = (id: string, story: string) => api("POST", `/api/projects/${id}/stories/${story}/conversation/stop`);
  return { api, project, say, stop, started };
}

async function waitUntil(condition: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error("délai dépassé");
    await new Promise((ok) => setTimeout(ok, 50));
  }
}

test("load: beyond the limit a story waits with its rank, its message kept, and starts when a place frees", async () => {
  const m = await machine();
  const p = await m.project();
  assert.equal((await m.api("PUT", "/api/load", { stories: 1 })).status, 200);
  assert.equal((await m.say(p.id, "alpha")).body.turn, 1);
  await waitUntil(() => m.started.length === 1);

  createStory(p.root, { story: "beta", branch: "feature/beta", worktree: null, base: git(p.root, ["rev-parse", "HEAD"]).stdout.trim() });
  const queued = await m.say(p.id, "beta", "à faire");
  assert.equal(typeof queued.body.queued, "string", "le message attend dans la file de la story");
  const load = (await m.api("GET", "/api/load")).body;
  assert.deepEqual(load.running, [{ project: p.id, story: "alpha" }]);
  assert.deepEqual(load.waiting, [{ project: p.id, story: "beta", rank: 1 }]);
  assert.equal((await m.api("GET", `/api/projects/${p.id}/backlog`)).body.find((s: Body) => s.story === "beta")?.place, 1);

  await new Promise((ok) => setTimeout(ok, 300));
  assert.deepEqual(m.started, ["alpha"], "rien ne démarre sans place");
  await m.stop(p.id, "alpha");
  await waitUntil(() => m.started.length === 2);
  assert.deepEqual(m.started, ["alpha", "beta"]);
  const state = JSON.parse(readFileSync(join(p.root, ".spawn", "conversations", "beta", "state.json"), "utf8")) as { turns: { message: string }[] };
  assert.equal(state.turns.at(-1)?.message, "à faire");
  assert.deepEqual((await m.api("GET", "/api/load")).body.waiting, []);
});

test("load: the first project of the chosen order goes first, then the Backlog order, then the oldest", async () => {
  const m = await machine();
  const a = await m.project();
  const b = await m.project();
  await m.api("PUT", "/api/load", { stories: 1 });
  await m.say(a.id, "tient");
  await waitUntil(() => m.started.length === 1);
  await m.say(a.id, "a-un");
  await m.say(a.id, "a-deux");
  await m.say(b.id, "b-un");
  const ranks = async () => ((await m.api("GET", "/api/load")).body.waiting as Body[]).map((w) => w.story);
  assert.deepEqual(await ranks(), ["a-un", "a-deux", "b-un"], "sans ordre : projets dans l'ordre d'inscription, puis la plus ancienne");

  await m.api("PUT", "/api/load", { projects: [b.id, a.id] });
  assert.deepEqual(await ranks(), ["b-un", "a-un", "a-deux"]);
  assert.equal((await m.api("PUT", `/api/projects/${a.id}/backlog/order`, { stories: ["a-deux", "a-un"] })).status, 200);
  assert.deepEqual(await ranks(), ["b-un", "a-deux", "a-un"]);
  assert.deepEqual(((await m.api("GET", "/api/load")).body.projects as Body[]).map((p) => p.id), [b.id, a.id]);

  await m.stop(a.id, "tient");
  await waitUntil(() => m.started.length === 2);
  assert.equal(m.started[1], "b-un");
});

test("load: Stop takes a waiting story out of the queue, its message stays", async () => {
  const m = await machine();
  const p = await m.project();
  await m.api("PUT", "/api/load", { stories: 1 });
  await m.say(p.id, "alpha");
  await waitUntil(() => m.started.length === 1);
  await m.say(p.id, "beta", "garde-moi");
  assert.equal((await m.stop(p.id, "beta")).status, 200);
  assert.deepEqual((await m.api("GET", "/api/load")).body.waiting, []);
  assert.equal((await m.api("GET", `/api/projects/${p.id}/stories/beta/conversation`)).body.queued[0]?.message, "garde-moi");
  await m.stop(p.id, "alpha");
  await new Promise((ok) => setTimeout(ok, 300));
  assert.deepEqual(m.started, ["alpha"], "retirée de la file : elle ne démarre pas");
});

test("load: raising the limit starts the waiting stories at once; out-of-bounds values are refused", async () => {
  const m = await machine();
  const p = await m.project();
  await m.api("PUT", "/api/load", { stories: 1 });
  await m.say(p.id, "alpha");
  await waitUntil(() => m.started.length === 1);
  await m.say(p.id, "beta");
  await m.api("PUT", "/api/load", { stories: 2 });
  await waitUntil(() => m.started.length === 2);

  assert.equal((await m.api("PUT", "/api/load", { stories: 0 })).status, 400);
  assert.equal((await m.api("PUT", "/api/load", { agents: 21 })).status, 400);
  assert.equal((await m.api("PUT", "/api/load", { projects: "x" })).status, 400);
  const app = JSON.parse(readFileSync(join(process.env.SPAWN_CONFIG ?? "", "app.json"), "utf8")) as Body;
  assert.deepEqual(app.load, { stories: 2, agents: 4, projects: [] });
  assert.ok(app.modules, "les modules restent écrits à côté");
  await m.stop(p.id, "alpha");
  await m.stop(p.id, "beta");
});
