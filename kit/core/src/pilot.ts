// Pilote d'un essai sans surveillance (D8) : il joue le rôle de l'utilisateur, de façon mesurée, quel que soit l'agent.
// Chaque message qu'il envoie compte comme une intervention : l'intention, la validation de la spec quand le fil
// l'attend, l'acceptation quand la feature est à juger (la fusion se fait alors sans l'agent, comme depuis l'app),
// une relance quand la session s'arrête avant. Il préfigure ce que fait l'app.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentAdapter, AgentMetrics } from "./agent/type.ts";
import { ledgerPath } from "./context.ts";
import { readStory } from "./stories.ts";
import { readDecisions } from "./merge.ts";
import { git } from "./git.ts";
import { createWorktree } from "./hooks/worktree.ts";
import { accept, AcceptanceError, proposedSpec, approveSpec } from "./acceptance.ts";
import { readLedger } from "./ledger.ts";
import { applyCleanup, inventory } from "./cleanup.ts";
import { findProject } from "./project.ts";
import { SPAWN } from "./next.ts";
import { read } from "./agent/process.ts";

export interface PilotIntervention {
  date: string;
  type: "intent" | "validation" | "acceptance" | "restart";
  text: string;
}

export interface PilotOptions {
  root: string;
  story: string;
  intent: string;
  agent: AgentAdapter;
  restarts?: number;
  maxNoProgress?: number;
  turnTimeoutMs?: number;
  maxDurationMs?: number;
  log?: (line: string) => void;
}

export interface PilotReport {
  agent: string;
  verdict: "merged" | "abandoned" | "max-duration";
  reason: string;
  start: string;
  end: string;
  duration_min: number;
  turns: number;
  interventions: PilotIntervention[];
  session: string | null;
  metrics: AgentMetrics | null;
  rounds: number;
  parked_tasks: number;
  remaining: { worktrees: string[] };
}

function merged(root: string, story: string, since: string): boolean {
  if (readLedger(ledgerPath(root, story)).some((e) => e.type === "merged")) return true;
  return readDecisions(root).some((d) => d.story === story && d.verdict === "merged" && d.date >= since);
}

// Empreinte de l'avancement : un tour qui ne change ni le statut, ni le ledger, ni la branche n'a rien fait.
function progress(root: string, story: string, worktree: string): string {
  const state = readStory(root, story);
  return `${state?.status}|${state?.updated}|${read(ledgerPath(root, story)).length}|${git(worktree, ["rev-parse", "HEAD"]).stdout}`;
}

