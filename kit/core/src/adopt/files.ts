// Fichiers communs posés par l'adoption : spawn.json et les lignes de .gitignore qui manquent. Rien n'est retiré.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DEFAULT_LIMITS } from "../project.ts";

export const KIT_GITIGNORE = [".spawn/", ".claude/worktrees/", ".claude/settings.local.json"];

export function spawnConfig(engine: string, version: string, tag: string): string {
  return JSON.stringify({ engine, version, tag, limits: DEFAULT_LIMITS }, null, 2) + "\n";
}

// Comparaison sur la ligne nue : `/.spawn/` ou `.spawn` couvrent déjà `.spawn/`.
const bare = (line: string) => line.trim().replace(/^\//, "").replace(/\/$/, "");

export function missingGitignore(root: string, wanted: readonly string[]): string[] {
  const path = join(root, ".gitignore");
  const present = new Set(existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).map(bare) : []);
  return [...new Set(wanted)].filter((l) => !present.has(bare(l)));
}

export function appendGitignore(root: string, lines: readonly string[]): void {
  if (lines.length === 0) return;
  const path = join(root, ".gitignore");
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  const sep = before === "" || before.endsWith("\n") ? "" : eol;
  writeFileSync(path, `${before}${sep}${lines.join(eol)}${eol}`);
}

// Préfixe d'exigences proposé : les initiales d'un nom composé, sinon ses trois premières lettres.
export function proposeTag(dir: string): string {
  const words = basename(dir)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const initials = words.length > 1 ? words.map((w) => w[0]).join("").slice(0, 4) : (words[0] ?? "").slice(0, 3);
  const tag = /^[A-Z]/.test(initials) ? initials : `P${initials}`;
  return /^[A-Z][A-Z0-9]{1,5}$/.test(tag) ? tag : "PRJ";
}
