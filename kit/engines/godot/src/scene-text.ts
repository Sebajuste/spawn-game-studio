// Contrôles statiques des scènes texte (.tscn), là où Godot charge sans erreur une scène qui ne fera rien.
// Chaque message montre la ligne en cause, dit pourquoi, et donne les lignes exactes à écrire (essai du 19/11 : le
// modèle a tourné une heure sur `script = "res://…"` et sur une scène principale déclarée à un chemin vide).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Diagnostic } from "../../../core/src/adapter/types.ts";
import { mainScene } from "./main-scene.ts";
import { diagnostic } from "./result.ts";

const IGNORED = new Set(["addons"]);

// Scènes texte du projet (chemins relatifs, `/`), hors dossiers cachés, `addons/` et dossiers marqués `.gdignore`.
export function textScenes(project: string, dir = "", result: string[] = []): string[] {
  const absolute = join(project, dir);
  if (dir !== "" && existsSync(join(absolute, ".gdignore"))) return result;
  for (const e of readdirSync(absolute, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const rel = dir === "" ? e.name : `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (!(dir === "" && IGNORED.has(e.name))) textScenes(project, rel, result);
    } else if (e.name.endsWith(".tscn")) result.push(rel);
  }
  return result;
}

// Les deux lignes qui attachent un script dans une scène texte de Godot 4.
export function attachScript(path: string): string {
  return `en tête du fichier, après la ligne [gd_scene …] : [ext_resource type="Script" path="${path}" id="1_script"] ; puis, sous le nœud : script = ExtResource("1_script")`;
}

// `script = "res://x.gd"` ou `script = load("res://x.gd")` : Godot 4 charge la scène, sans script et sans erreur.
// Seule une ressource déclarée (`ExtResource`, `SubResource`) attache du code.
export function checkSceneScripts(project: string): Diagnostic[] {
  const errors: Diagnostic[] = [];
  for (const rel of textScenes(project)) {
    const lines = readFileSync(join(project, rel), "utf8").split(/\r?\n/);
    lines.forEach((raw, i) => {
      const value = /^script\s*=\s*(.+?)\s*$/.exec(raw.trim())?.[1];
      if (value === undefined || /^(ExtResource|SubResource)\s*\(/.test(value) || value === "null") return;
      const path = /"(res:\/\/[^"]+)"/.exec(value)?.[1] ?? `res://${rel.replace(/\.tscn$/, ".gd")}`;
      errors.push(
        diagnostic(
          "invalid-scene",
          `${rel}:${i + 1} : « script = ${value} » n'attache aucun script : dans une scène texte, Godot 4 n'accepte ici qu'une ressource déclarée ; la scène se charge, mais sans code. Corriger ainsi : ${attachScript(path)}`,
          rel,
          i + 1,
        ),
      );
    });
  }
  return errors;
}

// La scène principale doit être déclarée et exister : sans elle, rien ne se lance (essai du 19/11 : `run/main_scene`
// pointait vers core/games/morpion2/main.tscn, la scène était écrite sous core/games/core/games/morpion2/).
export function checkMainScene(project: string): Diagnostic[] {
  const godot = join(project, "project.godot");
  if (!existsSync(godot)) return [];
  const line = readFileSync(godot, "utf8").split(/\r?\n/).findIndex((l) => /^\s*run\/main_scene\s*=/.test(l)) + 1 || undefined;
  const scene = mainScene(project);
  if (scene === null) {
    return [diagnostic("main-scene-missing", `project.godot ne déclare pas de scène principale : rien ne se lance. Ajouter sous [application] : run/main_scene="res://<chemin de la scène>.tscn"`, "project.godot")];
  }
  if (scene.startsWith("uid://")) return [diagnostic("scene-not-found", `scène principale introuvable : aucune scène ne porte l'uid ${scene}. Écrire son chemin : run/main_scene="res://<chemin de la scène>.tscn"`, "project.godot", line)];
  const rel = scene.slice("res://".length);
  if (existsSync(join(project, rel))) return [];
  const same = textScenes(project).filter((r) => basename(r) === basename(rel));
  const fix =
    same.length > 0
      ? `Scène(s) du même nom dans le projet : ${same.map((r) => `res://${r}`).join(", ")}. Corriger project.godot (run/main_scene="res://${same[0]}"), ou déplacer la scène vers ${scene}`
      : `Créer cette scène, ou corriger run/main_scene dans project.godot`;
  return [diagnostic("scene-not-found", `la scène principale ${scene} n'existe pas : rien ne se lance. ${fix}`, "project.godot", line)];
}
