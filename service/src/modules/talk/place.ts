// Où tourne l'agent de la conversation : un worktree détaché de `develop`, `.claude/worktrees/_talk[-<suffixe>]`, remis à
// `develop` avant chaque tour. Ce qu'il y écrirait ne survit pas et ne touche ni le checkout de l'utilisateur ni les
// fils ; le guard l'y confine. Le `_` rend le nom impossible pour une story (`createWorktree` ne garde que [a-z0-9-]).
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { git, gitOk } from "../../../../kit/core/src/git.ts";

export const talkWorktree = (root: string, suffix = "") => join(root, ".claude", "worktrees", suffix ? `_talk-${suffix}` : "_talk");

function registered(root: string, path: string): boolean {
  const target = resolve(path).toLowerCase();
  return git(root, ["worktree", "list", "--porcelain"])
    .stdout.split(/\r?\n/)
    .some((l) => l.startsWith("worktree ") && resolve(l.slice("worktree ".length)).toLowerCase() === target);
}

// Le tronc de travail du projet : `develop` s'il existe, sinon la branche courante de la racine.
function trunk(root: string): string {
  return git(root, ["rev-parse", "--verify", "--quiet", "refs/heads/develop"]).code === 0 ? "refs/heads/develop" : "HEAD";
}

// Rend le worktree prêt pour un tour : créé s'il manque (ou s'il a été rangé), sinon remis exactement sur le tronc.
export function prepareTalkWorktree(root: string, suffix = ""): string {
  const path = talkWorktree(root, suffix);
  const base = gitOk(root, ["rev-parse", trunk(root)]);
  if (!registered(root, path)) {
    // Dossier resté sans worktree (rangé à la main) : rien à garder, c'est un lieu jetable.
    if (existsSync(path)) rmSync(path, { recursive: true, force: true, maxRetries: 5 });
    gitOk(root, ["worktree", "prune"]);
    gitOk(root, ["worktree", "add", "--detach", "--quiet", path, base]);
    return path;
  }
  gitOk(path, ["checkout", "--detach", "--force", "--quiet", base]);
  gitOk(path, ["clean", "-fdq"]);
  return path;
}
