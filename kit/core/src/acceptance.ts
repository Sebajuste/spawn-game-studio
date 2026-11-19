// Jugement d'une feature par l'utilisateur (docs/ux-parcours.md §6), avant toute fusion : `develop` ne reçoit que ce
// qu'il a vu. Accepter fusionne puis fait le ménage sans LLM ; redemander relance le fil avec son message ; abandonner
// supprime la branche et le worktree, l'historique garde la trace (ledger, état `nettoye`).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ledgerPath } from "./context.ts";
import { readStory, updateStory, transitionAllowed, type Story } from "./stories.ts";
import { mergeStory, type Decision, type MergeOptions } from "./merge.ts";
import { git } from "./git.ts";
import { removeWorktree, deleteWorktree } from "./hooks/worktree.ts";
import { write, readLedger } from "./ledger.ts";
import type { Project } from "./project.ts";

export class AcceptanceError extends Error {}

const now = () => new Date().toISOString();

function storyInAcceptance(root: string, name: string): Story & { worktree: string } {
  const story = readStory(root, name);
  if (!story) throw new AcceptanceError(`fil « ${name} » introuvable`);
  if (story.status !== "in-acceptance") throw new AcceptanceError(`le fil « ${name} » n'est pas à juger (statut ${story.status})`);
  if (!story.worktree) throw new AcceptanceError(`le fil « ${name} » n'a plus de worktree`);
  return story as Story & { worktree: string };
}

// Compte rendu le plus récent écrit par l'agent pour le jugement.
export function acceptanceReport(root: string, name: string): { summary: string; how_to_check: string; date: string } | null {
  const ev = readLedger(ledgerPath(root, name)).findLast((e) => e.type === "acceptance-report");
  return ev?.type === "acceptance-report" ? { summary: ev.summary, how_to_check: ev.how_to_check, date: ev.date } : null;
}

export interface Acceptance {
  decision: Decision;
  cleaned: boolean;
}

// Fusion puis ménage. Refusée (conflit, rouge) : le fil redevient actif avec la cause (merge.ts), l'acceptation tient ;
// l'agent corrige puis réinscrit sans nouveau jugement (next.ts).
export async function accept(project: Project, name: string, summary: string, options: MergeOptions & { timeoutMs?: number } = {}): Promise<Acceptance> {
  const story = storyInAcceptance(project.root, name);
  const dir = join(project.root, story.worktree);
  // Un worktree non propre ne fusionne pas : le fil repart vers l'agent, qui commite ou supprime ce qui reste (essai 5
  // de la nuit : fichiers .uid générés par le moteur et journal égaré, acceptation perdue).
  const dirty = git(dir, ["status", "--porcelain"]).stdout.trim();
  if (dirty) {
    updateStory(project.root, name, { status: "active", task: "commiter avant fusion", first_step: "git status, puis spawn next" });
    throw new AcceptanceError(`la feature a des fichiers non commités ; elle repart vers l'agent, qui commite ce qui doit l'être et supprime le reste, puis la remet à juger :\n${dirty}`);
  }
  write(ledgerPath(project.root, name), { date: now(), type: "accepted" });
  updateStory(project.root, name, { status: "done", task: "fusion" });
  const decision = await mergeStory(project, name, dir, summary, options);
  if (decision.verdict !== "merged") return { decision, cleaned: false };
  if (decision.commit) write(ledgerPath(project.root, name), { date: now(), type: "merged", commit: decision.commit });
  deleteWorktree({ cwd: project.root, worktree_path: dir }, { log: options.log ?? (() => {}) });
  return { decision, cleaned: readStory(project.root, name)?.status === "cleaned" };
}

export function requestChanges(root: string, name: string, message: string): Story {
  const text = message.trim();
  if (!text) throw new AcceptanceError("dire ce qui ne va pas");
  storyInAcceptance(root, name);
  write(ledgerPath(root, name), { date: now(), type: "changes-requested", message: text.replace(/\r?\n/g, " ") });
  return updateStory(root, name, { status: "active", task: "correction demandée", first_step: "spawn next" });
}

// Le travail non commité et la branche sont jetés : c'est ce que l'utilisateur a choisi.
export function abandon(root: string, name: string, reason?: string): Story {
  const story = readStory(root, name);
  if (!story) throw new AcceptanceError(`fil « ${name} » introuvable`);
  if (story.status === "cleaned") throw new AcceptanceError(`le fil « ${name} » est déjà fermé`);
  write(ledgerPath(root, name), { date: now(), type: "abandoned", ...(reason?.trim() ? { reason: reason.trim() } : {}) });
  if (story.worktree && existsSync(join(root, story.worktree))) removeWorktree(root, join(root, story.worktree));
  git(root, ["worktree", "prune"]);
  git(root, ["branch", "-D", story.branch]);
  // Chemin permis jusqu'à `nettoye` : bloqué ou en compactage → actif → termine → nettoye.
  for (const step of ["active", "done", "cleaned"] as const) {
    const current = readStory(root, name);
    if (current && current.status !== step && transitionAllowed(current.status, step)) updateStory(root, name, { status: step, worktree: null });
  }
  const end = readStory(root, name);
  if (end?.status !== "cleaned") throw new AcceptanceError(`abandon incomplet : statut ${end?.status ?? "absent"}`);
  return end;
}

// La spec proposée par l'agent, en attente de validation ; null sinon.
export function proposedSpec(root: string, name: string): string | null {
  const story = readStory(root, name);
  if (story?.status !== "blocked:spec-approval") return null;
  const evs = readLedger(ledgerPath(root, name));
  const proposed = evs.findLast((e) => e.type === "spec-proposed");
  return proposed?.type === "spec-proposed" ? proposed.path : null;
}

// Validation de la spec par l'utilisateur (app, ou pilote qui tient son rôle) : la seule question de la feature.
export function approveSpec(root: string, name: string): Story {
  const path = proposedSpec(root, name);
  if (path === null) throw new AcceptanceError(`aucune spec à valider pour « ${name} »`);
  write(ledgerPath(root, name), { date: now(), type: "spec-approved", path });
  return updateStory(root, name, { status: "active", task: "plan", first_step: "spawn next" });
}
