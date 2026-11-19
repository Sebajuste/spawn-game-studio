import { join } from "node:path";
import type { Diagnostic, CompileData } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { parseLog, projectFile, lines } from "../log.ts";
import { diagnostic, type Report } from "../result.ts";
import { checkOrganization } from "../organization.ts";
import { checkMainScene, checkSceneScripts } from "../scene-text.ts";
import { TOOLS_DIR, Session, checkProject } from "../session.ts";

export interface CompileSummary {
  files_checked: number;
  errors: Diagnostic[];
}

// Deux lancements : `tools/check-scripts.gd` (scripts), puis `tools/check-scenes.gd` (scènes et ressources).

// Relit la sortie de `tools/check-scripts.gd` : les erreurs du moteur situent le problème,
// les marqueurs `SPAWN-FAILED` rattrapent un script refusé sans message reconnu.
export function parseCompile(output: string, project?: string): CompileSummary {
  const errors = parseLog(output, project);
  let checked: number | undefined;
  for (const l of lines(output)) {
    const failed = /^SPAWN-FAILED (\S+)/.exec(l);
    if (failed !== null) {
      const file = projectFile(failed[1] ?? "", project);
      if (!errors.some((d) => d.file === file)) {
        errors.push(diagnostic("invalid-script", `le script ne se charge pas : ${failed[1] ?? ""}`, file));
      }
    }
    const end = /^SPAWN-CHECKED (\d+) (\d+)/.exec(l);
    if (end !== null) checked = Number(end[1]);
  }
  if (checked === undefined) {
    errors.push(diagnostic("check-incomplete", "la vérification des scripts ne s'est pas terminée ; voir le journal"));
  }
  return { files_checked: checked ?? 0, errors };
}

export interface ScenesSummary {
  scenes_checked: number;
  errors: Diagnostic[];
}

// Relit la sortie de `tools/check-scenes.gd`. Chaque fichier ouvre une section (`SPAWN-SCENE res://…`) :
// les erreurs du moteur qui la suivent sont les siennes. Une section en échec, par le marqueur ou par une erreur
// reconnue, donne une seule erreur `invalid-scene` sur ce fichier, avec le message le plus précis de Godot.
export function parseScenes(output: string, project?: string): ScenesSummary {
  const errors: Diagnostic[] = [];
  let checked: number | undefined;
  let current: { res: string; lines: string[]; failed: boolean } | null = null;

  const close = (): void => {
    if (current === null) return;
    const file = projectFile(current.res, project);
    const found = parseLog(current.lines.join("\n"), project);
    if (current.failed || found.length > 0) {
      const precise = found.find((d) => d.file !== undefined && d.file === file) ?? found[0];
      const message = precise === undefined ? `${current.res} ne se charge pas ou ne s'instancie pas ; voir le journal` : `${current.res} : ${precise.message}`;
      errors.push(diagnostic("invalid-scene", message, file, precise !== undefined && precise.file === file ? precise.line : undefined));
    }
    current = null;
  };

  for (const l of lines(output)) {
    const start = /^SPAWN-SCENE (\S+)/.exec(l);
    if (start !== null) {
      close();
      current = { res: start[1] ?? "", lines: [], failed: false };
      continue;
    }
    const failed = /^SPAWN-SCENE-FAILED (\S+)/.exec(l);
    if (failed !== null && current !== null && current.res === failed[1]) {
      current.failed = true;
      continue;
    }
    const end = /^SPAWN-SCENES (\d+) (\d+)/.exec(l);
    if (end !== null) {
      close();
      checked = Number(end[1]);
      continue;
    }
    current?.lines.push(l);
  }
  close();
  if (checked === undefined) {
    errors.push(diagnostic("check-incomplete", "la vérification des scènes ne s'est pas terminée ; voir le journal"));
  }
  return { scenes_checked: checked ?? 0, errors };
}

export async function compile(o: Options, r: Report): Promise<void> {
  r.data = { files_checked: 0, scenes_checked: 0 } satisfies CompileData;
  const project = o.required("project");
  checkProject(project);
  const session = new Session("compile", o, r, 600, project);
  await session.importProject();
  const l = await session.run(["--headless", "--path", project, "--script", join(TOOLS_DIR, "check-scripts.gd")]);
  const summary = parseCompile(l.output, project);
  for (const d of summary.errors) r.errors.push(d);
  r.data.files_checked = summary.files_checked;

  // Scripts verts, scène illisible : le programme ne démarre pas. Chaque scène et ressource est chargée et instanciée.
  const s = await session.run(["--headless", "--path", project, "--script", join(TOOLS_DIR, "check-scenes.gd")]);
  const scenes = parseScenes(s.output, project);
  // Ce que Godot charge sans erreur mais qui ne fera rien : script écrit en chaîne, scène principale absente. Le constat
  // statique, plus précis (ligne et correction), remplace celui du moteur sur le même fichier.
  const written = checkSceneScripts(project);
  for (const d of [...written, ...scenes.errors.filter((e) => !written.some((w) => w.file === e.file)), ...checkMainScene(project)]) r.errors.push(d);
  r.data.scenes_checked = scenes.scenes_checked;
  // En avertissement d'abord : la règle doit faire ses preuves sans bloquer (docs/kit-perimetre.md §2).
  for (const d of checkOrganization(project)) r.warnings.push(d);
}
