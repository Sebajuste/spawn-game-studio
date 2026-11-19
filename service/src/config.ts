// Config de l'app : `~/.spawn/app.json`, `{ "modules": { "<id>": true|false } }`. Absent = valeurs par défaut des modules.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AppConfig {
  modules: Record<string, boolean>;
}

// Identifiants de modules d'avant le nommage anglais : lus sous leur nouveau nom, réécrits ainsi à la prochaine bascule.
const LEGACY_IDS: Record<string, string> = {
  projets: "projects",
  fils: "stories",
  features: "backlog",
  activite: "activity",
  contexte: "context",
  "barre-etat": "status-bar",
  fichiers: "files",
  galerie: "gallery",
};

export function configPath(): string {
  return join(process.env.SPAWN_CONFIG || join(homedir(), ".spawn"), "app.json");
}

export function readConfig(): AppConfig {
  const path = configPath();
  if (!existsSync(path)) return { modules: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AppConfig>;
    const modules: Record<string, boolean> = {};
    const entries = Object.entries(raw.modules ?? {});
    // Un nouveau nom l'emporte sur l'ancien s'ils sont tous les deux là.
    for (const [id, v] of entries) if (typeof v === "boolean" && LEGACY_IDS[id]) modules[LEGACY_IDS[id]] = v;
    for (const [id, v] of entries) if (typeof v === "boolean" && !LEGACY_IDS[id]) modules[id] = v;
    return { modules };
  } catch {
    throw new Error(`${path} illisible : le corriger ou le supprimer`);
  }
}

export function writeConfig(config: AppConfig): void {
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
}
