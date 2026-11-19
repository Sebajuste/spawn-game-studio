// Journal des refus du périmètre : chaque refus est un blocage possible de l'agent. Le compter, et repérer les faux
// positifs, permet d'ajuster les règles sur des données (docs/kit-perimetre.md §0, « petit »).
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface Refusal {
  date: string;
  session: string | null;
  cwd: string;
  tool: string;
  target: string;
  reason: string;
}

const TARGET_SIZE = 500;

export function logPath(root: string): string {
  return join(root, ".spawn", "logs", "guard.jsonl");
}

export function recordRefusal(
  root: string,
  input: { cwd: string; tool_name: string; tool_input: Record<string, unknown>; session_id?: string },
  reason: string,
  now = new Date(),
): void {
  const i = input.tool_input;
  const raw = String(i.command ?? i.file_path ?? i.notebook_path ?? JSON.stringify(i));
  const line: Refusal = {
    date: now.toISOString(),
    session: input.session_id ?? null,
    cwd: input.cwd,
    tool: input.tool_name,
    target: raw.length > TARGET_SIZE ? raw.slice(0, TARGET_SIZE) + "…" : raw,
    reason,
  };
  // Un journal impossible à écrire ne doit pas changer le verdict : le refus tient quand même.
  try {
    mkdirSync(join(root, ".spawn", "logs"), { recursive: true });
    appendFileSync(logPath(root), JSON.stringify(line) + "\n");
  } catch {
    // Rien : le refus est déjà décidé et sera signalé à l'agent.
  }
}

export function readRefusals(root: string): Refusal[] {
  const path = logPath(root);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Refusal);
}
