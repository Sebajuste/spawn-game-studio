// Pose le gabarit Godot sur un projet existant sans rien écraser. Le plan est calculé d'abord, puis appliqué
// sauf avec `--dry-run` : les deux rendent donc les mêmes fichiers, et un projet déjà adopté n'en rend aucun.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AdoptData, AdoptFile, AdoptGap } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { installGut } from "../gut.ts";
import { mainScene, readMainScene } from "../main-scene.ts";
import { enablePlugin, readName } from "../project-godot.ts";
import { Failure, type Report } from "../result.ts";
import { isDir } from "../session.ts";
import { detectProject } from "./detect.ts";
import { checkExcluded, firstTest, gutconfig } from "./new-project.ts";

export const GUT_PLUGIN = "res://addons/gut/plugin.cfg";
const FIRST_TEST = "test/test_project.gd";
const TEST_FILE = /^test_.*\.gd$/;
// Dossiers que GUT ne parcourt pas : ni le cache de Godot ni les greffons ne portent les tests du projet.
const SKIPPED_ROOTS = new Set(["addons", ".godot"]);

interface Step {
  file: AdoptFile;
  apply: () => Promise<void>;
}

export interface Plan {
  steps: Step[];
  gaps: AdoptGap[];
}

// Dossiers (relatifs, `""` pour la racine) qui contiennent un `test_*.gd`, hors dossiers ignorés par Godot.
export function testDirs(project: string, excluded: ReadonlySet<string> = new Set(), dir = ""): string[] {
  const found: string[] = [];
  for (const e of readdirSync(join(project, dir), { withFileTypes: true })) {
    const rel = dir === "" ? e.name : `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name.startsWith(".") || (dir === "" && SKIPPED_ROOTS.has(e.name)) || excluded.has(rel)) continue;
      if (existsSync(join(project, rel, ".gdignore"))) continue;
      found.push(...testDirs(project, excluded, rel));
    } else if (TEST_FILE.test(e.name) && !found.includes(dir)) {
      found.push(dir);
    }
  }
  return found;
}

// GUT parcourt les sous-dossiers (`include_subdirs`) : un dossier déjà couvert par un parent n'est pas répété.
function topDirs(dirs: readonly string[]): string[] {
  const sorted = [...new Set(dirs)].sort();
  return sorted.filter((d) => !sorted.some((p) => p !== d && (p === "" || d.startsWith(`${p}/`))));
}

export function planAdoption(
  project: string,
  exclude: readonly string[],
  install: (project: string) => Promise<unknown> = installGut,
): Plan {
  const excluded = exclude.map(checkExcluded);
  if (!detectProject(project).match) {
    throw new Failure("not-a-project", `aucun project.godot dans ${project} : ce n'est pas un projet Godot`);
  }
  const steps: Step[] = [];
  const gaps: AdoptGap[] = [];
  const add = (path: string, change: AdoptFile["change"], apply: () => unknown) =>
    steps.push({
      file: { path, change },
      apply: async () => {
        await apply();
      },
    });
  const write = (rel: string, content: string) => () => {
    mkdirSync(dirname(join(project, rel)), { recursive: true });
    writeFileSync(join(project, rel), content);
  };

  // GUT d'abord : un échec de téléchargement interrompt l'adoption avant toute autre écriture.
  if (!existsSync(join(project, "addons", "gut", "plugin.cfg"))) add("addons/gut", "add", () => install(project));

  const settings = readFileSync(join(project, "project.godot"), "utf8");
  const completed = enablePlugin(settings, GUT_PLUGIN);
  if (completed !== settings) add("project.godot", "complete", write("project.godot", completed));

  const dirs = topDirs(testDirs(project, new Set(excluded)));
  if (!existsSync(join(project, ".gutconfig.json"))) {
    const resDirs = dirs.length === 0 ? ["res://test"] : dirs.map((d) => `res://${d}`);
    add(".gutconfig.json", "add", write(".gutconfig.json", gutconfig(resDirs)));
  }
  for (const dir of excluded) {
    if (isDir(join(project, dir)) && !existsSync(join(project, dir, ".gdignore"))) {
      add(`${dir}/.gdignore`, "add", write(`${dir}/.gdignore`, ""));
    }
  }
  if (dirs.length === 0) {
    const scene = mainScene(project);
    add(FIRST_TEST, "add", write(FIRST_TEST, firstTest(readName(settings), scene?.startsWith("res://") ? scene : null)));
  }

  if (readMainScene(settings) === null) {
    gaps.push({
      code: "main-scene-missing",
      message: "project.godot ne déclare pas de scène principale (run/main_scene) : le jeu ne peut pas être lancé",
    });
  }
  return { steps, gaps };
}

export async function adopt(o: Options, r: Report): Promise<void> {
  const plan = planAdoption(o.required("project"), o.all("exclude"));
  if (!o.has("dry-run")) {
    for (const step of plan.steps) await step.apply();
  }
  const files = plan.steps.map((s) => s.file).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  r.data = { files, declared: null, gaps: plan.gaps } satisfies AdoptData;
}
