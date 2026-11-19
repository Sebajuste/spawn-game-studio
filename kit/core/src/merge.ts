// File de fusion v1, exécuteur fichiers (docs/kit-perimetre.md D7, §9), à la taille d'un petit projet :
// la suite complète rejoue à chaque fusion. Aucun LLM : l'agent inscrit sa branche, l'outil fait le reste.
// `develop` n'avance qu'en dernier, après le push : un traiteur tué en route ne laisse rien à moitié.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { callAdapter, loadAdapter, type Adapter } from "./adapter/call.ts";
import { readStory, updateStory, transitionAllowed } from "./stories.ts";
import { currentBranch, git, gitOk } from "./git.ts";
import { ENGINES_DIR, type Project } from "./project.ts";

export interface QueueEntry {
  story: string;
  branch: string;
  head: string;
  summary: string;
  enqueued: string;
}

export type Verdict = "queued" | "merged" | "refused" | "error";

export interface Decision {
  date: string;
  story: string;
  branch: string;
  head: string;
  verdict: Verdict;
  cause?: string;
  detail?: string;
  commit?: string;
}

export interface MergeOptions {
  engines?: string;
  log?: (line: string) => void;
}

const mergeDir = (root: string) => join(root, ".git", "spawn", "merge");
const queueDir = (root: string) => join(mergeDir(root), "queue");
const logPath = (root: string) => join(mergeDir(root), "log.jsonl");
const lockPath = (root: string) => join(mergeDir(root), "lock.json");
// Sous `.spawn/` : ignoré par git et par le moteur.
const integrationDir = (root: string) => join(root, ".spawn", "merge", "integration");
// Journaux des refus, hors du dossier d'intégration effacé après chaque fusion (essai du 18/11 : le refus citait un
// journal déjà supprimé, et la cause est restée inconnue).
export const refusalLogsDir = (root: string) => join(root, ".spawn", "merge", "logs");

function record(root: string, d: Omit<Decision, "date">): Decision {
  const decision: Decision = { date: new Date().toISOString(), ...d };
  mkdirSync(mergeDir(root), { recursive: true });
  appendFileSync(logPath(root), JSON.stringify(decision) + "\n");
  return decision;
}

export function readDecisions(root: string): Decision[] {
  const path = logPath(root);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Decision);
}

export function readQueue(root: string): { file: string; entry: QueueEntry }[] {
  const dir = queueDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: join(dir, f), entry: JSON.parse(readFileSync(join(dir, f), "utf8")) as QueueEntry }));
}

// L'agent inscrit sa branche depuis son worktree. Une réinscription remplace la précédente du même fil.
export function enqueue(project: Project, story: string, dir: string, summary: string): QueueEntry {
  const dirty = git(dir, ["status", "--porcelain"]).stdout;
  if (dirty) throw new Error(`le worktree contient des modifications non commitées : commiter avant d'inscrire\n${dirty}`);
  const branch = currentBranch(dir);
  const state = readStory(project.root, story);
  if (!branch || (state && state.branch !== branch)) throw new Error(`branche courante ${branch ?? "(détachée)"} : attendu ${state?.branch ?? "la branche du fil"}`);
  const entry: QueueEntry = { story, branch, head: gitOk(dir, ["rev-parse", "HEAD"]), summary: summary.trim() || story, enqueued: new Date().toISOString() };
  for (const { file, entry: i } of readQueue(project.root)) if (i.story === story) rmSync(file, { force: true });
  mkdirSync(queueDir(project.root), { recursive: true });
  writeFileSync(join(queueDir(project.root), `${Date.now()}-${process.pid}-${story}.json`), JSON.stringify(entry, null, 2) + "\n", { flag: "wx" });
  if (state && state.status !== "done" && transitionAllowed(state.status, "done")) updateStory(project.root, story, { status: "done" });
  record(project.root, { story, branch, head: entry.head, verdict: "queued" });
  return entry;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Verrou par création exclusive ; un verrou dont le processus est mort est repris.
function acquireLock(root: string, log: (l: string) => void): boolean {
  mkdirSync(mergeDir(root), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath(root), JSON.stringify({ pid: process.pid, since: new Date().toISOString() }), { flag: "wx" });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let pid = 0;
      try {
        pid = (JSON.parse(readFileSync(lockPath(root), "utf8")) as { pid: number }).pid;
      } catch {
        // Verrou illisible : écrit à moitié par un traiteur tué, donc repris.
      }
      if (pid && processAlive(pid)) return false;
      log(`verrou abandonné par le processus ${pid || "?"} : repris`);
      rmSync(lockPath(root), { force: true });
    }
  }
  return false;
}

