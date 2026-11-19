// Mesures d'un essai sous OpenCode v2, lues dans les exports JSON de sessions (`opencode session export <id>`).
// Un export ne contient pas ses sessions enfants (sous-agents) : il faut les exporter une par une, leur id se
// trouve dans `info.parentID` côté enfant et dans la part `subagent` du parent (`state.metadata.sessionID`).
import type { Intervention, Tokens } from "./metrics.ts";

export interface OpencodeMetrics {
  sessions: number;
  interventions: Intervention[];
  tokens: Tokens;
  by_model: Record<string, Tokens>;
}

interface OpencodeTokens {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

interface Model {
  id?: string;
  providerID?: string;
}

interface Message {
  type?: string;
  text?: string;
  time?: { created?: number };
  model?: Model;
  tokens?: OpencodeTokens;
}

interface Export {
  info: { id: string; parentID?: string; model?: Model; tokens?: OpencodeTokens };
  messages?: Message[];
}

const empty = (): Tokens => ({ input: 0, cache_write: 0, cache_read: 0, output: 0 });

// Le raisonnement est facturé comme de la sortie ; OpenCode le compte à part.
const convert = (t: OpencodeTokens | undefined): Tokens => ({
  input: t?.input ?? 0,
  cache_write: t?.cache?.write ?? 0,
  cache_read: t?.cache?.read ?? 0,
  output: (t?.output ?? 0) + (t?.reasoning ?? 0),
});

const append = (target: Tokens, t: Tokens) => {
  target.input += t.input;
  target.cache_write += t.cache_write;
  target.cache_read += t.cache_read;
  target.output += t.output;
};

const modelName = (m: Model | undefined) => (m?.id ? `${m.providerID ?? "?"}/${m.id}` : "?");

function isExport(e: unknown): e is Export {
  if (typeof e !== "object" || e === null || !("info" in e)) return false;
  const info: unknown = e.info;
  return typeof info === "object" && info !== null && "id" in info && typeof info.id === "string";
}

export function measureOpencode(exports: unknown[]): OpencodeMetrics {
  const seen = new Set<string>();
  const interventions: Intervention[] = [];
  const tokens = empty();
  const byModel: Record<string, Tokens> = {};
  for (const e of exports) {
    if (!isExport(e) || seen.has(e.info.id)) continue;
    seen.add(e.info.id);
    const messages = e.messages ?? [];
    const session = empty();
    for (const m of messages) {
      if (m.type === "assistant" && m.tokens) {
        const t = convert(m.tokens);
        append((byModel[modelName(m.model)] ??= empty()), t);
        append(session, t);
      } else if (m.type === "user" && e.info.parentID === undefined) {
        // Dans une session enfant, le message « user » est la consigne du parent, pas l'utilisateur.
        interventions.push({
          session: e.info.id,
          date: new Date(m.time?.created ?? 0).toISOString(),
          text: (m.text ?? "").slice(0, 200),
        });
      }
    }
    // Le total de la session dépasse la somme de ses messages (génération du titre, mesurée : +515 en entrée) :
    // le reste est attribué au modèle de la session pour que le total suive `info.tokens`.
    const total = convert(e.info.tokens);
    const rest: Tokens = {
      input: Math.max(0, total.input - session.input),
      cache_write: Math.max(0, total.cache_write - session.cache_write),
      cache_read: Math.max(0, total.cache_read - session.cache_read),
      output: Math.max(0, total.output - session.output),
    };
    if (rest.input + rest.cache_write + rest.cache_read + rest.output > 0) append((byModel[modelName(e.info.model)] ??= empty()), rest);
    append(session, rest);
    append(tokens, session);
  }
  return {
    sessions: seen.size,
    interventions: interventions.sort((a, b) => a.date.localeCompare(b.date)),
    tokens,
    by_model: byModel,
  };
}
