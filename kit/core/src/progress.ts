// Avancement d'un fil en étapes lisibles pour l'app (docs/ux-parcours.md §4) : comprendre, découper, tâches, preuve,
// jugement, fusion. Déduit du ledger, du plan et de l'état du fil, comme `spawn next` : rien d'autre n'est tenu.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ledgerPath } from "./context.ts";
import type { Story } from "./stories.ts";
import { readLedger, type LedgerEvent } from "./ledger.ts";
import { planTasks } from "./next.ts";
import { readDecisions } from "./merge.ts";

export type StepState = "done" | "current" | "pending";

export interface ProgressTask {
  number: number;
  title: string;
  state: StepState | "parked";
  rounds: number;
}

export interface ProgressStep {
  id: "understand" | "breakdown" | "tasks" | "proof" | "acceptance" | "merge";
  title: string;
  state: StepState;
  detail: string | null;
  start: string | null;
  end: string | null;
  tasks?: ProgressTask[];
}

const last = <T extends LedgerEvent["type"]>(evs: readonly LedgerEvent[], type: T) =>
  evs.findLast((e): e is Extract<LedgerEvent, { type: T }> => e.type === type);

const IDS: ProgressStep["id"][] = ["understand", "breakdown", "tasks", "proof", "acceptance", "merge"];

// Étape de `spawn next` -> étape de l'avancement. Une seule source de vérité pour « où en est le fil » : l'outil ;
// le ledger ne sert qu'à savoir ce qui est fait quand l'outil ne dit rien (`none`). `null` : chaîne non reconnue.
export function stepIndex(step: string): ProgressStep["id"] | "none" | "finished" | null {
  if (step === "spec" || step === "spec à revoir" || step === "spec proposée, fil à mettre en attente") return "understand";
  if (step === "plan" || step === "plan introuvable" || step === "plan illisible") return "breakdown";
  if (step.startsWith("tâche ") || step === "correction demandée" || step === "corrections à planifier") return "tasks";
  if (
    ["relecture finale", "corrections de la relecture finale", "plafond de la relecture finale", "relecture finale approuvée", "worktree à commiter", "preuve et captures", "compte rendu à juger"].includes(step)
  ) return "proof";
  if (step === "à juger") return "acceptance";
  if (step === "fusion" || step === "après fusion" || step.startsWith("fusion refusée")) return "merge";
  if (step === "terminé") return "finished";
  if (["en attente de l'utilisateur", "fils en cours", "aucun fil", "état absent"].includes(step)) return "none";
  return null;
}

