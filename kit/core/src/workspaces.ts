// Workspaces (docs/workspaces.md) : des projets regroupés en produit, et des epics dont les stories visent plusieurs
// projets. Stockés dans `~/.spawn/workspaces.json` ; un projet ne connaît pas ses workspaces, et chaque story reste
// dans son projet. Le suivi local est l'implémentation par défaut d'un éventuel plugin de suivi (Jira…).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { readRegistry, type RegisteredProject } from "./registry.ts";
import { readStory, type Story } from "./stories.ts";

export interface StoryRef {
  project: string;
  story: string;
}

export interface EpicStory extends StoryRef {
  blocked_by: StoryRef[];
}

export interface Epic {
  id: string;
  title: string;
  acceptance: string[];
  stories: EpicStory[];
}

export interface Workspace {
  id: string;
  name: string;
  projects: string[];
  epics: Epic[];
}

// `SPAWN_WORKSPACES` place le fichier dans un dépôt git d'équipe (suivi partagé, versionné). Le registre des projets reste
// local : il contient des chemins propres à la machine.
export function workspacesPath(): string {
  return process.env.SPAWN_WORKSPACES || join(process.env.SPAWN_CONFIG || join(homedir(), ".spawn"), "workspaces.json");
}

export function readWorkspaces(): Workspace[] {
  const path = workspacesPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { workspaces?: Workspace[] };
    return Array.isArray(raw.workspaces) ? raw.workspaces : [];
  } catch {
    throw new Error(`${path} illisible : le corriger ou le supprimer`);
  }
}

function writeWorkspaces(workspaces: Workspace[]): void {
  const path = workspacesPath();
  mkdirSync(dirname(path), { recursive: true });
  // Fichier temporaire puis renommage : un arrêt en cours d'écriture ne laisse pas un JSON tronqué, et le diff git reste propre.
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ workspaces }, null, 2) + "\n");
  renameSync(tmp, path);
}

const kebab = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const same = (a: StoryRef, b: StoryRef) => a.project === b.project && a.story === b.story;

function knownProjects(): Map<string, RegisteredProject> {
  return new Map(readRegistry().map((p) => [p.id, p]));
}

function workspaceById(all: Workspace[], id: string): Workspace {
  const w = all.find((x) => x.id === id);
  if (!w) throw new Error(`workspace inconnu : ${id}`);
  return w;
}

function epicById(w: Workspace, id: string): Epic {
  const e = w.epics.find((x) => x.id === id);
  if (!e) throw new Error(`epic inconnu : ${id} (workspace ${w.id})`);
  return e;
}

export function createWorkspace(name: string, projects: string[]): Workspace {
  const id = kebab(name);
  if (!id) throw new Error("nom de workspace invalide");
  const all = readWorkspaces();
  if (all.some((w) => w.id === id)) throw new Error(`le workspace « ${id} » existe déjà`);
  const known = knownProjects();
  const unknown = projects.filter((p) => !known.has(p));
  if (unknown.length > 0) throw new Error(`projets inconnus du registre : ${unknown.join(", ")}`);
  const workspace: Workspace = { id, name: name.trim(), projects: [...new Set(projects)], epics: [] };
  writeWorkspaces([...all, workspace]);
  return workspace;
}

export function removeWorkspace(id: string): boolean {
  const all = readWorkspaces();
  const rest = all.filter((w) => w.id !== id);
  if (rest.length === all.length) return false;
  writeWorkspaces(rest);
  return true;
}

export function addProject(workspaceId: string, project: string): Workspace {
  const all = readWorkspaces();
  const w = workspaceById(all, workspaceId);
  if (!knownProjects().has(project)) throw new Error(`projet inconnu du registre : ${project}`);
  if (!w.projects.includes(project)) w.projects.push(project);
  writeWorkspaces(all);
  return w;
}

// L'identifiant ne change pas : les liens et le suivi partagé restent valides.
export function renameWorkspace(id: string, name: string): Workspace {
  if (!name.trim()) throw new Error("nom de workspace requis");
  const all = readWorkspaces();
  const w = workspaceById(all, id);
  w.name = name.trim();
  writeWorkspaces(all);
  return w;
}

