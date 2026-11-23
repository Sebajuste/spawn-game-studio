// Organisation par composant (docs/kit-perimetre.md §2) : signalée à la compilation, en avertissement, avec où ranger.
// Une règle écrite seule s'ignore ; une sortie qui dit « déplacer X vers Y » se suit.
import { existsSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Diagnostic } from "../../../core/src/adapter/types.ts";
import { diagnostic } from "./result.ts";

export const THEMES = ["games", "maps", "actors", "gui", "systems"] as const;
const CODE = new Set([".gd", ".tscn", ".scn", ".gdshader", ".gdshaderinc", ".tres", ".res"]);
const RAW = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".bmp", ".tga", ".exr", ".hdr", ".wav", ".ogg", ".mp3", ".glb", ".gltf", ".fbx", ".obj", ".blend", ".ttf", ".otf", ".woff2"]);
// Fichiers que Godot attend à la racine.
const ROOT_ALLOWED = new Set(["icon.svg", "icon.png", "default_bus_layout.tres", "default_env.tres"]);
const IGNORED = new Set([".godot", ".git", ".spawn", ".claude", "addons", "node_modules"]);
// Note du projet de jeu, lue aussi par le cœur et les skills.
export const ORGANIZATION_NOTE_PATH = "knowledge/organization.md";

function files(project: string, dir = "", result: string[] = []): string[] {
  const absolute = join(project, dir);
  if (dir && existsSync(join(absolute, ".gdignore"))) return result;
  for (const e of readdirSync(absolute, { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!(dir === "" && IGNORED.has(e.name))) files(project, rel, result);
    } else result.push(rel);
  }
  return result;
}

// `scripts/plateau.gd` → `plateau` ; `test_plateau.gd` → `plateau`.
const likelyComponent = (rel: string) => basename(rel, extname(rel)).replace(/^test_/, "");

export function checkOrganization(project: string): Diagnostic[] {
  const warnings: Diagnostic[] = [];
  // Un projet créé avant la règle n'a pas la note : la règle va alors dans le message, sinon le renvoi serait vide.
  const rule = existsSync(join(project, ORGANIZATION_NOTE_PATH))
    ? ORGANIZATION_NOTE_PATH
    : `règle : core/<thème>/<composant>/ avec ses tests dans tests/, thèmes ${THEMES.join(", ")} ; libs/, assets/, addons/ à part`;
  const report = (rel: string, problem: string, to: string) =>
    warnings.push(diagnostic("organization", `${problem} ; ensuite : le déplacer vers ${to} (${rule})`, rel));

  for (const rel of files(project)) {
    const ext = extname(rel).toLowerCase();
    const parts = rel.split("/");
    const root = parts[0] ?? "";
    const name = likelyComponent(rel);
    const test = /^test_.*\.gd$/.test(basename(rel));

    if (CODE.has(ext)) {
      if (parts.length === 1 && ROOT_ALLOWED.has(rel)) continue;
      if (ext === ".tres" || ext === ".res") {
        if (root === "assets") continue;
      }
      if (root !== "core" && root !== "libs") {
        report(rel, "hors organisation", test ? `core/<thème>/${name}/tests/${basename(rel)}` : `core/<thème>/${name}/${basename(rel)}`);
        continue;
      }
      if (root === "core") {
        const theme = parts[1] ?? "";
        if (parts.length < 4) {
          report(rel, `directement dans core/${parts.length === 3 ? `${theme}/` : ""}`, `core/${(THEMES as readonly string[]).includes(theme) ? theme : "<thème>"}/${name}/${basename(rel)}`);
          continue;
        }
        if (!(THEMES as readonly string[]).includes(theme)) {
          report(rel, `thème inconnu core/${theme} (thèmes : ${THEMES.join(", ")})`, `core/<thème>/${parts.slice(2).join("/")}`);
          continue;
        }
      }
      if (test && parts[parts.length - 2] !== "tests") {
        report(rel, "test hors du dossier tests/ de son composant", `${parts.slice(0, -1).join("/")}/tests/${basename(rel)}`);
      }
    } else if (RAW.has(ext)) {
      if (parts.length === 1 && ROOT_ALLOWED.has(rel)) continue;
      if (root === "assets" || root === "core" || root === "libs") continue;
      report(rel, "ressource brute hors de assets/ et de tout composant", `assets/<type>/${basename(rel)} ou le dossier du composant qui l'utilise`);
    }
  }
  return warnings;
}

export const ORGANIZATION_NOTE = `# Organisation du projet (Godot)

Par composant réutilisable, à la manière de React : un composant = un dossier qui contient au moins sa scène et son script, ses ressources dédiées et ses tests (\`tests/\`). Les composants sont regroupés par thème.

| Dossier | Contenu |
|---|---|
| \`addons/\` | Réutilisable et lié à l'éditeur (plugins) |
| \`libs/\` | Réutilisable entre projets, hors éditeur |
| \`assets/\` | Textures, modèles, sons, polices |
| \`core/games/\` | Scènes lançables : \`main\`, scènes de test manuelles |
| \`core/maps/\` | Cartes et niveaux, géométrie et décor plaçables, sans personnage, contrôleur ni règles ; une scène lançable de \`core/games/\` les instancie |
| \`core/actors/\` | Objets de gameplay plaçables |
| \`core/gui/\` | Interface seulement |
| \`core/systems/\` | Code de jeu ni plaçable ni d'interface : règles, autoloads, systèmes |

Exemple : \`core/actors/grille/\` contient \`grille.tscn\`, \`grille.gd\` et \`tests/test_grille.gd\`. Un sous-thème est permis (\`core/actors/vehicules/voiture/\`).

\`spawn engine compile\` signale en avertissement tout fichier mal rangé, avec où le déplacer. Déplacer un fichier : le faire avec son \`.uid\`, puis relancer la compilation et les tests.
`;
