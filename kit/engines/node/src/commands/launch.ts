// Lance l'app du dossier donné (projet principal ou worktree) et rend la main dès qu'elle est prête : le script
// déclaré (`node.launch`) écrit `SPAWN-URL <url>` sur stdout. L'app est détachée et survit à l'appel ; on l'arrête
// par le `pid` rendu (arbre de processus), jamais par nom de processus. Une fenêtre (Edge en mode application) montre
// l'app au joueur : la fermer arrête l'app, arrêter l'app ferme la fenêtre (src/window.ts).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Options } from "../arguments.ts";
import { declaredScript, nodeConfig, readPackageJson } from "../project.ts";
import type { Report } from "../result.ts";
import { scriptEnv } from "../process.ts";
import { findEdge, Session } from "../session.ts";

export const DEFAULT_LAUNCH_SECONDS = 60;
const WINDOW = fileURLToPath(new URL("../window.ts", import.meta.url));

export function withRoute(url: string, route: string | null): string {
  if (route === null || route === "" || route === "/") return url;
  return `${url.replace(/\/+$/, "")}/${route.replace(/^\/+/, "")}`;
}

export async function launchApp(o: Options, r: Report): Promise<void> {
  const project = o.required("project");
  const scene = o.text("scene") ?? null;
  r.data = { scene };
  const pkg = readPackageJson(project);
  const script = declaredScript(project, nodeConfig(project), "launch");
  if (pkg.dependencyCount > 0 && !existsSync(join(project, "node_modules"))) {
    r.warn("dependencies-missing", "node_modules absent : lancer prepare-worktree (ou npm ci) d'abord");
  }
  const session = new Session("launch", o, r, DEFAULT_LAUNCH_SECONDS, project);
  const started = await session.start(script);
  const url = withRoute(started.url, scene);
  r.data = { pid: started.pid, scene, url };

  const edge = findEdge();
  if (edge.path === null) {
    r.warn("browser-not-found", `Edge introuvable (cherché : ${edge.searched.join(", ")}) : l'app tourne sans fenêtre, ouvrir ${url} ; l'arrêter par son pid ${started.pid}`);
    return;
  }
  // Profil jetable : sans lui, Edge confierait l'adresse à une instance déjà ouverte, et sa fermeture ne dirait rien.
  const profile = mkdtempSync(join(tmpdir(), "spawn-launch-"));
  const browser = [`--app=${url}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions"];
  const watcher = spawn(process.execPath, [WINDOW, String(started.pid), profile, edge.path, ...browser], { detached: true, stdio: "ignore", windowsHide: true, env: scriptEnv() });
  watcher.unref();
}