export function progress(root: string, story: Story, step: string | null): { steps: ProgressStep[]; unknownStep: string | null } {
  const evs = readLedger(ledgerPath(root, story.story));
  const spec = last(evs, "spec-approved");
  const plan = last(evs, "plan");
  const planPath = plan && story.worktree ? join(root, story.worktree, plan.path) : null;
  const tasks = planPath && existsSync(planPath) ? planTasks(readFileSync(planPath, "utf8")) : [];
  const merge = last(evs, "merged");
  // Fusionné : tout est fait ; abandonné, rien de plus ne le sera.
  const closed = merge !== undefined;

  const list: ProgressTask[] = tasks.map((t) => {
    const close = evs.findLast((e) => (e.type === "task-done" || e.type === "task-parked") && e.task === t.number);
    const started = evs.some((e) => e.type === "task-started" && e.task === t.number);
    const rounds = evs.filter((e) => e.type === "round" && e.task === t.number).length;
    const state = close?.type === "task-parked" ? "parked" : close ? "done" : started ? "current" : "pending";
    return { number: t.number, title: t.title, state, rounds };
  });
  const tasksDone = list.length > 0 && list.every((t) => t.state === "done" || t.state === "parked");
  const lastTask = evs.findLast((e) => e.type === "task-done" || e.type === "task-parked")?.date ?? "";
  // Vérifié = preuve faite par l'outil (événement « preuve »), plus récente que la dernière tâche : jamais une déclaration.
  const proof = last(evs, "proof");
  const proven = tasksDone && proof !== undefined && proof.date >= lastTask;
  const acceptedEvent = last(evs, "accepted");
  const changesRequested = last(evs, "changes-requested");
  const accepted = acceptedEvent !== undefined && (!changesRequested || changesRequested.date < acceptedEvent.date);

  // Ce que le ledger donne pour fait, étape par étape : sert seulement quand l'outil ne désigne pas l'étape.
  const ledgerDone = [spec !== undefined, plan !== undefined, tasksDone, proven, accepted, merge !== undefined];
  const firstUndone = closed ? IDS.length : ledgerDone.indexOf(false);
  const index = step === null || step === undefined ? "none" : stepIndex(step);
  const finished = closed || index === "finished";
  // `current` : l'étape de l'outil ; avant elle tout est fait, après rien. Inconnue : aucune étape en cours.
  const at = finished ? IDS.length : index === null ? -1 : index === "none" ? firstUndone : IDS.indexOf(index);
  const state = (id: ProgressStep["id"]): StepState => {
    const i = IDS.indexOf(id);
    if (index === null && !finished) return i < firstUndone ? "done" : "pending";
    return i < at ? "done" : i === at ? "current" : "pending";
  };
  const firstEvent = evs.find((e) => e.type !== "note")?.date ?? null;
  const firstTask = evs.find((e) => e.type === "task-started")?.date ?? null;

  const steps: ProgressStep[] = [
    {
      id: "understand",
      title: "Cadrage",
      state: state("understand"),
      detail: spec ? "validé par toi" : story.status.startsWith("blocked:") ? "à valider" : null,
      start: firstEvent,
      end: spec?.date ?? null,
    },
    {
      id: "breakdown",
      title: "Planification",
      state: state("breakdown"),
      detail: plan ? `${tasks.length || "?"} tâche${tasks.length > 1 ? "s" : ""}` : null,
      start: spec?.date ?? null,
      end: plan?.date ?? null,
    },
    {
      id: "tasks",
      title: "Développement",
      state: state("tasks"),
      detail: list.length > 0 ? `${list.filter((t) => t.state === "done" || t.state === "parked").length}/${list.length}` : null,
      start: firstTask,
      end: tasksDone ? lastTask : null,
      tasks: list,
    },
    {
      id: "proof",
      title: "Vérification",
      state: state("proof"),
      detail: proven ? `vérifiée par l'outil : tests ${proof.tests}, lancement ok, ${proof.end_to_end} test(s) de bout en bout` : tasksDone ? "pas encore vérifiée par l'outil" : null,
      start: tasksDone ? lastTask : null,
      end: proven ? proof.date : null,
    },
    {
      id: "acceptance",
      title: "Recette",
      state: state("acceptance"),
      detail: accepted ? "acceptée" : story.status === "in-acceptance" ? "à toi de juger" : changesRequested ? `redemandée : ${changesRequested.message}` : null,
      start: last(evs, "acceptance-report")?.date ?? null,
      end: accepted ? (acceptedEvent?.date ?? null) : null,
    },
    {
      id: "merge",
      title: "Livraison",
      state: state("merge"),
      detail: merge ? `dans develop (${merge.commit.slice(0, 7)})` : accepted && story.task ? story.task : null,
      start: acceptedEvent?.date ?? null,
      end: merge?.date ?? null,
    },
  ];
  // Retour en arrière : l'étape où la story revient dit pourquoi. Deux motifs, lus de sources que l'outil tient déjà
  // (ledger, journal de fusion) ; aucun n'est déclaré à la main, donc aucun ne survit à un nouvel accord ou à la fusion.
  const current = at >= 0 && at < steps.length ? steps[at] : undefined;
  if (current && !finished && !last(evs, "abandoned")) {
    const redone = changesRequested !== undefined && (!acceptedEvent || changesRequested.date > acceptedEvent.date);
    const lastDecision = readDecisions(root).filter((d) => d.story === story.story && d.verdict !== "queued" && d.date > (acceptedEvent?.date ?? "")).at(-1);
    const refused = lastDecision !== undefined && (lastDecision.verdict === "refused" || lastDecision.verdict === "error");
    if (refused && (current.id === "merge" || current.id === "tasks")) current.detail = `fusion refusée : ${lastDecision.cause ?? lastDecision.verdict}`;
    else if (redone && IDS.indexOf(current.id) < IDS.indexOf("acceptance")) current.detail = `reprise après recette : ${changesRequested.message}`;
  }
  if (last(evs, "abandoned")) for (const e of steps) if (e.state !== "done") e.state = "pending";
  return { steps, unknownStep: index === null ? (step ?? null) : null };
}
