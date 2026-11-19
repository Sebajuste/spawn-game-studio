// Réglages d'un projet sur cette machine : `<racine>/.spawn/settings.json` (ignoré par git). Ce qui dépend de la machine
// et pas du jeu : l'agent par défaut, le modèle local (et son serveur, LM Studio ou Ollama), la taille de contexte avec
// laquelle le charger (selon la VRAM).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type AgentName = "claude-code" | "opencode" | "copilot";

export interface ProjectSettings {
  agent: AgentName;
  // Modèle local d'OpenCode, nommé comme OpenCode le nomme : `lmstudio/<modèle>` ou `ollama/<modèle>`.
  localModel: string;
  // Tokens de contexte demandés à LM Studio quand le kit charge le modèle local ; minimum exigé d'Ollama.
  localContext: number;
}

export const DEFAULT_LOCAL_MODEL = "lmstudio/qwen/qwen3.5-9b";
export const LOCAL_MODEL = /^(lmstudio|ollama)\/\S+$/;

export const DEFAULT_LOCAL_CONTEXT = 100_000;
export const MIN_LOCAL_CONTEXT = 8_000;
export const MAX_LOCAL_CONTEXT = 1_000_000;

const path = (root: string) => join(root, ".spawn", "settings.json");

export function readProjectSettings(root: string): ProjectSettings {
  let raw: Partial<ProjectSettings> = {};
  try {
    if (existsSync(path(root))) raw = JSON.parse(readFileSync(path(root), "utf8")) as Partial<ProjectSettings>;
  } catch {
    // Fichier illisible : valeurs par défaut, le prochain enregistrement le réécrit.
  }
  const context = Number(raw.localContext);
  return {
    agent: raw.agent === "opencode" || raw.agent === "copilot" ? raw.agent : "claude-code",
    localModel: typeof raw.localModel === "string" && LOCAL_MODEL.test(raw.localModel) ? raw.localModel : DEFAULT_LOCAL_MODEL,
    localContext: Number.isInteger(context) && context >= MIN_LOCAL_CONTEXT && context <= MAX_LOCAL_CONTEXT ? context : DEFAULT_LOCAL_CONTEXT,
  };
}

export function writeProjectSettings(root: string, settings: ProjectSettings): ProjectSettings {
  mkdirSync(join(root, ".spawn"), { recursive: true });
  writeFileSync(path(root), JSON.stringify(settings, null, 2) + "\n");
  return settings;
}