function removeIntegration(root: string): void {
  const path = integrationDir(root);
  if (existsSync(path)) git(root, ["worktree", "remove", "--force", path]);
  rmSync(path, { recursive: true, force: true, maxRetries: 5 });
  git(root, ["worktree", "prune"]);
}

const hasRemote = (root: string) => git(root, ["remote"]).stdout.split(/\s+/).includes("origin");

function isAncestor(root: string, a: string, b: string): boolean {
  return git(root, ["merge-base", "--is-ancestor", a, b]).code === 0;
}

// Fait avancer `develop` local, en mettant à jour le checkout principal s'il est sur develop.
function advanceDevelop(root: string, legacy: string, created: string): void {
  if (currentBranch(root) === "develop") gitOk(root, ["merge", "--quiet", "--ff-only", created]);
  else gitOk(root, ["update-ref", "refs/heads/develop", created, legacy]);
}

class InfraError extends Error {}
class Refusal extends Error {
  readonly cause: string;
  readonly log: string | null;
  constructor(cause: string, detail: string, log: string | null = null) {
    super(detail);
    this.cause = cause;
    this.log = log;
  }
}

function keepLog(root: string, story: string, log: string): string {
  const dir = refusalLogsDir(root);
  mkdirSync(dir, { recursive: true });
  const kept = join(dir, `${story}-${basename(log)}`);
  copyFileSync(log, kept);
  return kept;
}

function syncDevelop(root: string): string {
  const local = gitOk(root, ["rev-parse", "refs/heads/develop"]);
  if (!hasRemote(root)) return local;
  const f = git(root, ["fetch", "--quiet", "origin", "develop"]);
  if (f.code !== 0) throw new InfraError(`fetch de origin/develop impossible : ${f.stderr}`);
  const remote = gitOk(root, ["rev-parse", "refs/remotes/origin/develop"]);
  if (remote === local || isAncestor(root, remote, local)) return local;
  if (!isAncestor(root, local, remote)) throw new InfraError("develop et origin/develop ont divergé : à réconcilier à la main");
  advanceDevelop(root, local, remote);
  return remote;
}

function alreadyMerged(root: string, head: string): boolean {
  return isAncestor(root, head, "refs/heads/develop") || git(root, ["log", "--format=%B", "refs/heads/develop"]).stdout.includes(`Story-Head: ${head}`);
}

async function requireStep(adapter: Adapter, sub: string, project: string, cause: string, keep: (log: string) => string): Promise<void> {
  const r = await callAdapter(adapter, sub, { project: project });
  if (!r.result || r.defects.length > 0) throw new InfraError(`adaptateur ${sub} non conforme : ${r.defects.join(" ; ")}`);
  if (!r.result.ok) {
    const errors = r.result.errors.slice(0, 5).map((e) => `${e.code}${e.file ? ` ${e.file}${e.line ? `:${e.line}` : ""}` : ""} : ${e.message}`);
    const log = r.result.log && existsSync(r.result.log) ? keep(r.result.log) : null;
    throw new Refusal(cause, `${sub} : ${errors.join(" ; ")}${log ? ` (journal : ${log})` : ""}`, log);
  }
}

async function mergeOne(project: Project, i: QueueEntry, adapter: Adapter, log: (l: string) => void): Promise<string> {
  const { root } = project;
  const base = syncDevelop(root);
  if (alreadyMerged(root, i.head)) return base;
  const currentHead = git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${i.branch}`]).stdout;
  if (currentHead !== i.head) throw new Refusal("head-changed", `${i.branch} a bougé depuis l'inscription (${i.head.slice(0, 10)} → ${currentHead.slice(0, 10) || "supprimée"}) : réinscrire`);

  removeIntegration(root);
  const integ = integrationDir(root);
  gitOk(root, ["worktree", "add", "--quiet", "--detach", integ, base]);
  const merge = git(integ, ["merge", "--squash", "--quiet", i.head]);
  if (merge.code !== 0) {
    const files = git(integ, ["diff", "--name-only", "--diff-filter=U"]).stdout.split(/\r?\n/).filter(Boolean);
    throw new Refusal("conflict", `conflit avec develop sur ${files.join(", ") || "(voir git)"} : intégrer develop dans la branche, puis réinscrire`);
  }
  if (!git(integ, ["diff", "--cached", "--name-only"]).stdout) throw new Refusal("empty", "la branche n'apporte aucun changement à develop");
  const commits = gitOk(root, ["log", "--reverse", "--format=- %s", `${base}..${i.head}`]);
  gitOk(integ, ["commit", "--quiet", "-m", `${i.story} : ${i.summary}`, "-m", `Commits de la branche :\n${commits}`, "-m", `Story-Head: ${i.head}`]);
  const created = gitOk(integ, ["rev-parse", "HEAD"]);
  log(`${i.story} : intégré sur ${base.slice(0, 10)}, vérification`);

  const keep = (l: string) => keepLog(root, i.story, l);
  await requireStep(adapter, "prepare-worktree", integ, "import", keep);
  await requireStep(adapter, "compile", integ, "failing", keep);
  await requireStep(adapter, "test", integ, "failing", keep);
  // develop reste jouable : la scène principale doit se lancer sans erreur (§0, « vrai »).
  await requireStep(adapter, "smoke-test", integ, "failing", keep);
  const rewritten = git(integ, ["status", "--porcelain"]).stdout;
  if (rewritten) throw new Refusal("import", `le moteur a réécrit des fichiers suivis : ${rewritten.replace(/\s+/g, " ")} ; les générer dans le worktree par spawn engine prepare-worktree (import du moteur), les commiter, puis réinscrire`);

  if (process.env.SPAWN_MERGE_FAULT === "before-develop") process.exit(9);
  if (hasRemote(root)) {
    const p = git(root, ["push", "--quiet", "origin", `${created}:refs/heads/develop`]);
    if (p.code !== 0) throw new InfraError(`push vers origin/develop refusé : ${p.stderr}`);
  }
  advanceDevelop(root, base, created);
  return created;
}

