// Stockage d'une conversation de portée : `state.json` (agent, session, tours) et la sortie brute de chaque tour
// (`turn-N.jsonl`), dans le dossier que donne la portée (scope.ts).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentName, TalkActionResult } from "../../contract.ts";

export interface StoredTalkTurn {
  n: number;
  agent: AgentName;
  message: string;
  start: string;
  end: string | null;
  code: number | null;
  stopped: boolean;
  // Coupé par un arrêt de l'app ou du PC : on reprend en écrivant (pas de reprise automatique ici).
  interrupted: boolean;
  refused: string[];
  actions: TalkActionResult[];
}

export interface TalkState {
  agent: AgentName;
  session: string | null;
  turns: StoredTalkTurn[];
}

export const turnFile = (dir: string, n: number) => join(dir, `turn-${n}.jsonl`);

export function readTalk(dir: string): TalkState | null {
  const path = join(dir, "state.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TalkState;
  } catch {
    return null;
  }
}

export function writeTalk(dir: string, state: TalkState): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2) + "\n");
}

// Tours restés sans fin alors qu'aucun ne tourne : le service s'est arrêté pendant. Marqués une fois pour toutes.
export function markInterrupted(dir: string): void {
  const state = readTalk(dir);
  if (!state?.turns.some((t) => t.end === null)) return;
  for (const t of state.turns) {
    if (t.end !== null) continue;
    t.end = new Date().toISOString();
    t.interrupted = true;
  }
  writeTalk(dir, state);
}
