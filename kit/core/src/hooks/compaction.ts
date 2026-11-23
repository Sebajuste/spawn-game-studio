// Compactage guidé (D3) : PreCompact donne le format du résumé, SessionStart réinjecte le document du fil.
// Le statut du fil suit (actif → compactage → actif) pour que l'app montre ce qui se passe.
// Le document du fil est construit par l'outil depuis le ledger, jamais écrit par l'agent : une session neuve (après le
// plan) ou compactée repart de spec, plan et décisions sans pouvoir s'en écarter. En console, l'EPIC RPG du 22/11 a
// inventé trois fois ce que l'utilisateur n'avait pas dit, dans la session aux 9 compactages.
import { ledgerPath, contextOf, type Context } from "../context.ts";
import { readStory, updateStory, transitionAllowed, type Status } from "../stories.ts";
import { readLedger, render, type LedgerEvent } from "../ledger.ts";

const LEDGER_EVENTS = 15;
// Les décisions de l'utilisateur sont toutes gardées ; les arbitrages de l'agent (mineurs reportés compris) peuvent être
// nombreux : les plus récents seulement, le nombre total dit.
const AGENT_RULINGS = 20;

function setStatus(ctx: Context, to: Status): void {
  if (ctx.story === null) return;
  const story = readStory(ctx.project.root, ctx.story);
  if (story && story.status !== to && transitionAllowed(story.status, to)) updateStory(ctx.project.root, ctx.story, { status: to });
}

export function compactionInstructions(cwd: string): string | null {
  const ctx = contextOf(cwd);
  if (ctx === null) return null;
  setStatus(ctx, "compacting");
  const ledger = ctx.story ? ledgerPath(ctx.project.root, ctx.story) : null;
  return [
    "Résume au format de passation Spawn, 2 000 tokens au plus, sans recopier ni code ni journaux : renvoie aux fichiers, commits et ledger.",
    "",
    "## Fil",
    `${ctx.story ?? "(session à la racine du projet)"} ; branche, tâche en cours${ledger ? `, ledger ${ledger}` : ""}, chemins de la spec et du plan.`,
    "## État",
    "Ce qui est fait (commits, événements du ledger), ce qui reste, dans l'ordre.",
    "## Décisions",
    "Le ledger garde déjà les décisions écrites (réinjectées à la reprise). Ici, seulement celles qui n'y sont pas encore, une ligne chacune : décision — raison — coût si faux, en disant si elle vient de l'utilisateur ; la reprise les y écrit d'abord.",
    "## Rouges et doutes",
    "Tests rouges, hypothèses déjà testées, questions ouvertes. Aucun rouge n'est admis : un rouge est un travail restant.",
    "## Premier geste",
    "La commande ou le dispatch exact qui reprend le travail, exécutable sans autre lecture.",
  ].join("\n");
}

// Le document du fil : ce qu'une session qui n'a rien vu doit savoir pour continuer sans dériver.
export function threadDocument(events: readonly LedgerEvent[]): string[] {
  const last = <T extends LedgerEvent["type"]>(type: T) => events.findLast((e): e is Extract<LedgerEvent, { type: T }> => e.type === type);
  const spec = last("spec-approved") ?? last("spec-proposed");
  const plan = last("plan");
  const rulings = events.filter((e): e is Extract<LedgerEvent, { type: "ruling" }> => e.type === "ruling");
  const user = rulings.filter((r) => r.by === "user");
  const agent = rulings.filter((r) => r.by !== "user");
  const shown = agent.slice(-AGENT_RULINGS);
  return [
    `Spec${spec?.type === "spec-approved" ? " validée" : spec ? " proposée, pas encore validée" : ""} : ${spec?.path ?? "(aucune)"}`,
    `Plan : ${plan?.path ?? "(aucun)"}`,
    "",
    `Décisions de l'utilisateur (${user.length}), elles priment sur tout le reste :`,
    ...(user.length > 0 ? user.map(render) : ["(aucune)"]),
    "",
    `Arbitrages de l'agent (${agent.length}${agent.length > shown.length ? `, les ${shown.length} derniers` : ""}) :`,
    ...(shown.length > 0 ? shown.map(render) : ["(aucun)"]),
  ];
}

export function resumeContext(cwd: string, source: string): string | null {
  const ctx = contextOf(cwd);
  if (ctx === null || ctx.story === null) return null;
  // Seul un fil en compactage redevient actif : en attente de l'utilisateur, à juger ou terminé, il le reste.
  if (source === "compact" && readStory(ctx.project.root, ctx.story)?.status === "compacting") setStatus(ctx, "active");
  const story = readStory(ctx.project.root, ctx.story);
  if (story === null) return null;
  const ledger = ledgerPath(ctx.project.root, ctx.story);
  const events = readLedger(ledger);
  const end = events.slice(-LEDGER_EVENTS).map(render);
  const header =
    source === "compact"
      ? "Reprise après compactage : reprends par le « Premier geste » du résumé. Le ledger et `git log` priment sur la mémoire."
      : "Fil Spawn en cours dans ce worktree. Le ledger et `git log` priment sur la mémoire ; `spawn next` donne l'action à faire.";
  return [
    header,
    "Une décision de l'utilisateur s'écrit au ledger dès qu'il la prend : `spawn ledger ruling --by user --decision … --reason … --cost …`. Ce qui n'y est pas sera perdu.",
    "",
    "Document du fil :",
    ...threadDocument(events),
    "",
    "État du fil :",
    JSON.stringify(story, null, 2),
    "",
    `Ledger (${ledger}), ${end.length} derniers événements :`,
    ...(end.length > 0 ? end : ["(vide)"]),
  ].join("\n");
}
