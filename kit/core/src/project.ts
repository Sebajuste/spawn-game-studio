// Projet Spawn : `spawn.json` à la racine du checkout principal ; les worktrees vivent dessous.
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DESCRIPTOR_FILE, loadAdapter, type Adapter } from "./adapter/call.ts";
import { git } from "./git.ts";
import { KIT_CORE } from "./location.ts";

// Ce que comptent les nombres est écrit dans le nom : l'essai du morpion a lu « 3 sous-agents » comme un total.
export interface Limits {
  // Sous-agents qui tournent en même temps dans tout le projet (tous fils et sessions confondus).
  parallel_agents: number;
  // Rounds de correction par tâche avant de la parquer.
  rounds: number;
  model: string;
  escalation_model: string;
}

export const DEFAULT_LIMITS: Limits = { parallel_agents: 3, rounds: 5, model: "sonnet", escalation_model: "opus" };

export interface ProjectConfig {
  engine: string;
  version: string;
  // Préfixe des exigences (`<TAG>-NN`).
  tag?: string;
  limits: Limits;
}

function readLimits(path: string, raw: unknown): Limits {
  if (raw === undefined) return { ...DEFAULT_LIMITS };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${path} : "limits" doit être un objet`);
  const l = { ...DEFAULT_LIMITS, ...(raw as Partial<Limits>) };
  for (const [key, max] of [["parallel_agents", 10], ["rounds", 10]] as const) {
    if (!Number.isInteger(l[key]) || l[key] < 1 || l[key] > max) throw new Error(`${path} : "limits.${key}" doit être un entier de 1 à ${max}`);
  }
  for (const key of ["model", "escalation_model"] as const) {
    if (typeof l[key] !== "string" || !l[key]) throw new Error(`${path} : "limits.${key}" doit être un nom de modèle`);
  }
  const unknownList = Object.keys(raw).filter((k) => !(k in DEFAULT_LIMITS));
  if (unknownList.length > 0) throw new Error(`${path} : limite inconnue ${unknownList.join(", ")} (connues : ${Object.keys(DEFAULT_LIMITS).join(", ")})`);
  return l;
}

export interface Project {
  // Checkout principal : le dossier qui porte `.spawn/` et `.claude/worktrees/`.
  root: string;
  config: ProjectConfig;
}

export const ENGINES_DIR = join(KIT_CORE, "..", "engines");

export function readConfig(path: string): ProjectConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${path} illisible : ${(e as Error).message}`, { cause: e });
  }
  const c = raw as Partial<Record<string, unknown>>;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${path} : un objet JSON est attendu`);
  if (typeof c.engine !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.engine)) {
    throw new Error(`${path} : "engine" doit être un identifiant de moteur (ex. "godot")`);
  }
  if (typeof c.version !== "string" || !/^\d+(\.\d+)*$/.test(c.version)) {
    throw new Error(`${path} : "version" doit être une version numérique (ex. "4.7.2")`);
  }
  if (c.tag !== undefined && (typeof c.tag !== "string" || !/^[A-Z][A-Z0-9]{1,5}$/.test(c.tag))) {
    throw new Error(`${path} : "tag" doit faire 2 à 6 majuscules (ex. "MRP")`);
  }
  return { engine: c.engine, version: c.version, ...(typeof c.tag === "string" ? { tag: c.tag } : {}), limits: readLimits(path, c.limits) };
}

// Racine du checkout principal pour un dossier quelconque du dépôt, worktree compris.
export function mainRoot(dir: string): string | null {
  const r = git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (r.code !== 0 || !r.stdout) return null;
  const common = isAbsolute(r.stdout) ? r.stdout : resolve(dir, r.stdout);
  // Un dépôt nu n'a pas de checkout principal.
  return common.endsWith(".git") || common.endsWith(".git/") ? dirname(common) : null;
}

// Projet Spawn qui contient ce dossier, ou null si ce n'en est pas un (le kit n'agit alors pas).
export function findProject(dir: string): Project | null {
  if (!existsSync(dir)) return null;
  const root = mainRoot(dir);
  if (root === null) return null;
  const path = join(root, "spawn.json");
  if (!existsSync(path)) return null;
  return { root, config: readConfig(path) };
}

export function projectAdapter(project: Project): Adapter {
  // SPAWN_ENGINES remplace le dossier des adaptateurs (tests, adaptateur en développement).
  const dir = join(process.env.SPAWN_ENGINES ?? ENGINES_DIR, project.config.engine);
  if (!existsSync(join(dir, DESCRIPTOR_FILE))) {
    throw new Error(`aucun adaptateur pour le moteur « ${project.config.engine} » (attendu : ${dir})`);
  }
  return loadAdapter(dir);
}
