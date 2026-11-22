// Projet Node : `package.json` à la racine, commandes déclarées dans `spawn.json`, section `node`.
// L'adaptateur ne lance que les scripts npm que le projet y nomme : rien n'y est propre à un projet donné.
import { randomBytes } from "node:crypto";
import { existsSync, globSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options } from "./arguments.ts";
import { Failure } from "./result.ts";

export interface CaptureConfig {
  // Route ajoutée à l'URL rendue par le script de lancement (« /settings »).
  path?: string;
  // Attente avant la prise de vue, en millisecondes.
  wait_ms?: number;
}

// Exécution de compile, test et smoke_test dans un conteneur (launch et capture restent locaux : fenêtre, Edge).
export interface RunnerConfig {
  type: "docker";
  image: string;
}

export interface NodeConfig {
  runner?: RunnerConfig;
  compile?: string[];
  test?: string;
  smoke_test?: string;
  launch?: string;
  capture?: CaptureConfig;
  // Motifs (glob, relatifs au projet) des fichiers de test de bout en bout.
  end_to_end?: string[];
}

export interface SpawnJson {
  engine: string | null;
  version: string | null;
  node: NodeConfig;
}

const KEYS = ["runner", "compile", "test", "smoke_test", "launch", "capture", "end_to_end"] as const;
export type ScriptKey = "test" | "smoke_test" | "launch";

// Un nom de script passe par le shell (`npm run <nom>`) : seuls les caractères sans effet sur le shell sont admis.
const SCRIPT_NAME = /^[A-Za-z0-9@][\w:.@/-]*$/;

const EXAMPLE: Record<(typeof KEYS)[number], string> = {
  runner: '"runner": { "type": "docker", "image": "node:24-alpine" }',
  compile: '"compile": ["typecheck", "lint"]',
  test: '"test": "test"',
  smoke_test: '"smoke_test": "smoke"',
  launch: '"launch": "dev"',
  capture: '"capture": { "path": "/", "wait_ms": 1000 }',
  end_to_end: '"end_to_end": ["test/e2e/**/*.test.ts"]',
};

export function whatToAdd(key: (typeof KEYS)[number]): string {
  return `ajouter à spawn.json, section "node", la clé ${EXAMPLE[key]} (scripts npm de package.json)`;
}

export function checkProject(project: string): void {
  if (!existsSync(join(project, "package.json"))) {
    throw new Failure("project-not-found", `aucun package.json dans ${project}`);
  }
}

export interface PackageJson {
  name?: string;
  scripts: Record<string, string>;
  dependencyCount: number;
  workspaces: string[];
}

export function readPackageJson(project: string): PackageJson {
  checkProject(project);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
  } catch (e) {
    throw new Failure("package-json-invalid", `package.json illisible : ${(e as Error).message}`, "package.json");
  }
  const p = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const scripts: Record<string, string> = {};
  if (typeof p.scripts === "object" && p.scripts !== null) {
    for (const [k, v] of Object.entries(p.scripts)) if (typeof v === "string") scripts[k] = v;
  }
  let dependencyCount = 0;
  for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const d = p[key];
    if (typeof d === "object" && d !== null) dependencyCount += Object.keys(d).length;
  }
  const ws = Array.isArray(p.workspaces)
    ? p.workspaces
    : typeof p.workspaces === "object" && p.workspaces !== null && Array.isArray((p.workspaces as { packages?: unknown }).packages)
      ? (p.workspaces as { packages: unknown[] }).packages
      : [];
  return {
    ...(typeof p.name === "string" ? { name: p.name } : {}),
    scripts,
    dependencyCount,
    workspaces: ws.filter((w): w is string => typeof w === "string"),
  };
}

function invalid(message: string): Failure {
  return new Failure("spawn-json-invalid", `spawn.json : ${message}`, "spawn.json");
}

