// Registre des projets de la machine (`~/.spawn/projects.json`), lu par l'app ; `new-game` y inscrit chaque jeu créé.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { findProject } from "./project.ts";

export interface RegisteredProject {
  id: string;
  name: string;
  root: string;
}

export function registryPath(): string {
  return join(process.env.SPAWN_CONFIG || join(homedir(), ".spawn"), "projects.json");
}

export function readRegistry(): RegisteredProject[] {
  const path = registryPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { projects?: RegisteredProject[] };
    return Array.isArray(raw.projects) ? raw.projects : [];
  } catch {
    throw new Error(`${path} illisible : le corriger ou le supprimer`);
  }
}

function writeRegistry(projects: RegisteredProject[]): void {
  mkdirSync(dirname(registryPath()), { recursive: true });
  writeFileSync(registryPath(), JSON.stringify({ projects }, null, 2) + "\n");
}

// Identifiant stable et lisible : le nom du dossier, suffixé si deux projets le partagent.
function identifier(root: string, taken: readonly string[]): string {
  const base = basename(root).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

export function register(dir: string, name?: string): RegisteredProject {
  const project = findProject(resolve(dir));
  if (project === null) throw new Error(`${dir} n'est pas un projet Spawn (spawn.json introuvable à la racine du dépôt)`);
  const projects = readRegistry();
  const already = projects.find((p) => resolve(p.root).toLowerCase() === resolve(project.root).toLowerCase());
  if (already) return already;
  const registered = { id: identifier(project.root, projects.map((p) => p.id)), name: name ?? basename(project.root), root: project.root };
  writeRegistry([...projects, registered]);
  return registered;
}

export function unregister(id: string): boolean {
  const projects = readRegistry();
  const remaining = projects.filter((p) => p.id !== id);
  if (remaining.length === projects.length) return false;
  writeRegistry(remaining);
  return true;
}
