// Contexte d'une sous-commande qui lance des scripts : journal unique et échéance commune (`--timeout`).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Options } from "./arguments.ts";
import { logDir, timestamp, workspaceDirs } from "./project.ts";
import { parseErrors, Paths } from "./parse.ts";
import { npmRun, run, startDetached, type Run, type Started } from "./process.ts";
import { Failure, type Report } from "./result.ts";

export class Session {
  readonly project: string;
  readonly log: string;
  readonly deadline: number;
  readonly paths: Paths;
  private readonly report: Report;

  constructor(command: string, options: Options, report: Report, defaultTimeout: number, project: string) {
    this.project = project;
    this.report = report;
    this.deadline = Date.now() + (options.integer("timeout") ?? defaultTimeout) * 1000;
    this.log = join(logDir(options, project), `${command}-${timestamp()}.log`);
    writeFileSync(this.log, "");
    report.log = this.log;
    this.paths = new Paths(project, workspaceDirs(project));
  }

  async script(name: string, deadline = this.deadline): Promise<Run> {
    const r = await run({ command: npmRun(name), cwd: this.project, log: this.log, deadline });
    if (r.code === null && !r.timedOut) throw new Failure("launch-failed", `npm n'a pas pu être lancé pour le script « ${name} »`);
    return r;
  }

  // Lancement détaché (protocole SPAWN-URL). Une app qui plante avant d'être prête : ses erreurs, relues dans le
  // journal, accompagnent l'échec.
  async start(script: string): Promise<Started> {
    try {
      return await startDetached(script, this.project, this.log, this.deadline);
    } catch (e) {
      if (e instanceof Failure && e.code === "runtime-error") {
        for (const d of parseErrors(readFileSync(this.log, "utf8"), this.paths)) this.report.error("runtime-error", d.message, d.file, d.line);
      }
      throw e;
    }
  }
}

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/microsoft-edge",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

// Edge, pour la capture : SPAWN_EDGE d'abord (un chemin absent y vaut Edge absent), puis les emplacements habituels.
export function findEdge(): { path: string | null; searched: string[] } {
  const variable = process.env.SPAWN_EDGE;
  if (variable !== undefined && variable !== "") return { path: existsSync(variable) ? variable : null, searched: [variable] };
  return { path: EDGE.find((p) => existsSync(p)) ?? null, searched: EDGE };
}
