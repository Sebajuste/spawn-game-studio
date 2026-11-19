// Ménage des worktrees sans travail : Claude Code ne supprime jamais ceux des sous-agents (doc des hooks),
// et 85 worktrees oubliés dans Deep Front montrent ce que coûte un cycle non fermé (D1, D5).
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readStory, updateStory, transitionAllowed } from "./stories.ts";
import { git } from "./git.ts";
import { mergedBranch, deleteWorktree, isWorktreeRoot } from "./hooks/worktree.ts";
import { ledgerPath } from "./context.ts";
import { readLedger } from "./ledger.ts";

export interface Candidate {
  name: string;
  path: string;
  branch: string | null;
  reason: string;
}

export interface Kept {
  name: string;
  reason: string;
}

export function inventory(root: string, exclude: string | null = null): { candidates: Candidate[]; kept: Kept[] } {
  const dir = join(root, ".claude", "worktrees");
  const candidates: Candidate[] = [];
  const kept: Kept[] = [];
  if (!existsSync(dir)) return { candidates, kept };
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const path = join(dir, e.name);
    if (exclude !== null && resolve(exclude).toLowerCase().startsWith(resolve(path).toLowerCase())) {
      kept.push({ name: e.name, reason: "session en cours dans ce worktree" });
      continue;
    }
    // Pas `--is-inside-work-tree` : dans un dossier oublié par git, il répond pour le dépôt principal (et sa branche, develop).
    if (!isWorktreeRoot(path)) {
      const story = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.name) ? readStory(root, e.name) : null;
      const unmerged = story && git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${story.branch}`]).code === 0 && !mergedBranch(root, story.branch);
      if (unmerged) kept.push({ name: e.name, reason: `dossier oublié par git, mais ${story.branch} porte du travail absent de develop` });
      else if (readdirSync(path).length === 0) candidates.push({ name: e.name, path, branch: null, reason: "dossier vide laissé par un rangement interrompu" });
      else kept.push({ name: e.name, reason: "pas un worktree git (à examiner à la main)" });
      continue;
    }
    if (git(path, ["status", "--porcelain"]).stdout) {
      kept.push({ name: e.name, reason: "modifications non commitées" });
      continue;
    }
    const branch = git(path, ["symbolic-ref", "--quiet", "--short", "HEAD"]).stdout || null;
    if (branch === null) {
      kept.push({ name: e.name, reason: "tête détachée" });
      continue;
    }
    if (!mergedBranch(root, branch)) {
      kept.push({ name: e.name, reason: `${branch} porte du travail absent de develop` });
      continue;
    }
    candidates.push({ name: e.name, path, branch, reason: `${branch} déjà dans develop, rien de non commité` });
  }
  return { candidates, kept };
}

export function applyCleanup(root: string, candidates: readonly Candidate[]): string[] {
  const deleted: string[] = [];
  for (const c of candidates) {
    deleteWorktree({ cwd: root, worktree_path: c.path }, { log: () => {} });
    // Un fil sans travail se ferme : actif → termine → nettoye sont deux transitions permises.
    const story = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.name) ? readStory(root, c.name) : null;
    if (story && story.status !== "cleaned") {
      if (!transitionAllowed(story.status, "cleaned") && transitionAllowed(story.status, "done")) updateStory(root, c.name, { status: "done" });
      const current = readStory(root, c.name);
      if (current && transitionAllowed(current.status, "cleaned")) updateStory(root, c.name, { status: "cleaned", worktree: null });
    }
    deleted.push(c.name);
  }
  return deleted;
}

// Rangement d'un fil fusionné, par l'outil et non par l'agent : depuis le worktree, l'agent ne peut pas le supprimer
// (Windows refuse un dossier ouvert : EPERM à l'essai du 18/11) et ExitWorktree ne fait rien dans une session lancée
// par l'app. Appelé quand le tour de l'agent est fini, donc quand plus personne n'est dans le dossier.
export function tidyMerged(root: string, name: string, log: (l: string) => void = () => {}): boolean {
  const story = readStory(root, name);
  if (!story || story.status === "cleaned" || !story.worktree) return false;
  if (!readLedger(ledgerPath(root, name)).some((e) => e.type === "merged")) return false;
  const path = join(root, story.worktree);
  // Un reste de rangement interrompu (dossier vide oublié par git) part aussi : deleteWorktree le reconnaît.
  if (existsSync(path)) deleteWorktree({ cwd: root, worktree_path: path }, { log });
  const after = readStory(root, name);
  if (after && after.status !== "cleaned" && !existsSync(path)) {
    if (git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${after.branch}`]).code === 0 && mergedBranch(root, after.branch)) git(root, ["branch", "-D", after.branch]);
    if (transitionAllowed(after.status, "cleaned")) updateStory(root, name, { status: "cleaned", worktree: null });
  }
  return readStory(root, name)?.status === "cleaned";
}
