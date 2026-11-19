import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import type { NewProjectData } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { installGut } from "../gut.ts";
import { Failure, UsageError, toSlash, type Report } from "../result.ts";
import { ORGANIZATION_NOTE, ORGANIZATION_NOTE_PATH } from "../organization.ts";
import { isDir } from "../session.ts";

export const MAIN_SCENE = "res://core/games/main/main.tscn";

export function projectGodot(name: string, mainScene?: string): string {
  const escaped = name.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return [
    "; Engine configuration file.",
    "config_version=5",
    "",
    "[application]",
    "",
    `config/name="${escaped}"`,
    ...(mainScene ? [`run/main_scene="${mainScene}"`] : []),
    'config/features=PackedStringArray("4.7")',
    "",
    "[editor_plugins]",
    "",
    'enabled=PackedStringArray("res://addons/gut/plugin.cfg")',
    "",
  ].join("\n");
}

// Les tests vivent dans le dossier `tests/` de chaque composant : GUT les cherche dans core/ et libs/.
export function gutconfig(dirs: readonly string[]): string {
  return `${JSON.stringify({ dirs, include_subdirs: true, prefix: "test_", suffix: ".gd", should_exit: true }, null, 2)}\n`;
}
export const GUTCONFIG = gutconfig(["res://test"]);

function checkExcluded(rel: string): string {
  const clean = toSlash(normalize(rel)).replace(/\/+$/, "");
  if (rel === "" || isAbsolute(rel) || clean === "." || clean.split("/").includes("..")) {
    throw new UsageError(`--exclude attend un chemin relatif au projet, sans « .. » : ${rel}`);
  }
  return clean;
}

// GUT est installé avant `project.godot` : un échec réseau laisse le dossier sans projet,
// et un nouvel essai n'est pas refusé comme `project-exists`.
export async function createProject(
  project: string,
  name: string,
  excluded: readonly string[],
  { testDirs = ["res://test"], mainScene }: { testDirs?: readonly string[]; mainScene?: string } = {},
): Promise<string[]> {
  const excludedDirs = excluded.map(checkExcluded);
  if (!isDir(project)) throw new Failure("directory-not-found", `le dossier n'existe pas : ${project}`);
  if (existsSync(join(project, "project.godot"))) {
    throw new Failure("project-exists", `un projet Godot existe déjà dans ${project}`, "project.godot");
  }
  const files = await installGut(project);
  writeFileSync(join(project, ".gutconfig.json"), gutconfig(testDirs));
  files.push(".gutconfig.json");
  for (const dir of excludedDirs) {
    mkdirSync(join(project, dir), { recursive: true });
    writeFileSync(join(project, dir, ".gdignore"), "");
    files.push(`${dir}/.gdignore`);
  }
  writeFileSync(join(project, "project.godot"), projectGodot(name, mainScene));
  files.push("project.godot");
  return files.sort();
}

// Premier test d'un projet neuf : la configuration chargée est celle de ce jeu, et la scène principale se charge
// (un autre nom ou une scène absente le feraient échouer).
export function firstTest(name: string): string {
  const escaped = name.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return [
    "extends GutTest",
    "",
    "",
    "func test_project_configuration() -> void:",
    `\tassert_eq(ProjectSettings.get_setting("application/config/name"), "${escaped}")`,
    `\tassert_eq(ProjectSettings.get_setting("application/run/main_scene"), "${MAIN_SCENE}")`,
    `\tassert_not_null(load("${MAIN_SCENE}"))`,
    "",
  ].join("\n");
}

const MAIN_SCENE_CONTENT = `[gd_scene format=3]

[node name="Main" type="Node2D"]
`;

// Arborescence par composant (docs/kit-perimetre.md §2) ; un dossier vide porte un .gitkeep pour exister dans git.
const EMPTY_DIRS = ["libs", "assets", "core/actors", "core/gui", "core/systems"];

export async function newProject(o: Options, r: Report): Promise<void> {
  r.data = { files: [] };
  const project = o.required("project");
  const name = o.required("name");
  const files = await createProject(project, name, o.all("exclude"), { testDirs: ["res://core", "res://libs"], mainScene: MAIN_SCENE });
  const write = (rel: string, content: string) => {
    mkdirSync(join(project, rel, ".."), { recursive: true });
    writeFileSync(join(project, rel), content);
    files.push(rel);
  };
  for (const d of EMPTY_DIRS) write(`${d}/.gitkeep`, "");
  write("core/games/main/main.tscn", MAIN_SCENE_CONTENT);
  write("core/games/main/tests/test_project.gd", firstTest(name));
  write(ORGANIZATION_NOTE_PATH, ORGANIZATION_NOTE);
  r.data = { files: files.sort() } satisfies NewProjectData;
}
