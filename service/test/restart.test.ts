// Coupure et Stop (constats du 22/11) : un enchaîneur coupé reprend au démarrage, un Stop met en pause même pendant
// l'enchaîneur, une question après Stop ne relance rien, un sous-agent tué avec son tour rend sa place.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { running, start } from "../../kit/core/src/agents.ts";
import { ledgerPath } from "../../kit/core/src/context.ts";
import { gitOk } from "../../kit/core/src/git.ts";
import { write, type LedgerEvent } from "../../kit/core/src/ledger.ts";
import type { AgentAdapter } from "../../kit/core/src/agent/type.ts";
import { cleanDirs, spawnProject, tempDir } from"../../kit/core/test/git-helper.ts";
import { conversationModule } from "../src/modules/conversation.ts";
import { projectsModule } from "../src/modules/projects.ts";
import { storiesModule } from "../src/modules/stories.ts";
import { startService, type Service } from "../src/server.ts";

process.env.SPAWN_ENGINES = fileURLToPath(new URL("../../kit/core/test/adapters/", import.meta.url));
const services: Service[] = [];
afterEach(async () => {
  for (const s of services.splice(0)) await s.close();
});
after(cleanDirs);

const until = (signal?: AbortSignal) =>
  new Promise<void>((ok) => {
    if (!signal || signal.aborted) ok();
    else signal.addEventListener("abort", () => ok(), { once: true });
  });

interface Play {
  root: string;
  turns: string[];
  delegated: number;
  // Ce que fait l'orchestrateur à ce tour, après avoir posé spec et plan au premier.
  during?: ((dir: string, signal: AbortSignal | undefined) => Promise<void>) | undefined;
}

function agent(play: Play): AgentAdapter {
  return {
    name: "claude-code",
    async turn({ dir, message, output, signal }) {
      play.turns.push(message);
      writeFileSync(output, "");
      if (play.turns.length === 1) {
        mkdirSync(join(dir, "docs", "plans"), { recursive: true });
        writeFileSync(join(dir, "docs", "plans", "p.md"), "## Tâche 1 : grille\n");
        gitOk(dir, ["add", "-A"]);
        gitOk(dir, ["commit", "-q", "-m", "plan"]);
        const ev = (e: Record<string, unknown>) => write(ledgerPath(play.root, "grille"), { date: new Date().toISOString(), ...e } as LedgerEvent);
        ev({ type: "spec-approved", path: "docs/specs/s.md" });
        ev({ type: "plan", path: "docs/plans/p.md" });
      }
      await play.during?.(dir, signal);
      return { code: signal?.aborted ? null : 0, session: "session-service" };
    },
    async delegate({ signal }) {
      play.delegated++;
      await until(signal);
      return { code: null, session: null };
    },
    read: () => [],
    maxContext: () => Promise.resolve(null),
    check: () => Promise.resolve([]),
    measure: () => Promise.resolve(null),
  };
}

