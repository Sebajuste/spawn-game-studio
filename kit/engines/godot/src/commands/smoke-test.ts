// Test de smoke test : la scène principale tourne-t-elle quelques secondes sans erreur ? Des tests verts et une
// compilation verte n'en disent rien (scène principale sans script, scène que le programme ne sait pas lancer).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Diagnostic, SmokeTestData } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { parseLog, lines } from "../log.ts";
import { diagnostic, Failure, type Report } from "../result.ts";
import { mainScene } from "../main-scene.ts";
import { attachScript } from "../scene-text.ts";
import { TOOLS_DIR, Session, checkProject } from "../session.ts";

export const SMOKE_SECONDS = 3;

// Relit la sortie de `tools/smoke-test.gd`. Toute erreur reconnue du moteur devient `runtime-error` ;
// sans `SPAWN-SMOKE-END`, le programme s'est arrêté (plantage, `quit()`) avant la fin.
export function parseSmokeTest(output: string, seconds: number, project?: string, scene?: string): Diagnostic[] {
  const errors = parseLog(output, project).map((d) => diagnostic("runtime-error", d.message, d.file, d.line));
  const all = lines(output);
  const refusal = all.find((l) => l.startsWith("SPAWN-SMOKE-ERROR"));
  if (refusal !== undefined) {
    errors.push(diagnostic("runtime-error", refusal.slice("SPAWN-SMOKE-ERROR".length).trim()));
    return errors;
  }
  const scripts = all.map((l) => /^SPAWN-SMOKE-SCRIPTS (\d+) (\d+)/.exec(l)).find((m) => m !== null);
  if (scripts !== undefined && scripts[1] === "0") {
    errors.push(
      diagnostic(
        "main-scene-empty",
        `la scène principale ne porte aucun script (${scripts[2] ?? "?"} nœuds, sous-scènes comprises) : le programme ne fait rien. Attacher son script au nœud racine de ${scene ?? "la scène principale"}, ${attachScript(scene ? `res://${scene.replace(/\.tscn$/, ".gd")}` : "res://<chemin du script>.gd")}`,
        scene,
      ),
    );
  }
  if (!all.some((l) => l.startsWith("SPAWN-SMOKE-END"))) {
    errors.push(diagnostic("runtime-error", `le programme s'est arrêté avant ${seconds} s (plantage ou quit()) ; voir le journal`));
  }
  return errors;
}

export async function smokeTest(o: Options, r: Report): Promise<void> {
  const project = o.required("project");
  const seconds = o.integer("seconds") ?? SMOKE_SECONDS;
  r.data = { scene: null, seconds } satisfies SmokeTestData;
  checkProject(project);

  const scene = mainScene(project);
  if (scene === null) {
    throw new Failure("main-scene-missing", "project.godot ne déclare pas de scène principale (application/run/main_scene)", "project.godot");
  }
  r.data.scene = scene;
  if (scene.startsWith("uid://")) throw new Failure("scene-not-found", `scène principale introuvable : ${scene}`, "project.godot");
  const rel = scene.slice("res://".length);
  if (!existsSync(join(project, rel))) throw new Failure("scene-not-found", `scène principale absente : ${scene}`, rel);

  const session = new Session("smoke-test", o, r, 120 + seconds, project);
  await session.importProject();
  // `--max-fps` : sans rendu, la boucle tournerait à vide sur un cœur entier.
  const l = await session.run(["--headless", "--path", project, "--max-fps", "60", "--script", join(TOOLS_DIR, "smoke-test.gd")], {
    user: [scene, String(seconds)],
  });
  for (const d of parseSmokeTest(l.output, seconds, project, rel)) r.errors.push(d);
}