export function removeProject(workspaceId: string, project: string): Workspace {
  const all = readWorkspaces();
  const w = workspaceById(all, workspaceId);
  const carrying = w.epics.filter((e) => e.stories.some((s) => s.project === project)).map((e) => e.id);
  if (carrying.length > 0) throw new Error(`le projet « ${project} » porte des stories de ${carrying.join(", ")} : les retirer d'abord de l'epic`);
  w.projects = w.projects.filter((p) => p !== project);
  writeWorkspaces(all);
  return w;
}

// Un projet qui quitte Spawn sort de tous les workspaces, avec ses stories d'epic et les dépendances vers elles.
export function forgetProject(project: string): void {
  const all = readWorkspaces();
  let changed = false;
  for (const w of all) {
    if (w.projects.includes(project)) changed = true;
    w.projects = w.projects.filter((p) => p !== project);
    for (const e of w.epics) {
      const kept = e.stories.filter((s) => s.project !== project);
      if (kept.length !== e.stories.length) changed = true;
      e.stories = kept.map((s) => ({ ...s, blocked_by: s.blocked_by.filter((b) => b.project !== project) }));
    }
  }
  if (changed) writeWorkspaces(all);
}

export function renameEpic(workspaceId: string, epicId: string, title: string): Epic {
  if (!title.trim()) throw new Error("titre d'epic requis");
  const all = readWorkspaces();
  const epic = epicById(workspaceById(all, workspaceId), epicId);
  epic.title = title.trim();
  writeWorkspaces(all);
  return epic;
}

// Les stories restent dans leurs projets : seul le regroupement disparaît.
export function removeEpic(workspaceId: string, epicId: string): boolean {
  const all = readWorkspaces();
  const w = workspaceById(all, workspaceId);
  const rest = w.epics.filter((e) => e.id !== epicId);
  if (rest.length === w.epics.length) return false;
  w.epics = rest;
  writeWorkspaces(all);
  return true;
}

export function createEpic(workspaceId: string, title: string, acceptance: string[]): Epic {
  if (!title.trim()) throw new Error("titre d'epic requis");
  const all = readWorkspaces();
  const w = workspaceById(all, workspaceId);
  const key = w.id.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "EP";
  const taken = new Set(w.epics.map((e) => e.id));
  let n = w.epics.length + 1;
  while (taken.has(`${key}-${n}`)) n++;
  const epic: Epic = { id: `${key}-${n}`, title: title.trim(), acceptance: acceptance.map((a) => a.trim()).filter(Boolean), stories: [] };
  w.epics.push(epic);
  writeWorkspaces(all);
  return epic;
}

// Une dépendance fait partie du même epic ; l'ordre ne doit pas former de cycle.
function hasCycle(stories: readonly EpicStory[]): boolean {
  const visiting = new Set<string>();
  const done = new Set<string>();
  const key = (s: StoryRef) => `${s.project}/${s.story}`;
  const visit = (s: EpicStory): boolean => {
    if (done.has(key(s))) return false;
    if (visiting.has(key(s))) return true;
    visiting.add(key(s));
    for (const d of s.blocked_by) {
      const dep = stories.find((x) => same(x, d));
      if (dep && visit(dep)) return true;
    }
    visiting.delete(key(s));
    done.add(key(s));
    return false;
  };
  return stories.some(visit);
}

export function addEpicStory(workspaceId: string, epicId: string, ref: StoryRef, blockedBy: StoryRef[] = []): Epic {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(ref.story)) throw new Error(`nom de story invalide : « ${ref.story} » (minuscules, chiffres, tirets)`);
  const all = readWorkspaces();
  const w = workspaceById(all, workspaceId);
  const epic = epicById(w, epicId);
  if (!w.projects.includes(ref.project)) throw new Error(`le projet « ${ref.project} » n'est pas dans le workspace ${w.id}`);
  if (epic.stories.some((s) => same(s, ref))) throw new Error(`la story ${ref.project}/${ref.story} est déjà dans ${epic.id}`);
  for (const d of blockedBy) {
    if (!epic.stories.some((s) => same(s, d))) throw new Error(`dépendance inconnue dans ${epic.id} : ${d.project}/${d.story} (l'ajouter d'abord)`);
  }
  // Une nouvelle story ne peut dépendre que de stories déjà là : aucun cycle possible à l'ajout ; hasCycle garde le fichier
  // sain s'il a été édité à la main.
  epic.stories.push({ ...ref, blocked_by: blockedBy });
  if (hasCycle(epic.stories)) throw new Error("dépendances circulaires");
  writeWorkspaces(all);
  return epic;
}

