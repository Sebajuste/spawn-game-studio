// Garde contre les boucles : la même commande shell relancée plusieurs fois de suite par une même session, sans rien
// d'autre entre deux, ne lui apprendra rien de plus. Essai de nuit du 18/11 : un sous-agent (modèle local) a relancé la
// même commande toutes les 5 secondes pendant 25 minutes ; l'orchestrateur, lui, a appelé `spawn next` une
// quarantaine de fois d'affilée. Le refus casse la boucle et dit quoi faire à la place.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MAX_REPETITIONS = 3;

const sessionsDir = (root: string) => join(root, ".spawn", "logs", "sessions");

function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

// Note la commande pour la session et rend une raison de refus si elle a déjà été lancée REPETITIONS_MAX fois de suite.
export function repetition(root: string, session: string, command: string): string | null {
  const name = session.replace(/[^\w.-]/g, "_").slice(0, 120);
  if (!name) return null;
  const path = join(sessionsDir(root), `${name}.json`);
  const c = normalizeCommand(command);
  let state = { latest: "", streak: 0 };
  try {
    if (existsSync(path)) state = JSON.parse(readFileSync(path, "utf8")) as typeof state;
  } catch {
    // État illisible : on repart de zéro, la garde n'est qu'une aide.
  }
  // `spawn next` n'est jamais refusé : c'est lui qui donne l'action à faire ; le bloquer enfermait l'orchestrateur
  // (essai 5 de la nuit). Il compte quand même comme un appel, qui interrompt une autre boucle.
  const isNext = /cli\.ts"?\s+next\s*$/.test(c);
  const streak = state.latest === c && !isNext ? state.streak + 1 : 1;
  try {
    mkdirSync(sessionsDir(root), { recursive: true });
    writeFileSync(path, JSON.stringify({ latest: c, streak }));
  } catch {
    return null;
  }
  if (streak <= MAX_REPETITIONS) return null;
  return (
    `cette commande a déjà été lancée ${streak - 1} fois de suite sans rien d'autre entre deux : la relancer ne t'apprendra rien de plus. ` +
    "Change d'approche. Implémenteur ou relecteur bloqué : écris-le dans ton rapport (statut BLOCKED, avec ce qui manque) et termine. " +
    "Orchestrateur : fais l'action que donne spawn next, au lieu de le relancer."
  );
}
