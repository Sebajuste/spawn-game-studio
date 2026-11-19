// Hooks WorktreeCreate et WorktreeRemove (D1) : toute création de worktree par Claude Code passe ici.
// Hors projet Spawn, ils reproduisent le comportement par défaut de Claude Code, puisqu'ils le remplacent.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { callAdapter, loadAdapter } from "../adapter/call.ts";
import { createStory, readStory, updateStory, transitionAllowed } from "../stories.ts";
import { git, gitOk } from "../git.ts";
import { ENGINES_DIR, mainRoot, findProject } from "../project.ts";

export interface WorktreeOptions {
  // Dossier des adaptateurs de moteur ; les tests y mettent l'adaptateur factice.
  engines?: string;
  log?: (line: string) => void;
}

const toSlash = (p: string) => p.split("\\").join("/");

// Un dossier que git a oublié (rangement interrompu) n'est plus un worktree : git y remonte au dépôt principal et y lit
// sa branche, develop. Essais 2 et 3 : « develop déjà dans develop », pris pour une bascule du worktree sur develop.
export function isWorktreeRoot(path: string): boolean {
  const top = git(path, ["rev-parse", "--show-toplevel"]);
  return top.code === 0 && resolve(top.stdout.trim()).toLowerCase() === resolve(path).toLowerCase();
}

function refExists(dir: string, ref: string): boolean {
  return git(dir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).code === 0;
}

function isAncestor(dir: string, a: string, b: string): boolean {
  return git(dir, ["merge-base", "--is-ancestor", a, b]).code === 0;
}

// `develop` à jour : la plus avancée de `develop` et `origin/develop` ; deux histoires divergentes sont une anomalie.
function developBase(root: string, log: (l: string) => void): string {
  const remote = git(root, ["remote"]).stdout.split(/\s+/).includes("origin");
  if (remote) {
    const f = git(root, ["fetch", "--quiet", "origin", "develop"]);
    if (f.code !== 0) log(`fetch de origin/develop impossible (${f.stderr}) : base sur l'état local`);
  }
  const local = refExists(root, "refs/heads/develop") ? gitOk(root, ["rev-parse", "refs/heads/develop"]) : null;
  const tracked = remote && refExists(root, "refs/remotes/origin/develop") ? gitOk(root, ["rev-parse", "refs/remotes/origin/develop"]) : null;
  if (!local && !tracked) throw new Error("aucune branche develop (ni locale, ni origin/develop)");
  if (!local) return tracked as string;
  if (!tracked || local === tracked || isAncestor(root, tracked, local)) return local;
  if (isAncestor(root, local, tracked)) return tracked;
  throw new Error("develop et origin/develop ont divergé : à réconcilier avant de créer un worktree");
}

function usesLfs(root: string): boolean {
  const attributes = join(root, ".gitattributes");
  return existsSync(attributes) && /filter=lfs/.test(readFileSync(attributes, "utf8"));
}

function registeredWorktree(root: string, path: string): boolean {
  const list = git(root, ["worktree", "list", "--porcelain"]).stdout;
  const target = resolve(path).toLowerCase();
  return list.split(/\r?\n/).some((l) => l.startsWith("worktree ") && resolve(l.slice("worktree ".length)).toLowerCase() === target);
}

export async function createWorktree(input: { cwd: string; name: string }, options: WorktreeOptions = {}): Promise<string> {
  const log = options.log ?? ((l: string) => process.stderr.write(`[spawn] ${l}\n`));
  const name = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name) throw new Error(`nom de worktree inutilisable : « ${input.name} »`);
  const project = findProject(input.cwd);

  if (project === null) {
    // Comportement par défaut de Claude Code : branche worktree-<nom> depuis origin/HEAD, sinon HEAD.
    const root = mainRoot(input.cwd);
    if (root === null) throw new Error(`${input.cwd} n'est pas dans un dépôt git`);
    const path = join(root, ".claude", "worktrees", name);
    if (registeredWorktree(root, path)) return path;
    const base = refExists(root, "refs/remotes/origin/HEAD") ? "origin/HEAD" : "HEAD";
    gitOk(root, ["worktree", "add", "-b", `worktree-${name}`, path, base]);
    return path;
  }

  const { root } = project;
  const path = join(root, ".claude", "worktrees", name);
  const branch = `feature/${name}`;
  if (registeredWorktree(root, path)) {
    log(`worktree ${name} déjà présent, repris tel quel`);
    return path;
  }

  const base = developBase(root, log);
  const branchExists = refExists(root, `refs/heads/${branch}`);
  gitOk(root, branchExists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, base]);
  log(`worktree ${name} créé sur ${branch} (${branchExists ? "branche existante" : `base ${base.slice(0, 10)}`})`);

  try {
    if (usesLfs(root)) {
      const lfs = git(path, ["lfs", "pull"]);
      if (lfs.code !== 0) throw new Error(`git lfs pull a échoué : ${lfs.stderr}`);
    }
    const adapter = loadAdapter(join(options.engines ?? process.env.SPAWN_ENGINES ?? ENGINES_DIR, project.config.engine));
    const prep = await callAdapter(adapter, "prepare-worktree", { project: path, source: root });
    if (prep.defects.length > 0 || !prep.result) {
      throw new Error(`adaptateur ${project.config.engine} non conforme : ${prep.defects.join(" ; ")}`);
    }
    if (!prep.result.ok) {
      const errors = prep.result.errors.map((e) => `${e.code} : ${e.message}`).join(" ; ");
      throw new Error(`préparation du worktree refusée par l'adaptateur : ${errors}${prep.result.log ? ` (journal : ${prep.result.log})` : ""}`);
    }

    const worktree = toSlash(relative(root, path));
    const story = readStory(root, name);
    if (story && story.status !== "cleaned") updateStory(root, name, { worktree, branch });
    else createStory(root, { story: name, branch, worktree, base: gitOk(path, ["rev-parse", "HEAD"]) });
  } catch (e) {
    // Un worktree à moitié prêt ne doit pas rester : c'est ce qui a produit les 85 worktrees sans import de Deep Front.
    git(root, ["worktree", "remove", "--force", path]);
    if (!branchExists) git(root, ["branch", "-D", branch]);
    throw e;
  }
  return path;
}

