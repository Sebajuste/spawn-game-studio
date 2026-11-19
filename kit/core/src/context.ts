// Contexte d'un appel depuis une session : projet, fil et worktree déduits du dossier courant.
import { join, relative, resolve, sep } from "node:path";
import { findProject, type Project } from "./project.ts";

export interface Context {
  project: Project;
  // Nom du fil quand le dossier est dans un worktree du kit (`.claude/worktrees/<fil>`), sinon null.
  story: string | null;
  // Dossier de travail du fil (le worktree), ou la racine principale.
  dir: string;
}

export function contextOf(cwd: string): Context | null {
  const project = findProject(cwd);
  if (project === null) return null;
  const worktrees = join(project.root, ".claude", "worktrees");
  const rel = relative(worktrees, resolve(cwd));
  if (rel && !rel.startsWith("..") && !rel.includes(":")) {
    const story = rel.split(sep)[0] ?? "";
    if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(story)) return { project, story, dir: join(worktrees, story) };
  }
  return { project, story: null, dir: project.root };
}

// Ledger typé du fil (src/ledger.ts) ; l'ancien `<fil>.md` voisin se lit encore.
export function ledgerPath(root: string, story: string): string {
  return join(root, ".spawn", "ledgers", `${story}.jsonl`);
}