export async function pilot(o: PilotOptions): Promise<PilotReport> {
  const log = o.log ?? ((l: string) => console.log(`[pilote ${new Date().toISOString().slice(11, 19)}] ${l}`));
  const maxRestarts = o.restarts ?? 6;
  const maxNoProgress = o.maxNoProgress ?? 3;
  const turnTimeoutMs = o.turnTimeoutMs ?? 90 * 60_000;
  const deadline = Date.now() + (o.maxDurationMs ?? 8 * 3600_000);
  const start = new Date().toISOString();
  const dir = join(o.root, ".spawn", "pilot", o.story);
  mkdirSync(join(dir, "exports"), { recursive: true });

  const path = join(o.root, ".claude", "worktrees", o.story);
  const worktree = existsSync(path) ? path : await createWorktree({ cwd: o.root, name: o.story }, { log });
  log(`fil ${o.story} (${o.agent.name}) : ${worktree}`);

  const interventions: PilotIntervention[] = [];
  let message = `${o.intent}\n\nPour avancer, lance « ${SPAWN} next » et fais exactement l'action qu'il donne, puis recommence. Arrête-toi quand il dit que la feature est à juger.`;
  let type: PilotIntervention["type"] = "intent";
  let session: string | null = null;
  let turns = 0;
  let restarts = 0;
  let noProgress = 0;
  let verdict: PilotReport["verdict"] = "abandoned";
  let reason: string;

  for (;;) {
    if (Date.now() > deadline) {
      verdict = "max-duration";
      reason = "durée maximale de l'essai atteinte";
      break;
    }
    interventions.push({ date: new Date().toISOString(), type, text: message });
    const before = progress(o.root, o.story, worktree);
    turns++;
    log(`tour ${turns} (${type})`);
    const t = await o.agent.turn({ dir: worktree, message, session, output: join(dir, `turn-${turns}.jsonl`), timeoutMs: turnTimeoutMs });
    session = t.session ?? session;
    log(`tour ${turns} terminé (code ${String(t.code)}), session ${session ?? "?"}`);

    if (merged(o.root, o.story, start)) {
      verdict = "merged";
      reason = "branche fusionnée dans develop";
      break;
    }
    const state = readStory(o.root, o.story);
    noProgress = progress(o.root, o.story, worktree) === before ? noProgress + 1 : 0;
    if (noProgress >= maxNoProgress) {
      reason = `${noProgress} tours sans aucun changement du fil ni du ledger`;
      break;
    }
    // À juger : le pilote accepte, comme l'utilisateur dans l'app ; la fusion se fait sans l'agent.
    if (state?.status === "in-acceptance") {
      const project = findProject(o.root);
      if (!project) {
        reason = "projet introuvable au moment du jugement";
        break;
      }
      interventions.push({ date: new Date().toISOString(), type: "acceptance", text: "Accepté." });
      log("à juger : accepté, fusion");
      try {
        const r = await accept(project, o.story, o.story, { log });
        if (r.decision.verdict === "merged") {
          verdict = "merged";
          reason = "acceptée puis fusionnée dans develop";
          break;
        }
        type = "restart";
        message = `La fusion a été refusée (${r.decision.cause ?? r.decision.verdict}) : ${r.decision.detail ?? ""}

Lance « ${SPAWN} next » et corrige ; la feature est déjà acceptée, réinscris la branche quand la preuve est verte.`;
        continue;
      } catch (e) {
        // Refus d'acceptation par l'outil (worktree non propre) : l'agent corrige et remet à juger, comme depuis l'app.
        if (!(e instanceof AcceptanceError)) {
          reason = `acceptation impossible : ${(e as Error).message}`;
          break;
        }
        type = "restart";
        message = `${e.message}\n\nLance « ${SPAWN} next » et fais exactement l'action qu'il donne.`;
        continue;
      }
    }
    // Spec proposée : le pilote la valide comme l'utilisateur dans l'app (validation écrite par l'outil, pas par l'agent).
    if (proposedSpec(o.root, o.story) !== null && !interventions.some((i) => i.type === "validation")) {
      approveSpec(o.root, o.story);
      interventions.push({ date: new Date().toISOString(), type: "validation", text: "Spec validée." });
      log("spec proposée : validée");
      type = "restart";
      message = `Spec validée. Continue : lance « ${SPAWN} next » et fais exactement l'action qu'il donne, puis recommence.`;
      continue;
    }
    if (state?.status === "blocked:decision" && !interventions.some((i) => i.type === "validation")) {
      type = "validation";
      message = "Je valide la spec. Continue sans me poser d'autre question.";
      continue;
    }
    if (restarts >= maxRestarts) {
      reason = `${restarts} relances sans fusion`;
      break;
    }
    restarts++;
    type = "restart";
    message = state?.status.startsWith("blocked:")
      ? `Décide toi-même (Ruling au ledger) et continue : lance « ${SPAWN} next » et fais l'action.`
      : `Continue : lance « ${SPAWN} next » et fais exactement l'action qu'il donne.`;
  }
  log(`fin : ${verdict} (${reason})`);

  // Ménage depuis la racine : le pilote tient le rôle de la session qui quitte le worktree.
  if (verdict === "merged") applyCleanup(o.root, inventory(o.root).candidates);

  const evs = readLedger(ledgerPath(o.root, o.story));
  const report: PilotReport = {
    agent: o.agent.name,
    verdict,
    reason,
    start,
    end: new Date().toISOString(),
    duration_min: Math.round((Date.now() - Date.parse(start)) / 60_000),
    turns,
    interventions,
    session,
    metrics: await o.agent.measure({ root: o.root, session, since: start, exportsDir: join(dir, "exports") }),
    rounds: evs.filter((e) => e.type === "round").length + evs.filter((e) => e.type === "final-review" && e.verdict === "changes").length,
    parked_tasks: evs.filter((e) => e.type === "task-parked").length,
    remaining: { worktrees: inventory(o.root).kept.map((g) => g.name) },
  };
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}