// Retrait d'un worktree. Un fichier au nom réservé de Windows (`nul`, laissé par une redirection `> nul` d'un agent
// sous bash) fait échouer `git worktree remove` : le dossier est alors supprimé par Node, puis git oublie le worktree.
export function removeWorktree(root: string, path: string): void {
  if (git(root, ["worktree", "remove", "--force", path]).code === 0) return;
  rmSync(path, { recursive: true, force: true, maxRetries: 5 });
  gitOk(root, ["worktree", "prune"]);
}

// Fusionnée = ancêtre de develop, ou citée par une ligne `Story-Head:` d'un squash de develop.
export function mergedBranch(root: string, branch: string): boolean {
  if (!refExists(root, "refs/heads/develop")) return false;
  if (isAncestor(root, branch, "refs/heads/develop")) return true;
  const head = gitOk(root, ["rev-parse", branch]);
  return git(root, ["log", "--format=%B", "refs/heads/develop"]).stdout.includes(`Story-Head: ${head}`);
}

const TRUNKS = new Set(["develop", "main", "master"]);

export function deleteWorktree(input: { cwd: string; worktree_path: string }, options: WorktreeOptions = {}): void {
  const log = options.log ?? ((l: string) => process.stderr.write(`[spawn] ${l}\n`));
  const path = resolve(input.worktree_path);
  if (!existsSync(path)) return;
  const root = mainRoot(path) ?? mainRoot(input.cwd);
  if (root === null) throw new Error(`${path} n'est pas un worktree git`);
  const project = findProject(root);

  if (project === null) {
    removeWorktree(root, path);
    return;
  }

  let branch: string | null = null;
  if (isWorktreeRoot(path)) {
    const dirty = git(path, ["status", "--porcelain"]).stdout;
    if (dirty) {
      throw new Error(`le worktree contient des modifications non commitées ; commiter ou les abandonner explicitement avant de le supprimer :\n${dirty}`);
    }
    branch = git(path, ["symbolic-ref", "--quiet", "--short", "HEAD"]).stdout || null;
    // --force : les fichiers ignorés (import du moteur, journaux) ne sont pas du travail.
    removeWorktree(root, path);
    log(`worktree ${toSlash(relative(root, path))} supprimé`);
  } else {
    // Reste d'un rangement interrompu : vide, il part ; sinon on ne sait pas ce qu'il contient, il reste.
    if (readdirSync(path).length > 0) throw new Error(`${path} n'est pas un worktree git (git l'a oublié) et n'est pas vide : à examiner à la main`);
    rmSync(path, { recursive: true, force: true, maxRetries: 5 });
    gitOk(root, ["worktree", "prune"]);
    log(`dossier vide ${toSlash(relative(root, path))} supprimé (worktree déjà oublié par git)`);
  }

  const name = path.split(/[\\/]/).pop() ?? "";
  const story = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ? readStory(root, name) : null;
  // La branche à supprimer est celle du fil, pas celle où se trouve le worktree : un orchestrateur qui y avait basculé
  // sur develop après la fusion faisait supprimer develop (essai du 18/11 ; git n'a refusé que parce que la racine
  // l'avait en cours). Un tronc n'est jamais supprimé.
  const target = story?.branch ?? branch;
  if (target && !TRUNKS.has(target) && refExists(root, `refs/heads/${target}`) && mergedBranch(root, target)) {
    gitOk(root, ["branch", "-D", target]);
    log(`branche ${target} supprimée (déjà dans develop)`);
    if (story && transitionAllowed(story.status, "cleaned")) updateStory(root, name, { status: "cleaned", worktree: null });
    else if (story && story.status !== "cleaned") updateStory(root, name, { worktree: null });
  } else {
    if (target) log(`branche ${target} gardée : ${TRUNKS.has(target) ? "tronc" : "absente ou pas encore dans develop"}`);
    if (story && story.status !== "cleaned") updateStory(root, name, { worktree: null });
  }
}
