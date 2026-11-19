// Où vit le kit qui s'exécute, et quel kit donner aux agents (docs/specs/spawn-sur-spawn.md, SGS-06).
// Une copie complète (dépôt ou runtime, avec `kit/engines` à côté) se désigne elle-même. Une copie incomplète (le cache
// du plugin de Claude Code d'avant le runtime : `kit/core` seul) désigne le runtime actif, jamais elle-même.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OWN_CORE = resolve(fileURLToPath(new URL("../", import.meta.url)));

export function spawnConfigDir(): string {
  return process.env.SPAWN_CONFIG || join(homedir(), ".spawn");
}

export function runtimeRoot(): string {
  return join(spawnConfigDir(), "runtime");
}

// Lanceurs de la commande `spawn` (`spawn.cmd`, `spawn`) : ce que les agents tapent, sans chemin absolu. Un chemin
// absolu dans une consigne finit recopié dans les plans et les docs du projet, avec le nom de compte de la machine.
export function binDir(): string {
  return join(spawnConfigDir(), "bin");
}

export const isInside = (path: string, dir: string): boolean => {
  const r = relative(resolve(dir), resolve(path));
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

// Node embarqué par une version du runtime (`<version>/node/`, à côté de `<version>/kit/core`) : Spawn tourne sans Node
// installé (décidé le 2026-11-18, option A). Hors runtime (dépôt), le chemin n'existe pas.
export const NODE_EXE = process.platform === "win32" ? "node.exe" : "node";
export const embeddedNode = (core: string) => join(core, "..", "..", "node", NODE_EXE);

export interface Current {
  version: string;
  since: string;
}

export function readCurrent(root = runtimeRoot()): Current | null {
  const path = join(root, "current.json");
  if (!existsSync(path)) return null;
  try {
    const c = JSON.parse(readFileSync(path, "utf8")) as Partial<Current>;
    return typeof c.version === "string" ? { version: c.version, since: String(c.since ?? "") } : null;
  } catch {
    return null;
  }
}

// Un kit complet a ses adaptateurs de moteur à côté de lui (`kit/engines`).
export function completeKit(core: string): boolean {
  return existsSync(join(core, "src", "cli.ts")) && existsSync(join(core, "..", "engines"));
}

function resolveCore(): string {
  if (completeKit(OWN_CORE)) return OWN_CORE;
  const current = readCurrent();
  if (current) {
    const core = join(runtimeRoot(), current.version, "kit", "core");
    if (completeKit(core)) return core;
  }
  return OWN_CORE;
}

// Le kit dont on donne les chemins (commandes des agents, adaptateurs de moteur, sources des skills).
export const KIT_CORE = resolveCore();
// Racine de ce kit : le dépôt, ou le dossier d'une version du runtime.
export const KIT_ROOT = resolve(KIT_CORE, "..", "..");
