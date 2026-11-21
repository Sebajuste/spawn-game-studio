// Adoption d'un projet existant (docs/adoption.md §3) : le diagnostic est refait, puis git, spawn.json, gabarit du
// moteur, .gitignore, hooks et plugin, un seul commit sur develop, la suite de départ et l'inscription. Rien n'est poussé.
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { callAdapter, loadAdapter, type Adapter } from "../adapter/call.ts";
import { enginesDir } from "../adapters.ts";
import type { AdoptData, AdoptGap } from "../adapter/types.ts";
import { git, gitOk } from "../git.ts";
import { apply, installPlan, run, type Runner } from "../prerequisites.ts";
import { register, type RegisteredProject } from "../registry.ts";
import { addProject } from "../workspaces.ts";
import { diagnose, EXCLUDED, type Diagnosis } from "./diagnose.ts";
import { appendGitignore, spawnConfig } from "./files.ts";
import { readGitState } from "./git.ts";
import { GIT_HOOKS } from "./hooks.ts";

export const ADOPTION_COMMIT = "spawn : adoption";

export interface AdoptRequest {
  dir: string;
  engine: string;
  version: string;
  tag: string;
  workspace?: string;
  engines?: string;
  run?: Runner;
  log?: (line: string) => void;
}

export interface Baseline {
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  message: string | null;
}

export interface Adoption {
  project: RegisteredProject;
  commit: string | null;
  baseline: Baseline | null;
  gaps: AdoptGap[];
  // Fichiers laissés non commités par la suite de départ : dits, jamais commités d'office.
  leftovers: string[];
}

// Refus porteur du diagnostic refait : l'app le montre à la place de l'ancien.
export class AdoptionRefused extends Error {
  readonly diagnosis: Diagnosis;
  constructor(diagnosis: Diagnosis) {
    const stops = diagnosis.points.filter((p) => p.status === "stop").map((p) => p.label);
    super(`adoption refusée : ${stops.join(" ; ")}`);
    this.diagnosis = diagnosis;
  }
}

async function requireOk(adapter: Adapter, sub: string, options: Record<string, string | string[]>) {
  const r = await callAdapter(adapter, sub, options);
  if (!r.result || r.defects.length > 0) throw new Error(`adaptateur ${sub} non conforme : ${r.defects.join(" ; ")}`);
  if (!r.result.ok) throw new Error(`${sub} a échoué : ${r.result.errors.map((e) => `${e.code} : ${e.message}`).join(" ; ")}`);
  return r.result;
}

// La suite de départ dit l'état du projet tel qu'il est : rouge, elle est montrée, pas bloquante.
async function baseline(adapter: Adapter, root: string): Promise<Baseline> {
  try {
    await requireOk(adapter, "prepare-worktree", { project: root });
    const r = await callAdapter(adapter, "test", { project: root });
    if (!r.result) return { ok: false, total: 0, passed: 0, failed: 0, message: `test non conforme : ${r.defects.join(" ; ")}` };
    const d = r.result.data as { total?: number; passed?: number; failed?: number };
    const message = r.result.ok ? null : r.result.errors.map((e) => e.message).join(" ; ");
    return { ok: r.result.ok, total: Number(d.total ?? 0), passed: Number(d.passed ?? 0), failed: Number(d.failed ?? 0), message };
  } catch (e) {
    return { ok: false, total: 0, passed: 0, failed: 0, message: (e as Error).message };
  }
}

function registerIn(root: string, workspace: string | undefined): RegisteredProject {
  const project = register(root);
  if (workspace) addProject(workspace, project.id);
  return project;
}

export async function adoptProject(d: AdoptRequest): Promise<Adoption> {
  const log = d.log ?? ((l: string) => console.log(l));
  const ex = d.run ?? run;
  const root = resolve(d.dir);
  if (existsSync(join(root, "spawn.json"))) {
    const project = registerIn(root, d.workspace);
    log(`déjà un projet Spawn : inscrit (${project.id})`);
    return { project, commit: null, baseline: null, gaps: [], leftovers: [] };
  }
  if (!/^[A-Z][A-Z0-9]{1,5}$/.test(d.tag)) throw new Error(`préfixe d'exigences invalide : « ${d.tag} » (2 à 6 majuscules, ex. MRP)`);
  if (!/^\d+(\.\d+)*$/.test(d.version)) throw new Error(`version du moteur invalide : « ${d.version} »`);

  const diagnosis = await diagnose(root, { engine: d.engine, ...(d.engines ? { engines: d.engines } : {}) });
  if (!diagnosis.ready) throw new AdoptionRefused(diagnosis);
  const adapter = loadAdapter(join(d.engines ?? enginesDir(), d.engine));
  const before = readGitState(root);
  const branch = before.branch as string;

  // Jusqu'au commit, un échec rend le dépôt tel que le diagnostic l'a vu (arbre propre : rien d'autre n'est perdu).
  let gaps: AdoptGap[];
  try {
    if (!before.develop) {
      gitOk(root, ["branch", "develop"]);
      log(`branche develop créée depuis ${branch}`);
    }
    if (branch !== "develop") gitOk(root, ["checkout", "--quiet", "develop"]);

    writeFileSync(join(root, "spawn.json"), spawnConfig(d.engine, d.version, d.tag));
    const adopted = (await requireOk(adapter, "adopt", { project: root, exclude: EXCLUDED })).data as unknown as AdoptData;
    gaps = adopted.gaps;
    log(`gabarit ${d.engine} posé : ${adopted.files.map((f) => f.path).join(", ") || "rien à ajouter"}`);

    appendGitignore(root, diagnosis.gitignore);
    if (diagnosis.gitignore.length > 0) log(`.gitignore : ${diagnosis.gitignore.join(" ")}`);
    gitOk(root, ["config", "core.hooksPath", GIT_HOOKS]);
    log("hooks git du kit réglés");

    const plan = installPlan(root, ex);
    const failures = apply(plan, ex);
    if (failures.length > 0) throw new Error(`installation du plugin : ${failures.join(" ; ")}`);
    log(plan.length > 0 ? "plugin spawnstudio activé pour ce projet" : "Claude Code absent : pas de plugin à installer");

    gitOk(root, ["add", "-A"]);
    gitOk(root, ["commit", "--quiet", "-m", ADOPTION_COMMIT]);
  } catch (e) {
    git(root, ["reset", "--hard", "--quiet"]);
    git(root, ["clean", "-fdq"]);
    git(root, ["checkout", "--quiet", branch]);
    if (!before.develop) git(root, ["branch", "-D", "develop"]);
    if (before.hooksPath === null) git(root, ["config", "--unset", "core.hooksPath"]);
    throw e;
  }
  const commit = gitOk(root, ["rev-parse", "--short", "HEAD"]);
  log(`commit ${commit} « ${ADOPTION_COMMIT} » sur develop (rien n'est poussé)`);

  const suite = await baseline(adapter, root);
  log(suite.ok ? `suite de départ verte : ${suite.passed}/${suite.total}` : `suite de départ rouge : ${suite.message ?? `${suite.failed} échec(s)`}`);
  const leftovers = readGitState(root).dirty;
  if (leftovers.length > 0) log(`laissé non commité par la suite de départ : ${leftovers.join(", ")}`);

  const project = registerIn(root, d.workspace);
  log(`inscrit dans l'app (${project.id})`);
  return { project, commit, baseline: suite, gaps, leftovers };
}