function scriptName(value: unknown, where: string): string {
  if (typeof value !== "string" || !SCRIPT_NAME.test(value)) throw invalid(`${where} doit être le nom d'un script npm (lettres, chiffres, « : . - _ @ / »)`);
  return value;
}

export function parseNodeSection(raw: unknown): NodeConfig {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid('"node" doit être un objet');
  const n = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(n).filter((k) => !(KEYS as readonly string[]).includes(k));
  if (unknownKeys.length > 0) throw invalid(`clé inconnue dans "node" : ${unknownKeys.join(", ")} (connues : ${KEYS.join(", ")})`);
  const c: NodeConfig = {};
  if (n.runner !== undefined) {
    const x = n.runner as Record<string, unknown>;
    if (typeof x !== "object" || x === null || Array.isArray(x)) throw invalid('"node.runner" doit être un objet { "type": "docker", "image": "…" }');
    const extra = Object.keys(x).filter((k) => k !== "type" && k !== "image");
    if (extra.length > 0) throw invalid(`clé inconnue dans "node.runner" : ${extra.join(", ")} (connues : type, image)`);
    if (x.type !== "docker") throw invalid('"node.runner.type" doit valoir "docker"');
    // Un nom d'image passe par docker, pas par un shell : on borne tout de même les caractères admis.
    if (typeof x.image !== "string" || !/^[A-Za-z0-9][\w./:@-]*$/.test(x.image)) throw invalid('"node.runner.image" doit être un nom d\'image (ex. "node:24-alpine")');
    c.runner = { type: "docker", image: x.image };
  }
  if (n.compile !== undefined) {
    if (!Array.isArray(n.compile) || n.compile.length === 0) throw invalid('"node.compile" doit être une liste non vide de scripts npm');
    c.compile = n.compile.map((s, i) => scriptName(s, `"node.compile[${i}]"`));
  }
  for (const key of ["test", "smoke_test", "launch"] as const) {
    if (n[key] !== undefined) c[key] = scriptName(n[key], `"node.${key}"`);
  }
  if (n.capture !== undefined) {
    const cap = n.capture as Record<string, unknown>;
    if (typeof cap !== "object" || cap === null || Array.isArray(cap)) throw invalid('"node.capture" doit être un objet { "path"?, "wait_ms"? }');
    const extra = Object.keys(cap).filter((k) => k !== "path" && k !== "wait_ms");
    if (extra.length > 0) throw invalid(`clé inconnue dans "node.capture" : ${extra.join(", ")} (connues : path, wait_ms)`);
    c.capture = {};
    if (cap.path !== undefined) {
      if (typeof cap.path !== "string" || !cap.path.startsWith("/")) throw invalid('"node.capture.path" doit être une route qui commence par « / »');
      c.capture.path = cap.path;
    }
    if (cap.wait_ms !== undefined) {
      if (!Number.isInteger(cap.wait_ms) || (cap.wait_ms as number) < 0 || (cap.wait_ms as number) > 600_000) {
        throw invalid('"node.capture.wait_ms" doit être un entier de 0 à 600000');
      }
      c.capture.wait_ms = cap.wait_ms as number;
    }
  }
  if (n.end_to_end !== undefined) {
    if (!Array.isArray(n.end_to_end) || !n.end_to_end.every((p) => typeof p === "string" && p.length > 0)) {
      throw invalid('"node.end_to_end" doit être une liste de motifs de fichiers (ex. ["test/e2e/**/*.test.ts"])');
    }
    c.end_to_end = n.end_to_end as string[];
  }
  return c;
}

