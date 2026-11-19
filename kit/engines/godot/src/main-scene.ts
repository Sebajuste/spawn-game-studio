// Scène principale du projet (`run/main_scene` de project.godot), sous sa forme `res://`.
// L'éditeur de Godot 4.4+ peut l'écrire en `uid://` : elle est alors retrouvée par l'en-tête des scènes texte.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function readMainScene(projectGodot: string): string | null {
  let section = "";
  for (const raw of projectGodot.split(/\r?\n/)) {
    const line = raw.trim();
    const title = /^\[([^\]]+)\]$/.exec(line);
    if (title !== null) {
      section = title[1] ?? "";
      continue;
    }
    if (section !== "application") continue;
    const m = /^run\/main_scene\s*=\s*"([^"]*)"/.exec(line);
    if (m !== null) return m[1] === "" ? null : (m[1] ?? null);
  }
  return null;
}

// `null` : aucune scène principale déclarée. Un `uid://` introuvable est rendu tel quel.
export function mainScene(project: string): string | null {
  const path = join(project, "project.godot");
  if (!existsSync(path)) return null;
  const value = readMainScene(readFileSync(path, "utf8"));
  if (value === null || !value.startsWith("uid://")) return value;
  return sceneByUid(project, value) ?? value;
}

const IGNORED = new Set(["addons"]);

function sceneByUid(project: string, uid: string, dir = ""): string | null {
  const absolute = join(project, dir);
  if (dir !== "" && existsSync(join(absolute, ".gdignore"))) return null;
  for (const e of readdirSync(absolute, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const rel = dir === "" ? e.name : `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (dir === "" && IGNORED.has(e.name)) continue;
      const found = sceneByUid(project, uid, rel);
      if (found !== null) return found;
    } else if (e.name.endsWith(".tscn")) {
      const header = readFileSync(join(project, rel), "utf8").split("\n", 1)[0] ?? "";
      if (header.includes(`uid="${uid}"`)) return `res://${rel}`;
    }
  }
  return null;
}

// Fichiers de test qui font référence à la scène principale par son chemin exact : les tests de bout en bout.
export function endToEndTests(project: string, testFiles: readonly string[], scene: string | null): string[] {
  if (scene === null) return [];
  const keys = [scene];
  const uid = scene.startsWith("res://") ? sceneUid(project, scene) : null;
  if (uid !== null) keys.push(uid);
  return [...new Set(testFiles)]
    .filter((rel) => {
      const path = join(project, rel);
      if (!existsSync(path)) return false;
      const source = readFileSync(path, "utf8");
      return keys.some((c) => source.includes(c));
    })
    .sort();
}

function sceneUid(project: string, scene: string): string | null {
  const path = join(project, scene.slice("res://".length));
  if (!existsSync(path) || !path.endsWith(".tscn")) return null;
  const header = readFileSync(path, "utf8").split("\n", 1)[0] ?? "";
  return /uid="(uid:\/\/[^"]+)"/.exec(header)?.[1] ?? null;
}
