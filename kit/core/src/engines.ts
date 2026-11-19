// Réglage machine des moteurs (contrat §1) : `~/.spawn/engines.json`, `{ "<moteur>": { "<version>": "<exécutable>" } }`.
// Écrit par le cœur, lu par les adaptateurs ; une variable d'environnement ne survit pas à un nouveau terminal.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type EngineSettings = Record<string, Record<string, string>>;

export function engineSettingsPath(): string {
  return join(process.env.SPAWN_CONFIG || join(homedir(), ".spawn"), "engines.json");
}

export function readEngineSettings(): EngineSettings {
  const path = engineSettingsPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as EngineSettings;
  } catch {
    throw new Error(`${path} illisible : le corriger ou le supprimer`);
  }
}

export function setEngine(engine: string, version: string, executable: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(engine)) throw new Error(`moteur invalide : ${engine}`);
  if (!/^\d+(\.\d+)*$/.test(version)) throw new Error(`version invalide : ${version}`);
  const path = resolve(executable);
  let file = false;
  try {
    file = statSync(path).isFile();
  } catch {
    // absent
  }
  if (!file) throw new Error(`${path} n'est pas un fichier`);
  const settings = readEngineSettings();
  settings[engine] = { ...(settings[engine] ?? {}), [version]: path };
  mkdirSync(dirname(engineSettingsPath()), { recursive: true });
  writeFileSync(engineSettingsPath(), JSON.stringify(settings, null, 2) + "\n");
  return path;
}
