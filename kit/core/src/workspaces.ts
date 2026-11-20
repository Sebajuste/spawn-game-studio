// Workspaces (docs/workspaces.md) : des projets regroupés en produit, et des epics dont les stories visent plusieurs
// projets. Stockés dans `~/.spawn/workspaces.json` ; un projet ne connaît pas ses workspaces, et chaque story reste
// dans son projet. Le suivi local est l'implémentation par défaut d'un éventuel plugin de suivi (Jira…).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export function workspacesPath(): string {
  return join(process.env.SPAWN_CONFIG || join(homedir(), ".spawn"), "workspaces.json");
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
  mkdirSync(dirname(workspacesPath()), { recursive: true });
  writeFileSync(workspacesPath(), JSON.stringify({ workspaces }, null, 2) + "\n");
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

export interface EpicStoryView extends EpicStory {
  state: EpicStoryState;
  merged: boolean;
  // Dépendances pas encore fusionnées : la story n'est pas proposée tant qu'il en reste.
  waiting_for: StoryRef[];
}

const MERGED: readonly string[] = ["done", "cleaned"];

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
