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
import { nextAction } from "../src/next.ts";
import { updateStory } from "../src/stories.ts";
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

test("run: a report without a status line but with commits goes to the reviewer", async () => {
  const ctx = await readyStory();
  const agent = fakeAgent((c) => {
    if (c.agent !== "implementer") return 1;
    commit(c.dir, "grille.txt");
    writeFileSync(pathAfter(c.dir, c.prompt, /écris ton rapport dans (\S+) :/), "La grille est faite, tests verts.");
    return 0;
  });
  await runTasks({ ctx, agent });
  assert.deepEqual(agent.calls.map((c) => c.agent), ["implementer", "task-reviewer"]);
});

test("run: a report without a status and without a commit is left to the orchestrator", async () => {
  const ctx = await readyStory();
  const agent = fakeAgent((c) => {
    writeFileSync(pathAfter(c.dir, c.prompt, /écris ton rapport dans (\S+) :/), "Je ne vois pas comment faire.");
    return 0;
  });
  const r = await runTasks({ ctx, agent });
  assert.equal(r.reason, "handed-back");
  assert.equal(agent.calls.length, 1);
});

test("run: a reviewer who wrote no verdict file is asked once more, then it is stuck", async () => {
  for (const writesSecond of [true, false]) {
    const ctx = await readyStory();
    let reviews = 0;
    const agent = fakeAgent((c) => {
      if (c.agent === "implementer") {
        // Tâche 2 : l'implémenteur s'arrête, le cas est jugé.
        if (reviews > 0) return 1;
        commit(c.dir, "grille.txt");
        writeFileSync(pathAfter(c.dir, c.prompt, /écris ton rapport dans (\S+) :/), "statut : DONE");
        return 0;
      }
      if (++reviews === 2) {
        assert.match(c.prompt, /outil d'écriture/);
        if (writesSecond) writeFileSync(pathAfter(c.dir, c.prompt, /verdict dans (\S+?),/), "VERDICT : APPROUVÉ");
      }
      return 0;
    });
    const r = await runTasks({ ctx, agent });
    assert.equal(reviews, 2);
    assert.equal(r.reason, writesSecond ? "agent-failed" : "stuck");
  }
});

// Fil dont toutes les tâches sont parquées : il reste la relecture finale.
async function storyAtFinalReview(): Promise<Context> {
  const ctx = await readyStory();
  const date = new Date(Date.now() - 10_000).toISOString();
  for (const task of [1, 2]) write(ledgerPath(ctx.project.root, "saut"), { date, type: "task-parked", task, detail: "x", ruling: "y" });
  return ctx;
}

test("run: a final review that keeps refusing is bounded to one correction, then asks the user", async () => {
  const ctx = await storyAtFinalReview();
  const agent = fakeAgent((c) => {
    if (c.agent === "implementer") commit(c.dir, `correction${agent.calls.length}.txt`);
    else writeFileSync(pathAfter(c.dir, c.prompt, /verdict dans (\S+?),/), "VERDICT : À CORRIGER\n1. Important : x");
    return 0;
  });
  const r = await runTasks({ ctx, agent, maxSteps: 12 });
  assert.deepEqual(agent.calls.map((c) => c.agent), ["task-reviewer", "implementer", "task-reviewer"]);
  assert.equal(r.reason, "handed-back");
  assert.equal(r.action.step, "plafond de la relecture finale");
  assert.match(r.action.commands.join(" "), /blocked:decision/);

  // L'utilisateur a répondu : la suite est une tâche de correction, pas une seconde question ni une nouvelle boucle.
  const task = /--task "([^"]+)"/.exec(r.action.commands[0] ?? "")?.[1] ?? assert.fail("tâche du fil absente");
  updateStory(ctx.project.root, "saut", { status: "blocked:decision", task });
  updateStory(ctx.project.root, "saut", { status: "active" });
  const answered = nextAction(ctx);
  assert.equal(answered.step, "corrections à planifier");
  assert.match(answered.instruction, /## Tâche 3/);
  assert.equal(answered.run, undefined);
});

test("run: final corrections without a commit are not recorded as corrections", async () => {
  const ctx = await storyAtFinalReview();
  const agent = fakeAgent((c) => {
    if (c.agent !== "implementer") writeFileSync(pathAfter(c.dir, c.prompt, /verdict dans (\S+?),/), "VERDICT : À CORRIGER\n1. Important : x");
    return 0;
  });
  const r = await runTasks({ ctx, agent, maxSteps: 12 });
  assert.equal(r.reason, "stuck");
  assert.match(r.detail ?? "", /aucun commit/);
  assert.equal(readLedger(ledgerPath(ctx.project.root, "saut")).some((e) => e.type === "final-review"), false);
});
