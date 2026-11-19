// Agents au travail sur cette machine (SGS-09) : le service écrit un fichier tant qu'une conversation tourne, le pilote
// tant qu'il tourne. Installer ou changer de version du runtime refuse tant que l'un d'eux est vivant.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KIT_CORE, runtimeRoot } from "./location.ts";

export interface Activity {
  kind: "service" | "pilot";
  pid: number;
  // Kit qu'exécute ce processus.
  kit: string;
  since: string;
  // Ce qui tourne : conversations « projet/story » du service, fil du pilote.
  work: string[];
}

export const activityDir = () => join(runtimeRoot(), "activity");
const fileOf = (kind: string, pid: number) => join(activityDir(), `${kind}-${pid}.json`);

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM : le processus existe, il appartient à un autre utilisateur.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Inscrit le travail en cours de ce processus ; une liste vide l'efface.
export function recordActivity(kind: Activity["kind"], work: readonly string[]): void {
  const path = fileOf(kind, process.pid);
  try {
    if (work.length === 0) {
      rmSync(path, { force: true });
      return;
    }
    mkdirSync(activityDir(), { recursive: true });
    const previous = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Activity) : null;
    const a: Activity = { kind, pid: process.pid, kit: KIT_CORE, since: previous?.since ?? new Date().toISOString(), work: [...work] };
    writeFileSync(path, JSON.stringify(a, null, 2) + "\n");
  } catch {
    // Le suivi ne doit jamais faire échouer un tour d'agent.
  }
}

// Processus vivants qui font travailler un agent ; les fichiers des processus morts sont ignorés.
export function busyAgents(): Activity[] {
  const dir = activityDir();
  if (!existsSync(dir)) return [];
  const found: Activity[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const a = JSON.parse(readFileSync(join(dir, f), "utf8")) as Activity;
      if (Number.isInteger(a.pid) && a.work.length > 0 && alive(a.pid)) found.push(a);
    } catch {
      // Fichier illisible : ignoré.
    }
  }
  return found;
}

export function describeActivity(a: Activity): string {
  const what = a.kind === "service" ? `service de l'app (conversation ${a.work.join(", ")})` : `pilote (fil ${a.work.join(", ")})`;
  return `${what}, pid ${a.pid}, depuis ${a.since}, kit ${a.kit}`;
}
