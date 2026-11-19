// Où est Godot : option, variable, réglage machine, PATH, puis recherche de la version du projet dans les
// dossiers habituels. Une variable d'environnement seule a échoué au premier démarrage réel (essai du morpion) :
// elle exige un nouveau terminal et rien ne la retenait.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { Failure } from "./result.ts";

export type Source = "option" | "variable" | "setting" | "path" | "search";

export interface Executable {
  path: string;
  source: Source;
}

const NAME = /^Godot_v(\d+(?:\.\d+)*)-stable_(?:win64|win32|linux\.x86_64|linux\.arm64)(_console)?(?:\.exe)?$/i;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// `4.7.2` correspond à `4.7.2` et `4.7.2.1`, pas à `4.7.20` ; une version vide accepte tout.
export function versionMatches(found: string, expected: string | null): boolean {
  return expected === null || found === expected || found.startsWith(`${expected}.`);
}

export function projectVersion(project: string | undefined): string | null {
  if (project === undefined) return null;
  try {
    const c = JSON.parse(readFileSync(join(project, "spawn.json"), "utf8")) as { version?: unknown };
    return typeof c.version === "string" ? c.version : null;
  } catch {
    return null;
  }
}

export function machineSettingsPath(): string {
  return join(process.env.SPAWN_CONFIG || join(homedir(), ".spawn"), "engines.json");
}

function readSetting(version: string | null): string | undefined {
  const path = machineSettingsPath();
  if (!existsSync(path)) return undefined;
  let godot: Record<string, unknown>;
  try {
    godot = ((JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>).godot ?? {}) as Record<string, unknown>;
  } catch {
    throw new Failure("setting-unreadable", `${path} illisible : le corriger ou le supprimer`);
  }
  const entries = Object.entries(godot).filter((e): e is [string, string] => typeof e[1] === "string");
  const chosen = version === null ? (entries.length === 1 ? entries[0] : undefined) : entries.find(([v]) => versionMatches(v, version));
  if (chosen === undefined) return undefined;
  if (!isFile(chosen[1])) throw new Failure("engine-not-found", `${path} désigne pour Godot ${chosen[0]} un fichier absent : ${chosen[1]}`);
  return chosen[1];
}

function findInPath(names: readonly string[]): string | undefined {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter((d) => d !== "");
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE").split(";").filter((e) => e !== "") : [""];
  for (const dir of dirs) {
    for (const name of names) {
      for (const ext of extensions) {
        const candidate = join(dir, name + ext.toLowerCase());
        if (isFile(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

export function searchDirs(): string[] {
  const home = homedir();
  const extra = (process.env.SPAWN_GODOT_SEARCH ?? "").split(delimiter).filter(Boolean);
  if (process.platform !== "win32") return [...extra, join(home, "Applications"), join(home, "bin"), join(home, "Godot"), "/opt", "/usr/local/bin"];
  const drive = process.env.SystemDrive ?? "C:";
  return [
    ...extra,
    join(drive, "\\Dev"),
    join(home, "Documents", "Godot4"),
    join(home, "Documents", "Godot"),
    join(home, "Documents"),
    join(home, "Desktop"),
    join(home, "Downloads"),
    join(home, "Godot"),
    join(drive, "\\Godot"),
    process.env.ProgramFiles ?? join(drive, "\\Program Files"),
    process.env["ProgramFiles(x86)"] ?? join(drive, "\\Program Files (x86)"),
    join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Programs"),
  ];
}

interface Candidate {
  path: string;
  version: string;
  console: boolean;
}

// Un niveau de sous-dossier : l'archive officielle se décompresse en `Godot_v4.7.2-stable_win64/<exe>`.
export function search(version: string | null, dirs: readonly string[] = searchDirs()): Candidate[] {
  const found: Candidate[] = [];
  const examine = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = join(dir, e.name);
      const m = NAME.exec(e.name);
      if (m && e.isFile() && versionMatches(m[1] ?? "", version)) found.push({ path, version: m[1] ?? "", console: m[2] !== undefined });
      else if (e.isDirectory() && depth > 0 && /godot/i.test(e.name)) examine(path, depth - 1);
    }
  };
  for (const d of dirs) examine(d, 1);
  // La variante sans console d'abord : elle n'ouvre pas de fenêtre de terminal, et sa sortie est captée pareil.
  return found.sort((a, b) => Number(a.console) - Number(b.console) || b.version.localeCompare(a.version, undefined, { numeric: true }));
}

export function resolveExecutable(option: string | undefined, project?: string): Executable {
  if (option !== undefined) {
    if (!isFile(option)) throw new Failure("engine-not-found", `--engine ne désigne pas un fichier : ${option}`);
    return { path: option, source: "option" };
  }
  const variable = process.env.SPAWN_GODOT;
  if (variable !== undefined && variable !== "") {
    if (!isFile(variable)) throw new Failure("engine-not-found", `SPAWN_GODOT ne désigne pas un fichier : ${variable}`);
    return { path: variable, source: "variable" };
  }
  const version = projectVersion(project);
  const setting = readSetting(version);
  if (setting !== undefined) return { path: setting, source: "setting" };
  const inPath = findInPath(["godot", "godot4"]);
  if (inPath !== undefined && version === null) return { path: inPath, source: "path" };
  const found = search(version)[0];
  if (found !== undefined) return { path: found.path, source: "search" };
  if (inPath !== undefined) return { path: inPath, source: "path" };
  const what = version === null ? "Godot" : `Godot ${version}`;
  throw new Failure(
    "engine-not-found",
    `${what} introuvable sur cette machine (cherché dans ${machineSettingsPath()}, le PATH et les dossiers habituels). ` +
      `Ensuite : spawn engines set godot ${version ?? "<version>"} "<chemin de l'exécutable Godot>" , une seule fois pour cette machine.`,
  );
}
