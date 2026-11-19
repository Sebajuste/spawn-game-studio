// Compactage guidé (D3) : PreCompact donne le format du résumé, SessionStart réinjecte l'état du fil.
// Le statut du fil suit (actif → compactage → actif) pour que l'app montre ce qui se passe.
import { ledgerPath, contextOf, type Context } from "../context.ts";
import { readStory, updateStory, transitionAllowed, type Status } from "../stories.ts";
import { readLedger, render } from "../ledger.ts";

const LEDGER_EVENTS = 15;

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
    "Chaque Ruling pris, une ligne : décision — raison — coût si faux.",
    "## Rouges et doutes",
    "Tests rouges, hypothèses déjà testées, questions ouvertes. Aucun rouge n'est admis : un rouge est un travail restant.",
    "## Premier geste",
    "La commande ou le dispatch exact qui reprend le travail, exécutable sans autre lecture.",
  ].join("\n");
}

export function resumeContext(cwd: string, source: string): string | null {
  const ctx = contextOf(cwd);
  if (ctx === null || ctx.story === null) return null;
  if (source === "compact") setStatus(ctx, "active");
  const story = readStory(ctx.project.root, ctx.story);
  if (story === null) return null;
  const ledger = ledgerPath(ctx.project.root, ctx.story);
  const end = readLedger(ledger).slice(-LEDGER_EVENTS).map(render);
  const header =
    source === "compact"
      ? "Reprise après compactage : reprends par le « Premier geste » du résumé. Le ledger et `git log` priment sur la mémoire."
      : "Fil Spawn en cours dans ce worktree. Le ledger et `git log` priment sur la mémoire ; le premier geste ci-dessous reprend le travail.";
  return [
    header,
    "",
    "État du fil :",
    JSON.stringify(story, null, 2),
    "",
    `Ledger (${ledger}), ${end.length} derniers événements :`,
    ...(end.length > 0 ? end : ["(vide)"]),
  ].join("\n");
}
