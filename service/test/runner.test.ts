// Enchaîneur dans le service : le tour de l'orchestrateur finit sur une étape que l'outil sait faire seul, le service
// l'enchaîne (implémenteur, relecteur, ledger) puis rend la main à l'orchestrateur avec le résultat. Après un échec de
// l'enchaîneur, l'orchestrateur reprend sans lui (pas de boucle).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ledgerPath } from "../../kit/core/src/context.ts";
import { gitOk } from "../../kit/core/src/git.ts";
import { write, type LedgerEvent } from "../../kit/core/src/ledger.ts";
import { renderAction, RUNNER_ENV, type Action } from "../../kit/core/src/next.ts";
import type { AgentAdapter } from "../../kit/core/src/agent/type.ts";
import { cleanDirs, spawnProject } from "../../kit/core/test/git-helper.ts";
import { conversationModule } from "../src/modules/conversation.ts";
import { projectsModule } from "../src/modules/projects.ts";
import { storiesModule } from "../src/modules/stories.ts";
import { startService, type Service } from "../src/server.ts";

process.env.SPAWN_ENGINES = fileURLToPath(new URL("../../kit/core/test/adapters/", import.meta.url));
const services: Service[] = [];
after(async () => {
  for (const s of services) await s.close();
  cleanDirs();
});

type Delegate = Parameters<NonNullable<AgentAdapter["delegate"]>>[0];
interface TurnCall {
  message: string;
  env: Record<string, string> | undefined;
}
// Les chemins des consignes sont relatifs au dossier de l'agent : ils se lisent depuis lui, comme un agent les lit.
const pathAfter = (dir: string, prompt: string, re: RegExp) => resolve(dir, re.exec(prompt)?.[1] ?? assert.fail(`chemin introuvable dans « ${prompt} »`));

// Orchestrateur : au premier tour, pose spec et plan validés (comme après `ledger plan`) puis s'arrête.
// Implémenteur et relecteur : `play` décide (rapport, verdict).
function agent(root: () => string, play: (c: Delegate) => void): { adapter: AgentAdapter; turns: TurnCall[]; delegated: Delegate[] } {
  const turns: TurnCall[] = [];
  const delegated: Delegate[] = [];
  const adapter: AgentAdapter = {
    name: "claude-code",
    turn({ dir, message, output, env }) {
      turns.push({ message, env });
      writeFileSync(output, "");
      if (turns.length === 1) {
        mkdirSync(join(dir, "docs", "specs"), { recursive: true });
        mkdirSync(join(dir, "docs", "plans"), { recursive: true });
        writeFileSync(join(dir, "docs", "specs", "s.md"), "- **GRI-01** La grille s'affiche. Preuve : test.\n");
        writeFileSync(join(dir, "docs", "plans", "p.md"), "## Tâche 1 : grille\nGRI-01\n");
        gitOk(dir, ["add", "-A"]);
        gitOk(dir, ["-c", "user.name=E", "-c", "user.email=e@x.invalid", "commit", "-q", "-m", "spec et plan"]);
        const ev = (e: Record<string, unknown>) => write(ledgerPath(root(), "grille"), { date: new Date().toISOString(), ...e } as LedgerEvent);
        ev({ type: "spec-approved", path: "docs/specs/s.md" });
        ev({ type: "plan", path: "docs/plans/p.md" });
      }
      return Promise.resolve({ code: 0, session: "s" });
    },
    delegate(c) {
      delegated.push(c);
      play(c);
      return Promise.resolve({ code: 0, session: null });
    },
    read: () => [],
    maxContext: () => Promise.resolve(null),
    check: () => Promise.resolve([]),
    measure: () => Promise.resolve(null),
  };
  return { adapter, turns, delegated };
}

async function service(adapter: AgentAdapter) {
  const s = await startService({ modules: [projectsModule, storiesModule, conversationModule(() => adapter, { autoRestart: false })], log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, { method, headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return (await r.json()) as Record<string, unknown>;
  };
  for (const m of ["stories", "conversation"]) await api("PUT", `/api/modules/${m}`, { active: true });
  const root = spawnProject();
  const id = (await api("POST", "/api/projects", { dir: root })).id as string;
  return { api, root, id };
}

async function waitUntil(condition: () => boolean, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error("délai dépassé");
    await new Promise((ok) => setTimeout(ok, 50));
  }
}

test("runner: after the plan the service chains the task, then hands back to the orchestrator with the outcome", async () => {
  let root = "";
  const { adapter, turns, delegated } = agent(
    () => root,
    (c) => {
      if (c.agent === "implementer") {
        writeFileSync(join(c.dir, "grille.txt"), "grille\n");
        gitOk(c.dir, ["add", "grille.txt"]);
        gitOk(c.dir, ["-c", "user.name=E", "-c", "user.email=e@x.invalid", "commit", "-q", "-m", "grille"]);
        writeFileSync(pathAfter(c.dir, c.prompt, /écris ton rapport dans (\S+) :/), "statut : DONE\nfait.");
      } else writeFileSync(pathAfter(c.dir, c.prompt, /verdict dans (\S+?),/), "VERDICT : APPROUVÉ\nspec OK");
    },
  );
  const s = await service(adapter);
  root = s.root;
  await s.api("POST", `/api/projects/${s.id}/stories/grille/conversation`, { message: "go" });
  await waitUntil(() => turns.length === 2);
  assert.deepEqual(turns[0]?.env, { [RUNNER_ENV]: "service" }, "l'orchestrateur sait que l'outil enchaîne");
  assert.deepEqual(delegated.map((c) => c.agent), ["implementer", "task-reviewer"]);
  assert.match(turns[1]?.message ?? "", /^enchaîneur : \d+ étape\(s\) faite\(s\)[\s\S]*arrêt : l'action suivante demande ton jugement[\s\S]*étape : preuve et captures/);
  assert.deepEqual(turns[1]?.env, { [RUNNER_ENV]: "service" });
});

test("runner: after a failed chain the orchestrator takes the step itself, without the runner", async () => {
  let root = "";
  // Implémenteur muet : pas de rapport, l'étape n'avance pas.
  const { adapter, turns, delegated } = agent(() => root, () => {});
  const s = await service(adapter);
  root = s.root;
  await s.api("POST", `/api/projects/${s.id}/stories/grille/conversation`, { message: "go" });
  await waitUntil(() => turns.length === 2);
  assert.ok(delegated.length >= 1);
  assert.match(turns[1]?.message ?? "", /arrêt : une étape n'avance pas/);
  assert.equal(turns[1]?.env, undefined, "ce tour-là se fait sans l'enchaîneur");
  assert.doesNotMatch(turns[1]?.message ?? "", /Termine ton tour/);
});

test("runner: under the service an automatable action tells the orchestrator to end its turn", () => {
  const a: Action = { step: "tâche 1/1 : grille, lancer", instruction: "lancer", commands: ["spawn ledger task-started --task 1"], run: [{ kind: "ledger", args: ["task-started", "--task", "1"] }] };
  assert.match(renderAction(a), /commandes :/);
  process.env[RUNNER_ENV] = "service";
  try {
    assert.match(renderAction(a), /Termine ton tour maintenant/);
    assert.doesNotMatch(renderAction(a), /commandes :/);
    const judged: Action = { step: a.step, instruction: a.instruction, commands: a.commands };
    assert.match(renderAction(judged), /commandes :/, "une action de jugement reste à l'orchestrateur");
  } finally {
    delete process.env.SPAWN_RUNNER;
  }
});
