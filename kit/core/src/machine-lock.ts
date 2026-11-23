// Verrou de la machine (docs/reglages.md §3.2) : une seule suite de tests à la fois, tous projets et tous processus
// confondus (CLI des agents, service). Le 22/11, trois suites lourdes en même temps dépassaient leurs délais.
// Un fichier créé en exclusif sous ~/.spawn/locks ; un verrou dont le processus est mort ou trop vieux est repris.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Posée dans l'environnement du détenteur : une suite qui lance elle-même un adaptateur (les tests du kit) ne doit pas
// attendre le verrou de sa propre suite.
export const LOCK_ENV = "SPAWN_MACHINE_LOCK";
const STALE_MS = 3 * 3600_000;

const lockPath = (name: string) => join(process.env.SPAWN_CONFIG || join(homedir(), ".spawn"), "locks", `${name}.lock`);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function holder(path: string): { pid: number; since: string } | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as { pid: number; since: string };
  } catch {
    return null;
  }
}

function mtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return Date.now();
  }
}

// Rend la fonction qui libère le verrou. `onWait` est appelé une fois, si un autre détenteur fait attendre.
export async function machineLock(name: string, onWait?: (who: string) => void, pollMs = 2000): Promise<() => void> {
  if (process.env[LOCK_ENV]) return () => {};
  const path = lockPath(name);
  mkdirSync(join(path, ".."), { recursive: true });
  let told = false;
  for (;;) {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, since: new Date().toISOString() }), { flag: "wx" });
      return () => {
        if (holder(path)?.pid === process.pid) rmSync(path, { force: true });
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const h = holder(path);
    // Illisible depuis plus de 10 s : écriture jamais finie (processus tué entre la création et l'écriture).
    if (!h && Date.now() - mtime(path) > 10_000) {
      rmSync(path, { force: true });
      continue;
    }
    // Illisible (écriture en cours) : on réessaie ; mort ou trop vieux : repris.
    if (h && (!alive(h.pid) || Date.now() - Date.parse(h.since) > STALE_MS)) {
      // Relu juste avant : ne pas retirer le verrou qu'un autre vient de reprendre.
      const again = holder(path);
      if (again?.pid === h.pid && again.since === h.since) rmSync(path, { force: true });
      continue;
    }
    if (!told && h) onWait?.(`processus ${h.pid}, depuis ${h.since}`);
    told = true;
    await new Promise((ok) => setTimeout(ok, pollMs));
  }
}