export type Issue = "busy" | "empty" | "processed";

// Traite toute la file sous verrou. Une erreur d'infrastructure (pas la faute de la branche) garde l'inscription et arrête.
export async function processQueue(project: Project, options: MergeOptions = {}): Promise<Issue> {
  const { root } = project;
  const log = options.log ?? ((l: string) => process.stderr.write(`[fusion] ${l}\n`));
  if (!acquireLock(root, log)) return "busy";
  try {
    const adapter = loadAdapter(join(options.engines ?? process.env.SPAWN_ENGINES ?? ENGINES_DIR, project.config.engine));
    let processed = false;
    for (;;) {
      const head = readQueue(root)[0];
      if (!head) return processed ? "processed" : "empty";
      const { file, entry: i } = head;
      processed = true;
      try {
        const commit = await mergeOne(project, i, adapter, log);
        record(root, { story: i.story, branch: i.branch, head: i.head, verdict: "merged", commit });
        log(`${i.story} : fusionnée dans develop (${commit.slice(0, 10)})`);
      } catch (e) {
        if (!(e instanceof Refusal)) {
          record(root, { story: i.story, branch: i.branch, head: i.head, verdict: "error", detail: (e as Error).message });
          log(`${i.story} : erreur, inscription gardée : ${(e as Error).message}`);
          return "processed";
        }
        record(root, { story: i.story, branch: i.branch, head: i.head, verdict: "refused", cause: e.cause, detail: e.message });
        log(`${i.story} : refusée (${e.cause}) : ${e.message}`);
        const state = readStory(root, i.story);
        if (state && transitionAllowed(state.status, "active")) {
          updateStory(root, i.story, { status: "active", task: `fusion refusée (${e.cause})`, first_step: `corriger : ${e.message.slice(0, 300)}${e.log ? ` (journal : ${e.log})` : ""} ; puis spawn merge` });
        }
      } finally {
        removeIntegration(root);
      }
      rmSync(file, { force: true });
    }
  } finally {
    rmSync(lockPath(root), { force: true });
  }
}

export function verdictSince(root: string, story: string, head: string, since: string): Decision | null {
  return readDecisions(root).find((d) => d.story === story && d.head === head && d.date >= since && d.verdict !== "queued") ?? null;
}

// Inscrit puis rend le verdict : traite la file si personne ne le fait, sinon attend le traiteur en cours.
export async function mergeStory(project: Project, story: string, dir: string, summary: string, options: MergeOptions & { timeoutMs?: number } = {}): Promise<Decision> {
  const i = enqueue(project, story, dir, summary);
  const end = Date.now() + (options.timeoutMs ?? 30 * 60_000);
  for (;;) {
    const issue = await processQueue(project, options);
    const verdict = verdictSince(project.root, story, i.head, i.enqueued);
    if (verdict) return verdict;
    if (issue !== "busy") {
      // La file s'est arrêtée avant notre inscription : une erreur d'infrastructure sur une autre la bloque.
      const blocking = readDecisions(project.root).filter((d) => d.verdict === "error").pop();
      throw new Error(`file de fusion arrêtée avant cette inscription${blocking ? ` : ${blocking.story} : ${blocking.detail ?? ""}` : ""} ; l'inscription reste en file`);
    }
    if (Date.now() > end) throw new Error("délai dépassé en attente de la file de fusion ; l'inscription reste en file");
    await new Promise((r) => setTimeout(r, 1000));
  }
}
