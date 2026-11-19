// Mesures d'un essai (docs/plan-implementation.md, phase 4) : interventions de l'utilisateur, tokens, rounds de
// correction, worktrees et branches restants. Lu dans les transcripts de Claude Code, pas déclaré par les agents.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { ledgerPath } from "./context.ts";
import { git } from "./git.ts";
import { readLedger } from "./ledger.ts";

export interface Intervention {
  session: string;
  date: string;
  text: string;
}

export interface Tokens {
  input: number;
  cache_write: number;
  cache_read: number;
  output: number;
}

export interface Metrics {
  since: string | null;
  sessions: number;
  transcripts: number;
  interventions: Intervention[];
  tokens: Tokens;
  by_model: Record<string, Tokens>;
  cost: Cost;
  rounds: number;
  parked_tasks: number;
  remaining_worktrees: string[];
  remaining_feature_branches: string[];
}

// Coût estimé par Claude Code (tarif de l'API ; sur un abonnement, c'est du quota, pas une facture), lu dans les sorties
// des tours de la conversation et des agents de l'enchaîneur. `total_cost_usd` est cumulé sur la session (sous-agents
// compris) : la dernière ligne `result` d'une session en donne le total. Un tour coupé n'écrit pas de `result` ; repris
// dans la même session, il est compté par le `result` suivant ; sinon il est déclaré non mesuré.
export interface Cost {
  usd: number;
  by_model: Record<string, number>;
  sessions: number;
  unmeasured: string[];
}

interface Output {
  file: string;
  session: string | null;
  result: { usd: number; by_model: Record<string, number> } | null;
}

function readOutput(file: string): Output {
  let session: string | null = null;
  let result: Output["result"] = null;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!raw.startsWith("{")) continue;
    let l: { type?: string; session_id?: string; total_cost_usd?: number; modelUsage?: Record<string, { costUSD?: number }> };
    try {
      l = JSON.parse(raw) as typeof l;
    } catch {
      continue;
    }
    session ??= l.session_id ?? null;
    if (l.type === "result" && typeof l.total_cost_usd === "number") {
      result = { usd: l.total_cost_usd, by_model: Object.fromEntries(Object.entries(l.modelUsage ?? {}).map(([m, u]) => [m, u.costUSD ?? 0])) };
    }
  }
  return { file, session, result };
}

const turnNumber = (f: string) => Number(/turn-(\d+)\.jsonl$/.exec(f)?.[1] ?? 0);

function outputs(root: string, since: string | null): string[] {
  const spawn = join(root, ".spawn");
  const recent = (f: string) => since === null || statSync(f).mtime.toISOString() >= since;
  const list = (dir: string, keep: (n: string) => boolean, order: (a: string, b: string) => number) =>
    existsSync(dir) ? readdirSync(dir).filter(keep).map((n) => join(dir, n)).sort(order) : [];
  const conversations = join(spawn, "conversations");
  const tasks = join(spawn, "tasks");
  const stories = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []);
  return [
    ...stories(conversations).flatMap((s) => list(join(conversations, s), (n) => /^turn-\d+\.jsonl$/.test(n), (a, b) => turnNumber(a) - turnNumber(b))),
    ...stories(tasks).flatMap((s) => list(join(tasks, s, "run"), (n) => n.endsWith(".jsonl"), (a, b) => a.localeCompare(b))),
  ].filter(recent);
}

export function measureCost(root: string, since: string | null = null): Cost {
  const read = outputs(root, since).map(readOutput);
  const last = new Map<string, Output>();
  for (const o of read) if (o.session !== null && o.result !== null) last.set(o.session, o);
  const cost: Cost = { usd: 0, by_model: {}, sessions: last.size, unmeasured: [] };
  for (const o of last.values()) {
    cost.usd += o.result?.usd ?? 0;
    for (const [m, usd] of Object.entries(o.result?.by_model ?? {})) cost.by_model[m] = (cost.by_model[m] ?? 0) + usd;
  }
  // Sans `result` et sans `result` plus loin dans sa session : son coût n'apparaît nulle part.
  read.forEach((o, i) => {
    if (o.result !== null) return;
    const counted = o.session !== null && read.slice(i + 1).some((n) => n.session === o.session && n.result !== null);
    if (!counted) cost.unmeasured.push(relative(root, o.file).split("\\").join("/"));
  });
  return cost;
}

