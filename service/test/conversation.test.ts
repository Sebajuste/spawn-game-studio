// Module conversation : tour lancé dans le worktree de la story, événements poussés au fil de l'eau, session reprise,
// Stop, refus de l'adaptateur montré, un seul tour à la fois ; et les modules de vue qui s'éteignent avec lui.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { cleanDirs, spawnProject } from "../../kit/core/test/git-helper.ts";
import type { ServiceModule } from "../src/module.ts";
import { conversationModule, type AgentFactory } from "../src/modules/conversation.ts";
import { fakeAgent, SESSION } from "./fake-agent.ts";
import { readClaude } from "../../kit/core/src/agent/claude.ts";
import type { AgentAdapter } from "../../kit/core/src/agent/type.ts";
import { storiesModule } from "../src/modules/stories.ts";
import { projectsModule } from "../src/modules/projects.ts";
import { activityModule, contextModule } from "../src/modules/views.ts";
import { startService, type Service } from "../src/server.ts";
import { join } from "node:path";
import { ledgerPath } from "../../kit/core/src/context.ts";
import { write } from "../../kit/core/src/ledger.ts";
import { readStory, updateStory } from "../../kit/core/src/stories.ts";

process.env.SPAWN_ENGINES = fileURLToPath(new URL("../../kit/core/test/adapters/", import.meta.url));
const services: Service[] = [];
after(async () => {
  for (const s of services) await s.close();
  cleanDirs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- réponses JSON lues champ par champ dans les assertions
type Body = Record<string, any>;

async function service(factory: AgentFactory, extra: ServiceModule[] = [], conv: ServiceModule = conversationModule(factory, { autoRestart: false })) {
  const s = await startService({ modules: [projectsModule, storiesModule, conv, ...extra], log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as Body };
  };
  for (const m of ["stories", "conversation", "activity", "context"]) await api("PUT", `/api/modules/${m}`, { active: true });
  const root = spawnProject();
  const id = (await api("POST", "/api/projects", { dir: root })).body.id as string;
  return { s, api, root, id };
}

async function waitUntil(condition: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error("délai dépassé");
    await new Promise((ok) => setTimeout(ok, 50));
  }
}

test("conversation: first message in the worktree created for the story, stream read, session resumed on the next message", async () => {
  const { factory, calls } = fakeAgent();
  const { s, api, root, id } = await service(factory);
  const path = `/api/projects/${id}/stories/grille/conversation`;

  // Le flux d'événements reçoit les événements du tour pendant qu'il tourne.
  const controller = new AbortController();
  const stream = await fetch(`http://127.0.0.1:${s.port}/api/events?token=${s.token}`, { signal: controller.signal });
  const reader = stream.body?.getReader();
  let text = "";

  assert.equal((await api("POST", path, { message: "Lis a.txt" })).body.turn, 1);
  assert.equal((await api("POST", path, { message: "encore" })).status, 200, "pendant un tour, le message est mis en file");
  await waitUntil(async () => !(await api("GET", path)).body.running);

  const end = Date.now() + 2000;
  while (reader && !/event: conversation-end/.test(text) && Date.now() < end) {
    const read = await Promise.race([reader.read(), new Promise<null>((ok) => setTimeout(() => ok(null), 500))]);
    if (read === null || read.done) break;
    text += new TextDecoder().decode(read.value);
  }
  controller.abort();
  assert.match(text, /event: conversation\ndata: .*"type":"tool".*"name":"Read"/);
  assert.match(text, /event: conversation-end\ndata: \{"project":"[^"]+","story":"grille","turn":1,"code":0/);

  const v = (await api("GET", path)).body;
  assert.equal(v.agent, "claude-code");
  assert.equal(v.session, SESSION);
  assert.deepEqual(v.turns[0].events.map((e: Body) => e.type), ["start", "tool", "usage", "tool-result", "text", "usage", "end"]);
  assert.match(calls[0]?.dir ?? "", /[\\/]\.claude[\\/]worktrees[\\/]grille$/);
  assert.ok(existsSync(calls[0]?.dir ?? ""), "le worktree de la story est créé au premier message");

  await api("POST", path, { message: "Et maintenant ?" });
  await waitUntil(async () => !(await api("GET", path)).body.running);
  // Tour 2 : le message mis en file pendant le tour 1 ; tour 3 : « Et maintenant ? ».
  assert.deepEqual(calls.map((a) => a.session), [null, SESSION, SESSION], "la session est reprise");
  assert.equal(calls[1]?.message, "encore");
  assert.equal(calls[1]?.dir, calls[0]?.dir);
  assert.ok(existsSync(`${root}/.spawn/conversations/grille/turn-3.jsonl`));
});

// Agent dont chaque tour attend qu'on le libère : permet d'envoyer des messages « pendant le tour ».
function gatedAgent() {
  const messages: string[] = [];
  const gates: (() => void)[] = [];
  const agent: AgentAdapter = {
    name: "claude-code",
    async turn({ message, output }) {
      messages.push(message);
      writeFileSync(output, "");
      await new Promise<void>((ok) => gates.push(ok));
      return { code: 0, session: "s" };
    },
    read: readClaude,
    maxContext: async () => null,
    check: async () => [],
    measure: async () => null,
  };
  return { factory: (() => agent) as AgentFactory, messages, release: () => gates.shift()?.() };
}

test("conversation: messages sent during a turn are queued, leave together in order at its end, a removed one never leaves", async () => {
  const g = gatedAgent();
  const { api, id } = await service(g.factory);
  const path = `/api/projects/${id}/stories/file/conversation`;
  assert.equal((await api("POST", path, { message: "premier" })).body.turn, 1);
  await waitUntil(async () => g.messages.length === 1);

  const a = await api("POST", path, { message: "a" });
  const b = await api("POST", path, { message: "b" });
  const c = await api("POST", path, { message: "c" });
  for (const r of [a, b, c]) {
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.queued, "string");
  }
  assert.deepEqual((await api("GET", path)).body.queued.map((q: Body) => q.message), ["a", "b", "c"]);

  // Contrôle négatif : « c » retiré ne part pas.
  assert.equal((await api("DELETE", `${path}/queue/${c.body.queued}`)).status, 200);
  assert.deepEqual((await api("GET", path)).body.queued.map((q: Body) => q.message), ["a", "b"]);

  g.release();
  await waitUntil(async () => g.messages.length === 2);
  assert.equal(g.messages[1], "a\n\nb", "un seul nouveau tour, dans l'ordre, sans « c »");
  assert.deepEqual((await api("GET", path)).body.queued, []);

  // Contrôle négatif : retirer un message déjà parti est refusé.
  assert.equal((await api("DELETE", `${path}/queue/${a.body.queued}`)).status, 409);
  assert.equal((await api("DELETE", `${path}/queue/inconnu`)).status, 409);
  g.release();
  await waitUntil(async () => !(await api("GET", path)).body.running);
  assert.equal(g.messages.length, 2, "rien d'autre n'est parti");
});

test("conversation: during a hold (merge) messages wait and leave at its end; a reminder goes first, in a single turn", async () => {
  const g = gatedAgent();
  const conv = conversationModule(g.factory, { autoRestart: false });
  const { api, id } = await service(g.factory, [], conv);
  const path = `/api/projects/${id}/stories/fusion/conversation`;

  let done: () => void = () => {};
  conv.hold(id, "fusion", new Promise<void>((ok) => (done = ok)));
  assert.equal(typeof (await api("POST", path, { message: "pendant" })).body.queued, "string");
  await new Promise((ok) => setTimeout(ok, 300));
  assert.equal(g.messages.length, 0, "rien ne part avant la fin de la fusion");
  done();
  await waitUntil(async () => g.messages.length === 1);
  assert.equal(g.messages[0], "pendant");
  g.release();
  await waitUntil(async () => !(await api("GET", path)).body.running);

  // Fusion refusée : le rappel de l'agent part en tête, avec le message en file, en un seul tour.
  let end: () => void = () => {};
  conv.hold(id, "fusion", new Promise<void>((ok) => (end = ok)));
  await api("POST", path, { message: "de l'utilisateur" });
  await conv.send(id, "fusion", "rappel", undefined, { head: true });
  end();
  await waitUntil(async () => g.messages.length === 2);
  assert.equal(g.messages[1], "rappel\n\nde l'utilisateur");
  g.release();
});

// Fusionnée pendant le tour (spawn merge de l'orchestrateur) : le worktree se range quand le tour finit, l'agent n'y
// est plus ; depuis le worktree, le rangement échouait (essai du 18/11).
test("conversation: a story merged during the turn is tidied at its end", async () => {
  let root = "";
  const { factory } = fakeAgent({
    during: () => {
      updateStory(root, "grille", { status: "done" });
      write(ledgerPath(root, "grille"), { date: new Date().toISOString(), type: "merged", commit: "abc1234def" });
    },
  });
  const service_ = await service(factory);
  root = service_.root;
  const path = `/api/projects/${service_.id}/stories/grille/conversation`;
  await service_.api("POST", path, { message: "fusionne" });
  await waitUntil(async () => readStory(root, "grille")?.status === "cleaned");
  assert.ok(!existsSync(join(root, ".claude", "worktrees", "grille")));
});

test("conversation: Stop ends the turn; an adapter refusal prevents the turn and shows", async () => {
  const blocked = fakeAgent({ blocking: true });
  const { api, id } = await service(blocked.factory);
  const path = `/api/projects/${id}/stories/stop/conversation`;
  assert.equal((await api("POST", `${path}/stop`)).status, 409);
  await api("POST", path, { message: "travaille" });
  await waitUntil(async () => blocked.calls.length === 1);
  assert.equal((await api("POST", `${path}/stop`)).body.stopped, true);
  await waitUntil(async () => !(await api("GET", path)).body.running);
  assert.equal((await api("GET", path)).body.turns[0].stopped, true);

  const refusing = fakeAgent({ refusals: ["le plugin de périmètre OpenCode n'a rien refusé : essai annulé"] });
  const r = await service(refusing.factory);
  const p2 = `/api/projects/${r.id}/stories/refus/conversation`;
  await r.api("POST", p2, { message: "x", agent: "opencode" });
  await waitUntil(async () => !(await r.api("GET", p2)).body.running);
  const t = (await r.api("GET", p2)).body.turns[0];
  assert.match(t.refused[0], /périmètre/);
  assert.equal(refusing.calls.length, 0, "aucun tour lancé sans garde-fou");

  assert.equal((await api("POST", `/api/projects/${id}/stories/Pas%20bon/conversation`, { message: "x" })).status, 400);
  assert.equal((await api("POST", path, { message: "x", agent: "gpt" })).status, 400);
});

test("interruption: closing the app mid-turn marks it interrupted; on restart the same session resumes on its own", async () => {
  const first = fakeAgent({ blocking: true });
  const { s, api, root, id } = await service(first.factory);
  const path = `/api/projects/${id}/stories/coupe/conversation`;
  await api("POST", path, { message: "Fais la grille" });
  // La session est écrite dès l'événement de début, avant la fin du tour.
  await waitUntil(async () => (await api("GET", path)).body.session !== null);
  const session = (await api("GET", path)).body.session as string;
  await s.close();
  services.splice(services.indexOf(s), 1);
  const cut = JSON.parse(readFileSync(`${root}/.spawn/conversations/coupe/state.json`, "utf8")) as Body;
  assert.equal(cut.turns[0].interrupted, true, "fermer l'app coupe le tour, ce n'est pas un Stop");
  assert.equal(cut.turns[0].stopped, false);

  // Sans reprise automatique, la story se montre coupée et « resume » relance la session.
  const manual = await startService({ modules: [projectsModule, storiesModule, conversationModule(fakeAgent().factory, { autoResume: false, autoRestart: false })], log: () => {} });
  const seen = (await (await fetch(`http://127.0.0.1:${manual.port}/api/projects/${id}/stories`, { headers: { authorization: `Bearer ${manual.token}` } })).json()) as Body[];
  assert.equal(seen.find((f) => f.story === "coupe")?.interrupted, true);
  await manual.close();

  // Redémarrage normal : la session reprend sans personne, avec une consigne de reprise.
  const next = fakeAgent();
  const s2 = await startService({ modules: [projectsModule, storiesModule, conversationModule(next.factory, { autoRestart: false })], log: () => {} });
  services.push(s2);
  const api2 = async (method: string, p: string) => {
    const r = await fetch(`http://127.0.0.1:${s2.port}${p}`, { method, headers: { authorization: `Bearer ${s2.token}` } });
    return { status: r.status, body: (await r.json()) as Body };
  };
  await waitUntil(async () => next.calls.length === 1 && !(await api2("GET", path)).body.running);
  assert.equal(next.calls[0]?.session, session, "la même session est reprise");
  assert.match(next.calls[0]?.message ?? "", /coupée[\s\S]*git status[\s\S]*next/);
  assert.equal((await api2("POST", `/api/projects/${id}/stories/jamais/conversation/resume`)).status, 409, "aucun tour : rien à reprendre");
  assert.equal(((await api2("GET", `/api/projects/${id}/stories`)).body as Body[]).find((f) => f.story === "coupe")?.interrupted, false);
});

test("view modules: context gauge served by the adapter; everything turns off with the conversation", async () => {
  const { factory } = fakeAgent();
  const { api, id } = await service(factory, [activityModule, contextModule(factory)]);
  assert.deepEqual((await api("GET", `/api/projects/${id}/context/claude-code`)).body, { max: 120_000 });
  await api("PUT", "/api/modules/conversation", { active: false });
  const states = (await api("GET", "/api/modules")).body as Body[];
  assert.deepEqual(states.filter((e) => e.active).map((e) => e.id), ["projects", "stories"]);
  assert.equal((await api("GET", `/api/projects/${id}/context/claude-code`)).status, 404);
  assert.equal((await api("GET", `/api/projects/${id}/stories/x/conversation`)).status, 404);
  await api("PUT", "/api/modules/conversation", { active: true });
});

test("auto-restart: an agent stopping for no reason is restarted while it makes progress, never on a question nor in acceptance", async () => {
  const { readClaude } = await import("../../kit/core/src/agent/claude.ts");
  const { ledgerPath } = await import("../../kit/core/src/context.ts");
  const { updateStory } = await import("../../kit/core/src/stories.ts");
  const { write } = await import("../../kit/core/src/ledger.ts");
  const { RESTART_MESSAGE } = await import("../src/modules/conversation.ts");
  const messages: string[] = [];
  let effect: (n: number) => void = () => {};
  const agent: import("../../kit/core/src/agent/type.ts").AgentAdapter = {
    name: "claude-code",
    async turn({ message, output }) {
      messages.push(message);
      writeFileSync(output, `${JSON.stringify({ type: "result", subtype: "success", result: "Résumé : tout est fait." })}
`);
      effect(messages.length);
      return { code: 0, session: "s" };
    },
    read: readClaude,
    maxContext: async () => null,
    check: async () => [],
    measure: async () => null,
  };
  const conv = conversationModule(() => agent);
  const s = await startService({ modules: [projectsModule, storiesModule, conv], log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await r.json()) as Body;
  };
  for (const m of ["stories", "conversation"]) await api("PUT", `/api/modules/${m}`, { active: true });
  const root = spawnProject();
  const id = (await api("POST", "/api/projects", { dir: root })).id as string;
  const idle = async () => waitUntil(async () => !(await api("GET", `/api/projects/${id}/stories/f/conversation`)).running);

  // Deux tours qui avancent (ledger), puis plus rien : relancé deux fois, puis encore deux sans progrès, puis il attend.
  effect = (n) => {
    if (n <= 2) write(ledgerPath(root, "f"), { date: new Date().toISOString(), type: "note", text: `tour ${n}` });
  };
  await api("POST", `/api/projects/${id}/stories/f/conversation`, { message: "Fais la grille" });
  await waitUntil(async () => messages.length >= 4 && !(await api("GET", `/api/projects/${id}/stories/f/conversation`)).running);
  await new Promise((ok) => setTimeout(ok, 300));
  assert.equal(messages.length, 4, "1 + 3 relances : la 2e sans progrès arrête");
  assert.deepEqual(messages.slice(1), [RESTART_MESSAGE, RESTART_MESSAGE, RESTART_MESSAGE]);
  // Plus de relance : le fil attend l'utilisateur et le constat de l'outil passe avant le « tout est fait » de l'agent
  // (essai du 19/11 : fil resté « actif », sans signal, après deux tours sans progrès).
  assert.equal(readStory(root, "f")?.status, "blocked:decision");
  assert.match(conv.summary(id, root, "f").halted ?? "", /arrêté 2 fois de suite sans rien faire avancer.*Spawn a cessé de le relancer\. Étape où en est le fil : spec\.[\s\S]*à vérifier[\s\S]*Résumé : tout est fait/);
  updateStory(root, "f", { status: "active" });

  // Un message de l'utilisateur remet le compte à zéro ; une question posée (story bloquée) n'est pas relancée.
  effect = () => updateStory(root, "f", { status: "blocked:decision", task: "quelle couleur ?" });
  await api("POST", `/api/projects/${id}/stories/f/conversation`, { message: "Continue" });
  await idle();
  await new Promise((ok) => setTimeout(ok, 300));
  assert.equal(messages.length, 5, "question : pas de relance");

  // En recette : pas de relance non plus.
  updateStory(root, "f", { status: "active" });
  effect = () => updateStory(root, "f", { status: "in-acceptance" });
  await api("POST", `/api/projects/${id}/stories/f/conversation`, { message: "Termine" });
  await idle();
  await new Promise((ok) => setTimeout(ok, 300));
  assert.equal(messages.length, 6, "en recette : pas de relance");
});

test("timeout: a turn cut by the turn delay is marked in state.json and the restart tells the agent why", async () => {
  const { RESTART_MESSAGE, timeoutNotice } = await import("../src/modules/conversation.ts");
  const messages: string[] = [];
  const agent: AgentAdapter = {
    name: "claude-code",
    async turn({ message, output, timeoutMs }) {
      messages.push(message);
      writeFileSync(output, "");
      // Premier tour : bloqué jusqu'au délai, comme un agent qui attend une commande sans fin (essai du 19/11, tour 3 : 2 h).
      if (messages.length === 1) await new Promise((ok) => setTimeout(ok, timeoutMs + 50));
      return { code: messages.length === 1 ? 1 : 0, session: "s" };
    },
    read: readClaude,
    maxContext: async () => null,
    check: async () => [],
    measure: async () => null,
  };
  const s = await startService({ modules: [projectsModule, storiesModule, conversationModule(() => agent, { turnTimeoutMs: 300 })], log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await r.json()) as Body;
  };
  for (const m of ["stories", "conversation"]) await api("PUT", `/api/modules/${m}`, { active: true });
  const root = spawnProject();
  const id = (await api("POST", "/api/projects", { dir: root })).id as string;
  await api("POST", `/api/projects/${id}/stories/f/conversation`, { message: "Fais la grille" });
  await waitUntil(async () => messages.length >= 2 && !(await api("GET", `/api/projects/${id}/stories/f/conversation`)).running);
  assert.equal(messages[1], `${timeoutNotice(300)}\n\n${RESTART_MESSAGE}`);
  const state = JSON.parse(readFileSync(join(root, ".spawn", "conversations", "f", "state.json"), "utf8")) as { turns: { timedOut?: boolean }[] };
  assert.equal(state.turns[0]?.timedOut, true, "délai noté sur le tour coupé");
  assert.equal(state.turns[1]?.timedOut, undefined, "un tour fini à temps n'est pas marqué");
});