// spawn.json du projet (le worktree en porte une copie versionnée). Absent : null.
export function readSpawnJson(project: string): SpawnJson | null {
  const path = join(project, "spawn.json");
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw invalid(`illisible : ${(e as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid("un objet JSON est attendu");
  const s = raw as Record<string, unknown>;
  if (s.engine !== undefined && s.engine !== "node") {
    throw new Failure("engine-mismatch", `spawn.json déclare le moteur ${String(s.engine)}, pas node`, "spawn.json");
  }
  return {
    engine: typeof s.engine === "string" ? s.engine : null,
    version: typeof s.version === "string" ? s.version : null,
    node: parseNodeSection(s.node),
  };
}

export function nodeConfig(project: string): NodeConfig {
  const s = readSpawnJson(project);
  if (s === null) {
    throw new Failure(
      "spawn-json-missing",
      `spawn.json absent à la racine de ${project} : y écrire { "engine": "node", "version": "${process.versions.node.split(".")[0] ?? ""}", "node": { ... } } avec les scripts npm du projet`,
      "spawn.json",
    );
  }
  return s.node;
}

// Script déclaré pour une commande, et présent dans package.json ; sinon un échec qui dit quoi ajouter.
export function declaredScript(project: string, config: NodeConfig, key: ScriptKey, code = "not-declared"): string {
  const name = config[key];
  if (name === undefined) throw new Failure(code, `commande non déclarée : ${whatToAdd(key)}`, "spawn.json");
  requireScript(project, name, `node.${key}`);
  return name;
}

export function requireScript(project: string, name: string, where: string): void {
  if (!Object.hasOwn(readPackageJson(project).scripts, name)) {
    throw new Failure("script-missing", `package.json ne déclare pas le script « ${name} » (cité par spawn.json, ${where}) : l'ajouter à "scripts"`, "package.json");
  }
}

export function timestamp(date = new Date()): string {
  const d = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${d(date.getMonth() + 1)}${d(date.getDate())}-` +
    `${d(date.getHours())}${d(date.getMinutes())}${d(date.getSeconds())}-${randomBytes(2).toString("hex")}`
  );
}

export function logDir(options: Options, project: string | undefined): string {
  const requested = options.text("logs");
  const dir = requested ?? (project !== undefined ? join(project, ".spawn", "logs", "engine") : join(tmpdir(), "spawn", "logs", "engine"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

const SKIPPED_DIRS = new Set(["node_modules", "dist", "target", "build", "coverage"]);
const SOURCE = /\.(?:[cm]?[jt]sx?|rs)$/;

// Fichiers de code du projet, hors dépendances, sorties de construction et dossiers cachés : compte indicatif.
export function countSourceFiles(dir: string): number {
  let count = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIPPED_DIRS.has(e.name) && !e.name.startsWith(".")) count += countSourceFiles(join(dir, e.name));
    } else if (e.isFile() && SOURCE.test(e.name)) count++;
  }
  return count;
}

// Fichiers (relatifs, `/`, triés) qui correspondent aux motifs, hors node_modules.
export function matchFiles(project: string, patterns: readonly string[]): string[] {
  if (patterns.length === 0) return [];
  const found = globSync([...patterns], { cwd: project, exclude: (p: string) => /(^|[\\/])node_modules([\\/]|$)/.test(p) });
  return [...new Set(found.map((f) => f.replaceAll("\\", "/")))].sort();
}

// Dossiers des espaces de travail npm, par nom de paquet : une sortie relative au dossier d'un espace de travail
// (tsc ou node --test lancés par `npm run --workspaces`) se rapporte ainsi au projet.
export function workspaceDirs(project: string): Map<string, string> {
  const map = new Map<string, string>();
  let pkg: PackageJson;
  try {
    pkg = readPackageJson(project);
  } catch {
    return map;
  }
  if (pkg.name !== undefined) map.set(pkg.name, ".");
  if (pkg.workspaces.length === 0) return map;
  for (const dir of globSync(pkg.workspaces, { cwd: project })) {
    try {
      const raw = JSON.parse(readFileSync(join(project, dir, "package.json"), "utf8")) as { name?: unknown };
      if (typeof raw.name === "string") map.set(raw.name, dir.replaceAll("\\", "/"));
    } catch {
      // Pas un paquet : ignoré.
    }
  }
  return map;
}