// Claude Code range les transcripts d'un dossier sous un nom où tout caractère non alphanumérique devient `-`.
export const encode = (path: string) => path.replace(/[^A-Za-z0-9]/g, "-");

function projectsDir(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
}

function transcripts(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return transcripts(path);
    return e.name.endsWith(".jsonl") ? [path] : [];
  });
}

const empty = (): Tokens => ({ input: 0, cache_write: 0, cache_read: 0, output: 0 });

function humanText(content: unknown): string | null {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content) && content.every((p: { type?: string }) => p.type === "text")
        ? content.map((p: { text?: string }) => p.text ?? "").join("\n")
        : null;
  // Sorties et rappels de commandes locales (`/compact`…) : écrits par Claude Code, pas par l'utilisateur.
  if (text === null || text.trimStart().startsWith("<")) return null;
  return text;
}

interface Line {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  message?: { id?: string; model?: string; content?: unknown; usage?: Record<string, number> };
}

export function measure(root: string, since: string | null = null): Metrics {
  const enc = encode(root);
  const base = projectsDir();
  const folders = existsSync(base)
    ? readdirSync(base).filter((n) => (n === enc || n.startsWith(`${enc}--claude-worktrees-`)) && statSync(join(base, n)).isDirectory())
    : [];
  const files = folders.flatMap((d) => transcripts(join(base, d)));

  const sessions = new Set<string>();
  const seen = new Set<string>();
  const interventions: Intervention[] = [];
  const tokens = empty();
  const byModel: Record<string, Tokens> = {};
  for (const f of files) {
    for (const raw of readFileSync(f, "utf8").split(/\r?\n/)) {
      if (!raw) continue;
      let l: Line;
      try {
        l = JSON.parse(raw) as Line;
      } catch {
        continue;
      }
      if (since !== null && (l.timestamp ?? "") < since) continue;
      if (l.type === "assistant" && l.message?.usage) {
        // Une réponse est écrite en plusieurs lignes qui portent le même usage : compter chaque message une fois.
        const id = l.message.id ?? `${f}:${l.timestamp}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const u = l.message.usage;
        const model = (byModel[l.message.model ?? "?"] ??= empty());
        for (const t of [tokens, model]) {
          t.input += u.input_tokens ?? 0;
          t.cache_write += u.cache_creation_input_tokens ?? 0;
          t.cache_read += u.cache_read_input_tokens ?? 0;
          t.output += u.output_tokens ?? 0;
        }
        if (l.sessionId) sessions.add(l.sessionId);
      } else if (l.type === "user" && !l.isSidechain && !l.isMeta && !l.isCompactSummary) {
        const text = humanText(l.message?.content);
        if (text !== null) interventions.push({ session: l.sessionId ?? "?", date: l.timestamp ?? "", text: text.slice(0, 200) });
      }
    }
  }

  const ledgers = join(root, ".spawn", "ledgers");
  const stories = existsSync(ledgers) ? new Set(readdirSync(ledgers).flatMap((f) => (/\.(jsonl|md)$/.test(f) ? [f.replace(/\.(jsonl|md)$/, "")] : []))) : [];
  const events = [...stories].flatMap((story) => readLedger(ledgerPath(root, story)));
  const worktrees = join(root, ".claude", "worktrees");
  return {
    since,
    sessions: sessions.size,
    transcripts: files.length,
    interventions: interventions.sort((a, b) => a.date.localeCompare(b.date)),
    tokens,
    by_model: byModel,
    cost: measureCost(root, since),
    // Une relecture finale qui demande des corrections coûte un round, comme un round de tâche.
    rounds: events.filter((e) => e.type === "round" || (e.type === "final-review" && e.verdict === "changes")).length,
    parked_tasks: events.filter((e) => e.type === "task-parked").length,
    remaining_worktrees: existsSync(worktrees) ? readdirSync(worktrees).filter((n) => statSync(join(worktrees, n)).isDirectory()) : [],
    remaining_feature_branches: git(root, ["branch", "--list", "feature/*", "--format=%(refname:short)"]).stdout.split(/\r?\n/).filter(Boolean),
  };
}
