// Recul d'un agent sur ses tests (étude du 23/11) : un agent qui s'entête corrige un détail que son test ou lui-même a
// fixé (5,3 s pour une limite de 5 s) au lieu de se demander ce que l'utilisateur verra. La commande `spawn engine test`
// compte les rouges successifs du même test et le dit à l'agent : au 2ᵉ, il prend du recul sur l'objectif ; au 3ᵉ, il
// s'arrête et rend compte à l'orchestrateur. Au bout de 45 min, il termine proprement au lieu d'être coupé.
// Mesure du 23/11 (26 agents de l'enchaîneur, fils Godot) : 3 seulement ont vu le même test rouge deux fois de suite.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Heure de départ de l'agent lancé par l'enchaîneur : sans elle (orchestrateur, console), pas de limite de durée.
export const AGENT_STARTED_ENV = "SPAWN_AGENT_STARTED";
export const SOFT_LIMIT_MIN = 45;

export interface RedStreak {
  // Agent qui a vu ces rouges : un autre agent repart de zéro.
  agent: string | null;
  streak: number;
  failing: string[];
  // Fin de travail déjà demandée à cet agent : une seule fois.
  wrapUp?: true;
}

interface Diagnostic {
  code: string;
  message: string;
  file?: string;
}

// Identité d'un échec : le fichier du test, sinon le début du message (une même assertion garde le même début).
export const failureKeys = (errors: readonly Diagnostic[]): string[] => [...new Set(errors.map((e) => e.file ?? `${e.code}: ${e.message.slice(0, 80)}`))];

export function readStreak(path: string): RedStreak | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RedStreak;
  } catch {
    return null;
  }
}

// Le même test encore rouge prolonge la série ; un vert, un autre test ou un autre agent la remet à zéro.
export function nextStreak(previous: RedStreak | null, agent: string | null, ok: boolean, failing: readonly string[]): RedStreak {
  const same = previous !== null && previous.agent === agent;
  const base: RedStreak = { agent, streak: 0, failing: [], ...(same && previous.wrapUp ? { wrapUp: true as const } : {}) };
  if (ok) return base;
  const continues = same && previous.streak > 0 && failing.some((f) => previous.failing.includes(f));
  return { ...base, streak: continues ? previous.streak + 1 : 1, failing: [...failing] };
}

export const STEP_BACK =
  "Recul : le même test est rouge pour la 2ᵉ fois de suite. Avant de corriger encore : " +
  "1) relis l'objectif dans ton brief : qu'est-ce que l'utilisateur doit voir ou pouvoir faire ? " +
  "2) ce rouge dit-il que l'objectif n'est pas atteint, ou bute-t-il sur un chiffre, un seuil, un détail que le test ou toi avez fixé ? " +
  "3) le système marche-t-il pour ce que l'utilisateur verra, et quelle marge serait raisonnable pour lui ? " +
  "Puis décide : si l'objectif n'est pas atteint, corrige le code. Si c'est le critère qui est faux, ne le change pas toi-même : " +
  "écris ton rapport en NEEDS_CONTEXT avec le critère que tu proposes et sa raison tirée de l'objectif, et arrête-toi.";

export const STOP =
  "Arrêt : le même test est rouge pour la 3ᵉ fois de suite, après le recul. Ne corrige plus. Commite ce qui est vert, " +
  "écris ton rapport en BLOCKED (ce que dit le test, ce que tu as essayé, ton recul sur l'objectif) et arrête-toi : l'orchestrateur décide de la suite.";

export const WRAP_UP =
  `Tu travailles depuis plus de ${SOFT_LIMIT_MIN} min sur cette tâche : termine proprement. Commite ce qui est vert et écris ton rapport : ` +
  "DONE si c'est fini, sinon NEEDS_CONTEXT avec ce qui est fait, ce qui reste et pourquoi c'est long ; puis arrête-toi.";

// Consigne à donner à l'agent après ce résultat, ou null. L'arrêt passe avant la fin de durée, qui passe avant le recul.
export function breathNotice(s: RedStreak, elapsedMin: number | null): { notice: string | null; state: RedStreak } {
  if (s.streak >= 3) return { notice: STOP, state: s };
  if (elapsedMin !== null && elapsedMin >= SOFT_LIMIT_MIN && !s.wrapUp) return { notice: WRAP_UP, state: { ...s, wrapUp: true } };
  if (s.streak === 2) return { notice: STEP_BACK, state: s };
  return { notice: null, state: s };
}

// Résultat d'un `spawn engine test` : met la série à jour dans `path` et rend la consigne éventuelle.
export function breathe(path: string, result: { ok: boolean; errors: readonly Diagnostic[] }, env: NodeJS.ProcessEnv = process.env, now = Date.now()): string | null {
  const agent = env[AGENT_STARTED_ENV] ?? null;
  const started = agent ? Date.parse(agent) : NaN;
  const elapsed = Number.isNaN(started) ? null : (now - started) / 60_000;
  const streak = nextStreak(readStreak(path), agent, result.ok, failureKeys(result.errors));
  const { notice, state } = breathNotice(streak, elapsed);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state) + "\n");
  return notice;
}
