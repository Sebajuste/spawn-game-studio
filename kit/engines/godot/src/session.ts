import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Options } from "./arguments.ts";
import { parseLog } from "./log.ts";
import { resolveExecutable, type Source } from "./executable.ts";
import { runEngine, type Run } from "./engine.ts";
import { Failure, type Report } from "./result.ts";

export const TOOLS_DIR = fileURLToPath(new URL("../tools/", import.meta.url));

export function timestamp(date = new Date()): string {
  const d = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${d(date.getMonth() + 1)}${d(date.getDate())}-` +
    `${d(date.getHours())}${d(date.getMinutes())}${d(date.getSeconds())}-${randomBytes(2).toString("hex")}`
  );
}

export function checkProject(project: string): void {
  if (!existsSync(join(project, "project.godot"))) {
    throw new Failure("project-not-found", `aucun project.godot dans ${project}`);
  }
}

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// Le dossier des journaux ne doit pas être importé par Godot : un `.gdignore` le protège.
export function logDir(options: Options, project: string | undefined): string {
  const requested = options.text("logs");
  let dir: string;
  if (requested !== undefined) {
    dir = requested;
    mkdirSync(dir, { recursive: true });
    if (project !== undefined && isUnder(project, dir)) writeIfMissing(join(dir, ".gdignore"), "");
  } else if (project !== undefined) {
    const spawn = join(project, ".spawn");
    dir = join(spawn, "logs", "engine");
    mkdirSync(dir, { recursive: true });
    writeIfMissing(join(spawn, ".gdignore"), "");
  } else {
    dir = join(tmpdir(), "spawn", "logs", "engine");
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function isUnder(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function writeIfMissing(path: string, content: string): boolean {
  if (existsSync(path)) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return true;
}

export interface RunOptions {
  user?: readonly string[];
  window?: boolean;
  // Jeton déjà porté par un argument du lancement (GUT refuse tout argument qu'il ne connaît pas).
  includedToken?: string;
}

// Contexte d'une sous-commande qui lance Godot : exécutable, échéance commune à tous les
// lancements (`--timeout` borne la sous-commande entière) et journal unique.
export class Session {
  readonly project: string | undefined;
  readonly logDir: string;
  readonly executable: string;
  readonly source: Source;
  readonly deadline: number;
  readonly log: string;
  private readonly report: Report;

  constructor(command: string, options: Options, report: Report, defaultTimeout: number, project: string | undefined) {
    this.project = project;
    this.report = report;
    const found = resolveExecutable(options.text("engine"), project);
    this.executable = found.path;
    this.source = found.source;
    this.deadline = Date.now() + (options.integer("timeout") ?? defaultTimeout) * 1000;
    this.logDir = logDir(options, project);
    this.log = join(this.logDir, `${command}-${timestamp()}.log`);
    writeFileSync(this.log, "");
    report.log = this.log;
  }

  // Le code de sortie brut est exposé dans `data.engine_exit_code` : il sert à prouver
  // que le verdict ne s'y fie pas (Godot sort en 0 sur une erreur de script).
  async run(args: readonly string[], o: RunOptions = {}): Promise<Run> {
    const l = await runEngine({
      executable: this.executable,
      args,
      userArgs: o.user ?? [],
      log: this.log,
      deadline: this.deadline,
      window: o.window ?? false,
      ...(o.includedToken === undefined ? {} : { includedToken: o.includedToken }),
    });
    this.report.data.engine_exit_code = l.code;
    if (l.timedOut) throw new Failure("timeout", "délai dépassé : Godot a été arrêté par son PID et ses descendants");
    if (l.code === null) throw new Failure("engine-launch-failed", `Godot n'a pas pu être lancé : ${this.executable}`);
    return l;
  }

  // `--import` sort en 0 même quand un script ne compile pas : son code ne prouve rien.
  // Il est refait avant chaque vérification, sinon un `class_name` récent est introuvable
  // (« Could not find base class ») et donne une fausse erreur.
  async importProject(): Promise<void> {
    const project = this.requireProject();
    const l = await this.run(["--headless", "--path", project, "--import"]);
    for (const d of parseLog(l.output, project)) {
      this.report.warn(`import-${d.code}`, d.message, d.file, d.line);
    }
    if (!isDir(join(project, ".godot"))) {
      throw new Failure("import-incomplete", "l'import n'a pas créé .godot/");
    }
  }

  requireProject(): string {
    if (this.project === undefined) throw new Error("session sans projet");
    return this.project;
  }
}