// État d'une story d'epic : « absente » tant que le projet n'a pas démarré le fil.
export type EpicStoryState = "not-started" | Story["status"] | "unreadable";

export interface EpicStoryMetrics {
  verdict: string;
  duration_min: number;
  interventions: number;
  cache_read: number;
}

export interface EpicStoryView extends EpicStory {
  state: EpicStoryState;
  merged: boolean;
  // Dépendances pas encore fusionnées : la story n'est pas proposée tant qu'il en reste.
  waiting_for: StoryRef[];
  // Bilan du dernier pilote (`.spawn/pilot/<story>/report.json`) ; null si la story n'a pas été pilotée.
  metrics: EpicStoryMetrics | null;
}

const MERGED: readonly string[] = ["done", "cleaned"];

function metricsOf(projects: Map<string, RegisteredProject>, ref: StoryRef): EpicStoryMetrics | null {
  const p = projects.get(ref.project);
  if (!p) return null;
  try {
    const r = JSON.parse(readFileSync(join(p.root, ".spawn", "pilot", ref.story, "report.json"), "utf8")) as {
      verdict?: unknown;
      duration_min?: unknown;
      interventions?: unknown;
      metrics?: { tokens?: { cache_read?: unknown } };
    };
    if (typeof r.verdict !== "string" || typeof r.duration_min !== "number") return null;
    return {
      verdict: r.verdict,
      duration_min: r.duration_min,
      interventions: Array.isArray(r.interventions) ? r.interventions.length : 0,
      cache_read: typeof r.metrics?.tokens?.cache_read === "number" ? r.metrics.tokens.cache_read : 0,
    };
  } catch {
    return null;
  }
}

function stateOf(projects: Map<string, RegisteredProject>, ref: StoryRef): EpicStoryState {
  const p = projects.get(ref.project);
  if (!p) return "unreadable";
  try {
    return readStory(p.root, ref.story)?.status ?? "not-started";
  } catch {
    return "unreadable";
  }
}

export function epicStories(epic: Epic): EpicStoryView[] {
  const projects = knownProjects();
  const states = new Map(epic.stories.map((s) => [`${s.project}/${s.story}`, stateOf(projects, s)]));
  const merged = (r: StoryRef) => MERGED.includes(states.get(`${r.project}/${r.story}`) ?? "");
  return epic.stories.map((s) => ({
    ...s,
    state: states.get(`${s.project}/${s.story}`) ?? "not-started",
    merged: merged(s),
    waiting_for: s.blocked_by.filter((d) => !merged(d)),
    metrics: metricsOf(projects, s),
  }));
}

// Pour `spawn next` : dépendances non fusionnées d'une story, tous workspaces confondus.
export function unmetDependencies(projectRoot: string, story: string): StoryRef[] {
  const projects = knownProjects();
  const self = [...projects.values()].find((p) => p.root.replace(/\\/g, "/").toLowerCase() === projectRoot.replace(/\\/g, "/").toLowerCase());
  if (!self) return [];
  const waiting: StoryRef[] = [];
  for (const w of readWorkspaces()) {
    for (const epic of w.epics) {
      const entry = epic.stories.find((s) => s.project === self.id && s.story === story);
      if (!entry) continue;
      for (const d of entry.blocked_by) {
        if (!MERGED.includes(stateOf(projects, d)) && !waiting.some((x) => same(x, d))) waiting.push(d);
      }
    }
  }
  return waiting;
}
