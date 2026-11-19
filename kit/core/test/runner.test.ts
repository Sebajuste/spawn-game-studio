// spawn run : l'enchaîneur exécute les actions de spawn next que l'outil sait faire seul, et rend la main au jugement.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { contextOf, ledgerPath, type Context } from "../src/context.ts";
import { gitOk } from "../src/git.ts";
import { createWorktree } from "../src/hooks/worktree.ts";
import { readLedger, write, type LedgerEvent } from "../src/ledger.ts";
import { runTasks } from "../src/runner.ts";
import type { AgentAdapter } from "../src/agent/type.ts";
import { cleanDirs, spawnProject } from "./git-helper.ts";

after(cleanDirs);
const ENGINES = fileURLToPath(new URL("./adapters/", import.meta.url));
process.env.SPAWN_ENGINES = ENGINES;

type Delegate = NonNullable<AgentAdapter["delegate"]>;
type Call = Parameters<Delegate>[0];

// Faux agent : seul `delegate` sert à l'enchaîneur.
function fakeAgent(play: (c: Call) => number, name: AgentAdapter["name"] = "claude-code"): AgentAdapter & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    name,
    calls,
    turn: () => Promise.reject(new Error("pas de tour")),
    delegate: (c) => {
      calls.push(c);
      return Promise.resolve({ code: play(c), session: null });
    },
    read: () => [],
    maxContext: () => Promise.resolve(null),
    check: () => Promise.resolve([]),
    measure: () => Promise.resolve(null),
  };
}

// Les chemins des consignes sont relatifs au dossier de l'agent : ils se lisent depuis lui, comme un agent les lit.
const pathAfter = (dir: string, prompt: string, re: RegExp) => resolve(dir, re.exec(prompt)?.[1] ?? assert.fail(`chemin introuvable dans « ${prompt} »`));

function commit(dir: string, file: string): void {
  writeFileSync(join(dir, file), `${file}\n`);
  gitOk(dir, ["add", file]);
  gitOk(dir, ["commit", "-q", "-m", `ajoute ${file}`]);
}

// Fil « saut » prêt à développer : spec validée, plan de deux tâches commités.
async function readyStory(): Promise<Context> {
  const root = spawnProject();
  const wt = await createWorktree({ cwd: root, name: "saut" }, { engines: ENGINES, log: () => {} });
  mkdirSync(join(wt, "docs", "specs"), { recursive: true });
  mkdirSync(join(wt, "docs", "plans"), { recursive: true });
  writeFileSync(join(wt, "docs", "specs", "s.md"), "- **SAU-01** Le héros saute. Preuve : test.\n");
  writeFileSync(join(wt, "docs", "plans", "p.md"), "## Tâche 1 : grille\nSAU-01\n## Tâche 2 : saut\nSAU-01\n");
  gitOk(wt, ["add", "-A"]);
  gitOk(wt, ["commit", "-q", "-m", "spec et plan"]);
  const ev = (e: Record<string, unknown>) => write(ledgerPath(root, "saut"), { date: new Date().toISOString(), ...e } as LedgerEvent);
  ev({ type: "spec-approved", path: "docs/specs/s.md" });
  ev({ type: "plan", path: "docs/plans/p.md" });
  const ctx = contextOf(wt);
  assert.ok(ctx);
  return ctx;
}

test("run: tasks, review, a correction round and the final review chained by the tool, handed back at the captures", async () => {
  const ctx = await readyStory();
  let reviews = 0;
  const agent = fakeAgent((c) => {
    if (c.agent === "implementer") {
      commit(c.dir, `f${agent.calls.length}.txt`);
      const report = /^Round/.test(c.prompt) ? pathAfter(c.dir, c.prompt, /réécris ton rapport (\S+?)\.$/) : pathAfter(c.dir, c.prompt, /écris ton rapport dans (\S+) :/);
      writeFileSync(report, "statut : DONE\nfait.");
      return 0;
    }
    reviews++;
    // Tâche 2, première relecture : à corriger ; tout le reste approuvé.
    const verdict = reviews === 2 ? "VERDICT : À CORRIGER\n1. Important : le saut ne retombe pas." : "VERDICT : APPROUVÉ\nspec OK\n1. Mineur : nom de variable.";
    writeFileSync(pathAfter(c.dir, c.prompt, /verdict dans (\S+?),/), verdict);
    return 0;
  });

  const r = await runTasks({ ctx, agent });
  assert.equal(r.reason, "handed-back", r.detail ?? "");
  assert.equal(r.action.step, "preuve et captures");
  assert.deepEqual(
    agent.calls.map((c) => `${c.agent}:${c.model}`),
    ["implementer:sonnet", "task-reviewer:sonnet", "implementer:sonnet", "task-reviewer:sonnet", "implementer:sonnet", "task-reviewer:sonnet", "task-reviewer:opus"],
  );
  const evs = readLedger(ledgerPath(ctx.project.root, "saut"));
  const kinds = evs.map((e) => e.type).filter((t) => t !== "spec-approved" && t !== "plan");
  assert.deepEqual(kinds, ["task-started", "task-done", "minor", "task-started", "round", "task-done", "minor", "final-review"]);
  assert.match(readFileSync(join(ctx.project.root, ".spawn", "tasks", "saut", "2-package.diff"), "utf8"), /ajoute f3\.txt/, "le paquet de revue porte les commits de la tâche");
});

test("run: an implementer that needs context hands back to the orchestrator, without review", async () => {
  const ctx = await readyStory();
  const agent = fakeAgent((c) => {
    writeFileSync(pathAfter(c.dir, c.prompt, /écris ton rapport dans (\S+) :/), "statut : NEEDS_CONTEXT\nquelle hauteur de saut ?");
    return 0;
  });
  const r = await runTasks({ ctx, agent });
  assert.equal(r.reason, "handed-back");
  assert.match(r.action.step, /tâche 1\/2 : grille, relecture/);
  assert.equal(agent.calls.length, 1, "aucun relecteur lancé");
});

test("run: the action handed back speaks the agent's words, not those of the service's environment", async () => {
  delete process.env.SPAWN_AGENT;
  const ctx = await readyStory();
  const agent = fakeAgent((c) => {
    writeFileSync(pathAfter(c.dir, c.prompt, /écris ton rapport dans (\S+) :/), "statut : NEEDS_CONTEXT\nquelle hauteur de saut ?");
    return 0;
  }, "opencode");
  const r = await runTasks({ ctx, agent });
  // Essai du 19/11 : l'enchaîneur du service rendait « spawnstudio:implementer » et « l'outil Agent » à OpenCode.
  assert.doesNotMatch(r.action.instruction, /spawnstudio:|outil Agent/);
  assert.match(r.action.instruction, /spawn-(implementer|task-reviewer)/);
});

test("run: an agent that produces nothing is stuck after a second try, not looped", async () => {
  const ctx = await readyStory();
  const agent = fakeAgent(() => 0);
  const r = await runTasks({ ctx, agent });
  assert.equal(r.reason, "stuck");
  assert.equal(agent.calls.length, 2);
});

test("run: an agent that fails stops the run with its output", async () => {
  const ctx = await readyStory();
  const r = await runTasks({ ctx, agent: fakeAgent(() => 1) });
  assert.equal(r.reason, "agent-failed");
  assert.match(r.detail ?? "", /implementer sorti avec le code 1 ; sortie : .*01-implementer\.jsonl/);
});