async function open(play: Play) {
  const conversation = conversationModule(() => agent(play));
  const s = await startService({ modules: [projectsModule, storiesModule, conversation], log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, { method, headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return (await r.json()) as Record<string, unknown>;
  };
  const close = async () => {
    await s.close();
    services.splice(services.indexOf(s), 1);
  };
  return { api, conversation, close };
}

async function project() {
  // Un registre par cas : au démarrage, le service marque coupés les tours de tous les projets inscrits.
  process.env.SPAWN_CONFIG = tempDir("config-test");
  const play: Play = { root: "", turns: [], delegated: 0 };
  const s = await open(play);
  for (const m of ["stories", "conversation"]) await s.api("PUT", `/api/modules/${m}`, { active: true });
  play.root = spawnProject();
  const id = (await s.api("POST", "/api/projects", { dir: play.root })).id as string;
  const path = `/api/projects/${id}/stories/grille/conversation`;
  const summary = () => s.conversation.summary(id, play.root, "grille");
  return { ...s, play, id, path, summary };
}

async function waitUntil(condition: () => boolean, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error("délai dépassé");
    await new Promise((ok) => setTimeout(ok, 50));
  }
}

const statePath = (root: string) => join(root, ".spawn", "conversations", "grille", "state.json");
type State = { turns: Record<string, unknown>[] };
const stateOf = (root: string) => JSON.parse(readFileSync(statePath(root), "utf8")) as State;

// Étude du 23/11, point 4 : au démarrage, tous les fils coupés repartaient ensemble, sans limite ; arrêter l'app ne
// rendait pas la main. Un fil coupé reste coupé jusqu'au geste de l'utilisateur.
test("restart: a chain cut by closing the app is shown interrupted and waits for Resume", async () => {
  const p = await project();
  await p.api("POST", p.path, { message: "go" });
  await waitUntil(() => p.play.delegated === 1);
  await p.close();
  assert.equal(stateOf(p.play.root).turns.at(-1)?.interrupted, true);

  const again: Play = { root: p.play.root, turns: ["déjà joué"], delegated: 0 };
  const s = await open(again);
  await new Promise((ok) => setTimeout(ok, 500));
  assert.deepEqual(again.turns, ["déjà joué"], "rien ne repart au démarrage");
  assert.equal(stateOf(p.play.root).turns.at(-1)?.interrupted, true);
  await s.api("POST", `${p.path}/resume`);
  await waitUntil(() => again.delegated === 1);
  assert.match(again.turns[1] ?? "", /coupée/);
});

test("restart: a chain cut by a crash, nothing written at the end, is interrupted too", async () => {
  const p = await project();
  await p.api("POST", p.path, { message: "go" });
  await waitUntil(() => p.play.delegated === 1);
  // L'état tel qu'un PC éteint le laisse : celui d'avant toute fermeture.
  const before = readFileSync(statePath(p.play.root), "utf8");
  await p.close();
  writeFileSync(statePath(p.play.root), before);

  await open({ root: p.play.root, turns: ["déjà joué"], delegated: 0 });
  assert.equal(stateOf(p.play.root).turns.at(-1)?.interrupted, true);
});

test("stop: during the chain it pauses; a question is answered without restarting; Resume restarts", async () => {
  const p = await project();
  await p.api("POST", p.path, { message: "go" });
  await waitUntil(() => p.play.delegated === 1);
  await p.api("POST", `${p.path}/stop`);
  await waitUntil(() => !p.summary().running);
  assert.equal(p.summary().paused, true, "en pause");
  assert.equal(p.summary().stoppedOnItsOwn, false);

  await p.api("POST", p.path, { message: "où en est-on ?" });
  await waitUntil(() => p.play.turns.length === 2);
  await waitUntil(() => !p.summary().running);
  await new Promise((ok) => setTimeout(ok, 300));
  assert.equal(p.play.delegated, 1, "rien de relancé");
  assert.equal(p.play.turns.length, 2, "aucune relance automatique");
  assert.equal(p.summary().paused, true, "toujours en pause");
  assert.equal(p.summary().stoppedOnItsOwn, false);

  await p.api("POST", `${p.path}/resume`);
  await waitUntil(() => p.play.delegated === 2);
});

test("stop: a message the agent acts on lifts the pause", async () => {
  const p = await project();
  await p.api("POST", p.path, { message: "go" });
  await waitUntil(() => p.play.delegated === 1);
  await p.api("POST", `${p.path}/stop`);
  await waitUntil(() => !p.summary().running);
  p.play.during = (dir) => {
    writeFileSync(join(dir, "reprise.txt"), "fait\n");
    gitOk(dir, ["add", "reprise.txt"]);
    gitOk(dir, ["commit", "-q", "-m", "reprise"]);
    return Promise.resolve();
  };
  await p.api("POST", p.path, { message: "corrige puis continue" });
  await waitUntil(() => p.play.delegated === 2);
});

test("subagents: a stopped turn gives its places back, not those of a live terminal", async () => {
  const p = await project();
  p.play.during = async (_dir, signal) => {
    start(p.play.root, { agent_id: "tue", agent_type: "spawnstudio:implementer", story: "grille", session: "session-service" });
    start(p.play.root, { agent_id: "terminal", agent_type: "spawnstudio:implementer", story: "grille", session: "session-terminal" });
    await until(signal);
  };
  await p.api("POST", p.path, { message: "go" });
  await waitUntil(() => running(p.play.root).agents.length === 2);
  await p.api("POST", `${p.path}/stop`);
  await waitUntil(() => !p.summary().running);
  assert.deepEqual(running(p.play.root).agents.map((a) => a.agent_id), ["terminal"]);
});

test("subagents: at startup the places of cut turns are given back, entries written before sessions were noted included", async () => {
  const p = await project();
  p.play.during = (_dir, signal) => until(signal);
  await p.api("POST", p.path, { message: "go" });
  await waitUntil(() => p.play.turns.length === 1);
  await p.close();
  const turn = stateOf(p.play.root).turns.at(-1) as { start: string; end: string };
  const type = { agent_type: "spawnstudio:implementer" };
  start(p.play.root, { ...type, agent_id: "coupe", story: "grille" }, new Date(turn.start));
  start(p.play.root, { ...type, agent_id: "apres", story: "grille" }, new Date(Date.parse(turn.end) + 1000));
  start(p.play.root, { ...type, agent_id: "autre-fil", story: "menu" }, new Date(turn.start));

  await open({ root: p.play.root, turns: ["déjà joué"], delegated: 0 });
  assert.deepEqual(running(p.play.root).agents.map((a) => a.agent_id).sort(), ["apres", "autre-fil"]);
});
