// Charge de la machine (docs/reglages.md §3.2) : `"load"` de `~/.spawn/app.json`, lu par le service (stories au travail,
// file d'attente) et par le hook de réservation des sous-agents (agents de tous les projets). `parallel_agents` de
// spawn.json reste la limite de chaque projet, sous celle-ci.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Load {
  stories: number;
  agents: number;
  // Identifiants de projets du registre, du plus prioritaire au moins prioritaire ; un projet absent passe après.
  projects: string[];
}

export const DEFAULT_LOAD: Load = { stories: 2, agents: 4, projects: [] };
export const LOAD_BOUNDS = { stories: [1, 10], agents: [1, 20] } as const;

const appPath = () => join(process.env.SPAWN_CONFIG || join(homedir(), ".spawn"), "app.json");

function readApp(): Record<string, unknown> {
  const path = appPath();
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    throw new Error(`${path} illisible : le corriger ou le supprimer`);
  }
}

const bounded = (v: unknown, [min, max]: readonly [number, number], fallback: number) => (typeof v === "number" && Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : fallback);

export function readLoad(): Load {
  const raw = (readApp().load ?? {}) as Partial<Record<keyof Load, unknown>>;
  return {
    stories: bounded(raw.stories, LOAD_BOUNDS.stories, DEFAULT_LOAD.stories),
    agents: bounded(raw.agents, LOAD_BOUNDS.agents, DEFAULT_LOAD.agents),
    projects: Array.isArray(raw.projects) ? raw.projects.filter((p): p is string => typeof p === "string") : [],
  };
}

// Réécrit seulement `load` : les modules et les moteurs, écrits par le service, restent tels quels.
export function writeLoad(load: Load): void {
  const app = readApp();
  mkdirSync(dirname(appPath()), { recursive: true });
  writeFileSync(appPath(), JSON.stringify({ ...app, load }, null, 2) + "\n");
}
