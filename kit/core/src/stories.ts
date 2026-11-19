// État des fils : `.spawn/stories/<fil>.json` sous la racine du projet (docs/kit-perimetre.md §7).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";

// `a-juger` : preuve verte et compte rendu écrit, l'utilisateur accepte, redemande ou abandonne (docs/ux-parcours.md §6).
export type Status = "active" | "compacting" | "handoff-pending" | `blocked:${string}` | "in-acceptance" | "done" | "cleaned";

export interface Story {
  story: string;
  status: Status;
  branch: string;
  worktree: string | null;
  base: string;
  task: string | null;
  first_step: string | null;
  subagents: string[];
  mr: string | null;
  updated: string;
}

const schema: unknown = JSON.parse(readFileSync(new URL("../schemas/story.v1.json", import.meta.url), "utf8"));
// `format` n'est pas vérifié : ajv-formats serait une dépendance pour une seule date, que le cœur écrit lui-même.
const validateSchema = new Ajv2020({ allErrors: true, strict: true, validateFormats: false }).compile<Story>(schema as object);

type Family = "active" | "compacting" | "handoff-pending" | "blocked" | "in-acceptance" | "done" | "cleaned";
const family = (s: Status): Family => (s.startsWith("blocked:") ? "blocked" : (s as Family));

// Un statut garde ses mises à jour (tâche, premier geste…) ; `nettoye` est final.
const NEXT_STATES: Record<Family, readonly Family[]> = {
  active: ["active", "compacting", "handoff-pending", "blocked", "in-acceptance", "done"],
  compacting: ["compacting", "active", "handoff-pending"],
  "handoff-pending": ["handoff-pending", "active"],
  blocked: ["blocked", "active"],
  // Accepter mène à la fusion (`termine`), redemander rend le fil actif.
  "in-acceptance": ["in-acceptance", "active", "done"],
  // Une fusion refusée rend le fil actif.
  done: ["done", "active", "cleaned"],
  cleaned: [],
};

export function transitionAllowed(from: Status, to: Status): boolean {
  return NEXT_STATES[family(from)].includes(family(to));
}

export function storiesDir(root: string): string {
  return join(root, ".spawn", "stories");
}

function storyPath(root: string, name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error(`nom de fil invalide : « ${name} » (minuscules, chiffres, tirets)`);
  return join(storiesDir(root), `${name}.json`);
}

export function validateStory(object: unknown): string[] {
  if (validateSchema(object)) return [];
  return (validateSchema.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
}

function writeAtomic(path: string, content: string): void {
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(temp, content);
  // Sous Windows, le remplacement échoue un court instant si un lecteur (l'app) tient le fichier ouvert.
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(temp, path);
      return;
    } catch (e) {
      if (attempt >= 20 || (e as NodeJS.ErrnoException).code !== "EPERM") {
        rmSync(temp, { force: true });
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

function write(root: string, story: Story): Story {
  const defects = validateStory(story);
  if (defects.length > 0) throw new Error(`fil « ${story.story} » invalide : ${defects.join(" ; ")}`);
  mkdirSync(storiesDir(root), { recursive: true });
  writeAtomic(storyPath(root, story.story), JSON.stringify(story, null, 2) + "\n");
  return story;
}

export function readStory(root: string, name: string): Story | null {
  const path = storyPath(root, name);
  if (!existsSync(path)) return null;
  const object: unknown = JSON.parse(readFileSync(path, "utf8"));
  const defects = validateStory(object);
  if (defects.length > 0) throw new Error(`${path} invalide : ${defects.join(" ; ")}`);
  return object as Story;
}

export function listStories(root: string): Story[] {
  const dir = storiesDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const story = readStory(root, f.slice(0, -".json".length));
      return story ? [story] : [];
    });
}

export type NewStory = Pick<Story, "story" | "branch" | "worktree" | "base"> & Partial<Pick<Story, "task" | "first_step">>;

// Un fil nettoyé peut renaître sous le même nom ; un fil vivant, non.
export function createStory(root: string, created: NewStory, now = new Date()): Story {
  const existing = readStory(root, created.story);
  if (existing && existing.status !== "cleaned") throw new Error(`le fil « ${created.story} » existe déjà (statut ${existing.status})`);
  return write(root, {
    story: created.story,
    status: "active",
    branch: created.branch,
    worktree: created.worktree,
    base: created.base,
    task: created.task ?? null,
    first_step: created.first_step ?? null,
    subagents: [],
    mr: null,
    updated: now.toISOString(),
  });
}

export function updateStory(
  root: string,
  name: string,
  change: Partial<Omit<Story, "story" | "updated">>,
  now = new Date(),
): Story {
  const current = readStory(root, name);
  if (!current) throw new Error(`fil « ${name} » introuvable`);
  const status = change.status ?? current.status;
  if (!transitionAllowed(current.status, status)) {
    throw new Error(`transition refusée pour « ${name} » : ${current.status} → ${status}`);
  }
  return write(root, { ...current, ...change, story: name, status, updated: now.toISOString() });
}
