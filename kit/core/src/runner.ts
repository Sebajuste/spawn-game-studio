// Enchaîneur (`spawn run`) : exécute les actions de `spawn next` que l'outil sait faire seul (commandes du ledger, paquet
// de revue, implémenteur et relecteur lancés en mode non interactif), et rend la main à l'orchestrateur à la première
// action qui demande du jugement. `next` reste la seule source de l'enchaînement : l'enchaîneur ne décide rien.
// Essai du 18/11 : 126 appels de l'orchestrateur opus, 94 % du coût, pour enchaîner ces gestes un à un.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "./context.ts";
import { git } from "./git.ts";
import { CLI_PATH, nextAction, tasksDir, type Action, type RunStep } from "./next.ts";
import type { AgentAdapter } from "./agent/type.ts";

export interface RunOutcome {
  // handed-back : action de jugement, rendue à l'orchestrateur ; les autres sont des échecs, rendus aussi.
  reason: "handed-back" | "agent-failed" | "ledger-refused" | "stuck" | "max-steps" | "stopped";
  action: Action;
  detail: string | null;
  executed: string[];
}

export interface RunOptions {
  ctx: Context;
  agent: AgentAdapter;
  // Un agent qui tourne plus longtemps est arrêté (arbre du processus tué par son PID).
  agentTimeoutMs?: number;
  maxSteps?: number;
  signal?: AbortSignal;
  log?: (line: string) => void;
}

const head = (dir: string) => git(dir, ["rev-parse", "--short", "HEAD"]).stdout;

// Une commande du ledger passe par la CLI, comme si l'orchestrateur la tapait : mêmes vérifications, mêmes refus.
function ledger(dir: string, args: readonly string[]): { ok: boolean; output: string } {
  const r = spawnSync(process.execPath, [CLI_PATH, "ledger", ...args], { cwd: dir, encoding: "utf8", windowsHide: true });
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

export async function runTasks(o: RunOptions): Promise<RunOutcome> {
  const { ctx, agent } = o;
  const log = o.log ?? (() => {});
  const maxSteps = o.maxSteps ?? 60;
  const executed: string[] = [];
  const story = ctx.story ?? "fil";
  const outputs = join(tasksDir(ctx.project.root, story), "run");
  mkdirSync(outputs, { recursive: true });
  // Un nom par lancement : sans lui, le lancement suivant réécrivait 01-implementer.jsonl, journal et coût perdus.
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  let previous: string | null = null;
  let repeats = 0;

  for (let i = 0; i < maxSteps; i++) {
    const action = nextAction(ctx, agent.name);
    if (!action.run) return { reason: "handed-back", action, detail: null, executed };
    if (o.signal?.aborted) return { reason: "stopped", action, detail: null, executed };
    // La même étape juste après l'avoir exécutée : l'agent n'a pas produit ce qu'elle attend (rapport, verdict). Pas de
    // boucle ; l'implémenteur a quand même sa seconde chance (« lancer » puis « implémenteur à lancer »).
    repeats = action.step === previous ? repeats + 1 : 0;
    if (repeats >= 1) return { reason: "stuck", action, detail: `l'étape « ${action.step} » n'a pas avancé après exécution`, executed };
    previous = action.step;
    log(`étape : ${action.step}`);
    executed.push(action.step);

    let range = "";
    for (const step of action.run) {
      const failed = await execute(step, i);
      if (failed) return { ...failed, action, executed };
    }

    async function execute(step: RunStep, index: number): Promise<Pick<RunOutcome, "reason" | "detail"> | null> {
      if (step.kind === "ledger") {
        const args = step.args.map((a) => a.replace("{commits}", range || "aucun"));
        const r = ledger(ctx.dir, args);
        log(`  ledger ${args[0]} : ${r.ok ? "noté" : "refusé"}`);
        return r.ok ? null : { reason: "ledger-refused", detail: r.output };
      }
      if (step.kind === "package") {
        const diff = git(ctx.dir, ["diff", `${step.base}..HEAD`]).stdout;
        const commits = git(ctx.dir, ["log", "--oneline", `${step.base}..HEAD`]).stdout;
        writeFileSync(step.path, `${diff}\n${commits}\n`);
        return null;
      }
      if (!agent.delegate) return { reason: "agent-failed", detail: `l'agent ${agent.name} ne sait pas lancer un sous-agent seul` };
      const before = head(ctx.dir);
      const output = join(outputs, `${stamp}-${String(index + 1).padStart(2, "0")}-${step.agent}.jsonl`);
      log(`  ${step.agent} (${step.model}) lancé`);
      const turn = await agent.delegate({
        dir: ctx.dir,
        agent: step.agent,
        model: step.model,
        prompt: step.prompt,
        output,
        timeoutMs: o.agentTimeoutMs ?? 45 * 60_000,
        ...(o.signal ? { signal: o.signal } : {}),
      });
      const after = head(ctx.dir);
      range = before === after ? "" : `${before}..${after}`;
      log(`  ${step.agent} fini (code ${turn.code ?? "arrêté"})`);
      if (o.signal?.aborted) return { reason: "stopped", detail: null };
      if (turn.code === 0) return null;
      const stderr = existsSync(`${output}.stderr`) ? readFileSync(`${output}.stderr`, "utf8").trim().slice(0, 500) : "";
      return { reason: "agent-failed", detail: `${step.agent} sorti avec le code ${turn.code ?? "aucun (arrêté ou délai dépassé)"}${stderr ? ` : ${stderr}` : ""} ; sortie : ${output}` };
    }
  }
  return { reason: "max-steps", action: nextAction(ctx, agent.name), detail: `${maxSteps} étapes sans fin`, executed };
}

// Ce que l'orchestrateur lit en reprenant la main : ce qui a été fait, pourquoi l'enchaîneur s'arrête, quoi faire.
export function renderOutcome(r: RunOutcome, render: (a: Action) => string): string {
  const why: Record<RunOutcome["reason"], string> = {
    "handed-back": "l'action suivante demande ton jugement",
    "agent-failed": "un agent a échoué",
    "ledger-refused": "le ledger a refusé une commande",
    stuck: "une étape n'avance pas",
    "max-steps": "trop d'étapes sans fin",
    stopped: "arrêté",
  };
  return [
    `enchaîneur : ${r.executed.length} étape(s) faite(s)${r.executed.length > 0 ? ` (${r.executed.join(" ; ")})` : ""}`,
    `arrêt : ${why[r.reason]}${r.detail ? ` — ${r.detail}` : ""}`,
    "",
    render(r.action),
  ].join("\n");
}
