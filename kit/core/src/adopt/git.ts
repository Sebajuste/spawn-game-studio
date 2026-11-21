// État git d'un dossier à adopter, en lecture seule.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { currentBranch, git } from "../git.ts";

export interface GitState {
  repo: boolean;
  // Racine du dépôt ; spawn.json doit y être, un sous-dossier ne peut pas être adopté.
  top: string | null;
  // Le dépôt a au moins un commit : develop se crée depuis la branche courante.
  born: boolean;
  branch: string | null;
  // Fichiers modifiés ou non suivis (`git status --porcelain`), hors fichiers ignorés.
  dirty: string[];
  develop: boolean;
  origin: boolean;
  // Branche visée par `origin/HEAD` (ex. `origin/main`), null si inconnue.
  originHead: string | null;
  hooksPath: string | null;
  husky: boolean;
}

const same = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

export function readGitState(dir: string): GitState {
  const top = git(dir, ["rev-parse", "--show-toplevel"]);
  const state: GitState = {
    repo: false,
    top: null,
    born: false,
    branch: null,
    dirty: [],
    develop: false,
    origin: false,
    originHead: null,
    hooksPath: null,
    husky: existsSync(join(dir, ".husky")),
  };
  if (top.code !== 0) return state;
  state.repo = true;
  state.top = resolve(top.stdout);
  state.born = git(dir, ["rev-parse", "--verify", "--quiet", "HEAD"]).code === 0;
  state.branch = currentBranch(dir);
  state.dirty = git(dir, ["status", "--porcelain", "--untracked-files=all"])
    .stdout.split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.slice(3));
  state.develop = git(dir, ["rev-parse", "--verify", "--quiet", "refs/heads/develop"]).code === 0;
  state.origin = git(dir, ["remote", "get-url", "origin"]).code === 0;
  const head = git(dir, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  state.originHead = head.code === 0 && head.stdout ? head.stdout : null;
  const hooks = git(dir, ["config", "--get", "core.hooksPath"]);
  state.hooksPath = hooks.code === 0 && hooks.stdout ? hooks.stdout : null;
  return state;
}

export function isRepoRoot(state: GitState, dir: string): boolean {
  return state.top !== null && same(state.top, dir);
}
