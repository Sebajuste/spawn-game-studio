// Lance le jeu pour le joueur, sans l'attendre : seule sous-commande dont le moteur survit à l'appel.
// Pas de `--timeout` ni d'arrêt de l'arbre : c'est le joueur qui ferme la fenêtre.
import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, openSync } from "node:fs";
import { join } from "node:path";
import type { LaunchData } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { Failure, type Report } from "../result.ts";
import { isDir, Session, checkProject } from "../session.ts";
import { toRes } from "./capture.ts";

// Sans scène, Godot lance la scène principale déclarée dans project.godot.
export function launchArgs(project: string, scene: string | null): string[] {
  return ["--path", project, ...(scene === null ? [] : [scene])];
}

export async function launchGame(o: Options, r: Report): Promise<void> {
  const project = o.required("project");
  const requested = o.text("scene");
  const scene = requested === undefined ? null : toRes(requested);
  r.data = { scene };

  checkProject(project);
  if (scene !== null) {
    const rel = scene.slice("res://".length);
    if (!existsSync(join(project, rel))) throw new Failure("scene-not-found", `scène absente : ${scene}`, rel);
  }
  // L'import revient à prepare-worktree : le refaire ici retarderait chaque lancement.
  if (!isDir(join(project, ".godot"))) {
    r.warn("import-missing", `${project} n'a pas de .godot/ : lancer prepare-worktree d'abord, sinon les ressources ne se chargent pas`);
  }

  const session = new Session("launch", o, r, 1, project);
  const args = launchArgs(project, scene);
  appendFileSync(session.log, `# spawn: ${session.executable} ${args.join(" ")}\n`);

  // La sortie du jeu va dans le journal, que le jeu continue de remplir après la fin de l'appel.
  const fd = openSync(session.log, "a");
  try {
    // Pas de windowsHide : SW_HIDE s'appliquerait à la fenêtre du jeu. Pas de cwd dans le projet : sous Windows,
    // il verrouillerait le dossier (worktree impossible à supprimer) tant que le jeu tourne.
    const child = spawn(session.executable, args, { stdio: ["ignore", fd, fd], detached: true, windowsHide: false });
    const pid = await new Promise<number | undefined>((resolve, reject) => {
      child.once("spawn", () => resolve(child.pid));
      child.once("error", reject);
    }).catch((e: unknown) => {
      throw new Failure("engine-launch-failed", `Godot n'a pas pu être lancé : ${session.executable} (${e instanceof Error ? e.message : String(e)})`);
    });
    if (pid === undefined) throw new Failure("engine-launch-failed", `Godot n'a pas pu être lancé : ${session.executable}`);
    child.on("error", () => undefined);
    child.unref();
    r.data = { pid, scene } satisfies LaunchData;
  } finally {
    closeSync(fd);
  }
}
