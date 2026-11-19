// Lance l'app comme `launch`, ouvre son URL (plus la route `--scene`, ou `node.capture.path`) dans Edge sans
// fenêtre, enregistre une image PNG, puis arrête l'app par son PID et ses descendants.
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CaptureData } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { parseErrors } from "../parse.ts";
import { declaredScript, nodeConfig, readPackageJson } from "../project.ts";
import { killTree, run } from "../process.ts";
import { Failure, type Report } from "../result.ts";
import { findEdge, Session } from "../session.ts";
import { withRoute } from "./launch.ts";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(path: string): boolean {
  if (!existsSync(path)) return false;
  const b = Buffer.alloc(8);
  const fd = openSync(path, "r");
  try {
    readSync(fd, b, 0, 8, 0);
  } finally {
    closeSync(fd);
  }
  return b.equals(PNG);
}

export async function capture(o: Options, r: Report): Promise<void> {
  const project = o.required("project");
  const output = o.required("output");
  const width = o.integer("width") ?? 1280;
  const height = o.integer("height") ?? 720;
  readPackageJson(project);
  const config = nodeConfig(project);
  const route = o.text("scene") ?? config.capture?.path ?? "/";
  r.data = { scene: route, width, height } satisfies CaptureData;
  const script = declaredScript(project, config, "launch");

  const edge = findEdge();
  if (edge.path === null) {
    throw new Failure("browser-not-found", `Edge introuvable (cherché : ${edge.searched.join(", ")}) : installer Microsoft Edge ou désigner son exécutable par SPAWN_EDGE`);
  }

  const session = new Session("capture", o, r, 120, project);
  const started = await session.start(script);
  const url = withRoute(started.url, route);
  r.data = { scene: route, width, height, url };
  // Profil jetable : sans lui, Edge confierait l'adresse à une instance déjà ouverte au lieu de faire la capture.
  const profile = mkdtempSync(join(tmpdir(), "spawn-edge-"));
  let edgeRun: { code: number | null; output: string; ms: number } | undefined;
  try {
    mkdirSync(dirname(output), { recursive: true });
    rmSync(output, { force: true });
    const launched = Date.now();
    const result = await run({
      command: {
        program: edge.path,
        args: [
          "--headless=new",
          "--disable-gpu",
          "--hide-scrollbars",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-extensions",
          `--user-data-dir=${profile}`,
          `--screenshot=${output}`,
          `--window-size=${width},${height}`,
          // --timeout, pas --virtual-time-budget : celui-ci attend que la page soit au repos, ce qu'une app qui garde une
          // connexion ouverte (flux d'événements, rechargement de Vite) n'est jamais ; Edge ne rendait rien (essai du 18/11).
          `--timeout=${config.capture?.wait_ms ?? 1000}`,
          url,
        ],
      },
      cwd: project,
      log: session.log,
      deadline: session.deadline,
    });
    edgeRun = { code: result.code, output: result.output, ms: Date.now() - launched };
    if (result.timedOut) throw new Failure("timeout", "délai dépassé pendant la capture : Edge arrêté par son PID et ses descendants");
  } finally {
    killTree(started.pid);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
  // L'app a pu planter après avoir donné son URL : son erreur est dans le journal.
  for (const d of parseErrors(readFileSync(session.log, "utf8"), session.paths)) {
    if (d.code === "runtime-error") r.errors.push(d);
  }
  if (!isPng(output)) {
    // Le code de sortie, la durée et la fin de la sortie d'Edge disent pourquoi (essai du 18/11 : « pas d'image » seul a
    // coûté un long diagnostic ; Edge s'arrêtait en 68 ms dans les processus de l'app, et un redémarrage l'a réglé).
    const tail = (edgeRun?.output ?? "").trim().split(/\r?\n/).slice(-3).join(" | ") || "aucune";
    throw new Failure(
      "capture-failed",
      `Edge n'a pas écrit d'image PNG en ${output} : il s'est arrêté avec le code ${String(edgeRun?.code ?? "?")} après ${edgeRun?.ms ?? "?"} ms ; sa sortie : ${tail}. Un arrêt en moins d'une seconde, sans sortie, est Edge lui-même qui refuse de démarrer : le dire à l'utilisateur, ne rien changer au projet`,
    );
  }
  r.artifact(output, "capture", "png");
}
