// Adaptateur d'agent GitHub Copilot CLI : `copilot -p` en JSONL, outils autorisés d'office (non interactif, il ne
// pourrait pas demander), reprise par `--resume <session>`. Le périmètre n'est PAS le hook du kit seul : Copilot lit
// aussi les hooks du plugin (`--plugin-dir`), mais `--allow-all-paths` lève ses propres bornes de dossier.
// Mesures : jetons et interventions lus dans les sorties des tours ; `maxContext` reste inconnu (null) plutôt qu'un
// chiffre faux, Copilot compactant lui-même sans dire son seuil.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { excerpt, summarizeTool, type AgentEvent } from "./events.ts";
import type { AgentAdapter, AgentMetrics } from "./type.ts";
import type { Tokens } from "../metrics.ts";
import { runProcess, firstField, type Launcher } from "./process.ts";
import { run as runSync } from "../prerequisites.ts";
import { KIT_CORE } from "../location.ts";

interface ToolRequest {
  toolCallId?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

interface CopilotLine {
  type?: string;
  data?: {
    sessionId?: string;
    content?: string;
    toolRequests?: ToolRequest[];
    toolCallId?: string;
    success?: boolean;
    result?: { content?: unknown };
    toolTelemetry?: { metrics?: { context_current_tokens?: number } };
  };
  exitCode?: number;
  sessionId?: string;
}

// Flux `--output-format json` : session.start (session), assistant.message (texte, appels d'outils),
// tool.execution_complete (résultat, taille du contexte), result (fin, code de sortie). Les événements
// éphémères (deltas, statuts MCP, usage) sont ignorés : le message complet suffit.
export function readCopilot(line: string): AgentEvent[] {
  let e: CopilotLine;
  try {
    e = JSON.parse(line) as CopilotLine;
  } catch {
    return [];
  }
  const d = e.data ?? {};
  if (e.type === "session.start") return [{ type: "start", session: d.sessionId ?? null, model: null }];
  if (e.type === "result") return [{ type: "end", text: null, error: e.exitCode === 0 || e.exitCode === undefined ? null : `exit-${String(e.exitCode)}` }];
  const evs: AgentEvent[] = [];
  if (e.type === "assistant.message") {
    if (d.content) evs.push({ type: "text", text: d.content, subagent: false });
    for (const t of d.toolRequests ?? []) {
      if (!t.name) continue;
      const input = t.arguments ?? {};
      const { summary, files } = summarizeTool(t.name, input);
      if (t.name === "task") evs.push({ type: "subagent", id: t.toolCallId ?? "", agent: String(input.agent_type ?? "general"), description: String(input.description ?? summary) });
      evs.push({ type: "tool", id: t.toolCallId ?? "", name: t.name, summary, files, subagent: false });
    }
  } else if (e.type === "tool.execution_complete") {
    evs.push({ type: "tool-result", id: d.toolCallId ?? "", error: d.success === false, excerpt: excerpt(d.result?.content) });
    const tokens = d.toolTelemetry?.metrics?.context_current_tokens;
    if (typeof tokens === "number") evs.push({ type: "usage", context: tokens, output: 0 });
  }
  return evs;
}

interface ModelUsage {
  modelId?: string;
  metrics?: { tokenDetails?: Record<string, { tokenCount?: number } | undefined> };
}

interface Row {
  type?: string;
  timestamp?: string;
  agentId?: string;
  sessionId?: string;
  data?: { content?: string; providerModelMetrics?: ModelUsage[]; accountingSnapshot?: { sessionStartTime?: string } };
}

const emptyTokens = (): Tokens => ({ input: 0, cache_write: 0, cache_read: 0, output: 0 });

// Les totaux de `session.usage_checkpoint` sont ceux de la session entière, sous-agents compris, et un tour repris par
// `--resume` repart de ceux du tour précédent (vérifié : 173 appels au tour 1, 230 au tour 2 pour 57 messages). Seul le
// dernier point de chaque session compte : les additionner d'un tour à l'autre compterait deux fois.
// `input` est la part non mise en cache (`tokenDetails.input`) ; `inputTokens` y ajoute les lectures et écritures de cache.
export function measureCopilot(turns: string[]): AgentMetrics {
  const last = new Map<string, Row>();
  const interventions: AgentMetrics["interventions"] = [];
  for (const text of turns) {
    let session = "?";
    const rows: Row[] = [];
    for (const line of text.split("\n")) {
      try {
        rows.push(JSON.parse(line) as Row);
      } catch {
        // ligne vide ou tronquée par un arrêt brutal
      }
    }
    session = rows.find((r) => r.type === "result")?.sessionId ?? session;
    for (const r of rows) {
      // Un message « user » d'un sous-agent (agentId) est la consigne de son parent, pas une intervention.
      if (r.type === "user.message" && !r.agentId) interventions.push({ session, date: r.timestamp ?? "", text: (r.data?.content ?? "").slice(0, 200) });
      if (r.type === "session.usage_checkpoint") last.set(session, r);
    }
  }
  const tokens = emptyTokens();
  const byModel: Record<string, Tokens> = {};
  for (const row of last.values()) {
    for (const m of row.data?.providerModelMetrics ?? []) {
      const d = m.metrics?.tokenDetails ?? {};
      const t: Tokens = { input: d.input?.tokenCount ?? 0, cache_write: d.cache_write?.tokenCount ?? 0, cache_read: d.cache_read?.tokenCount ?? 0, output: d.output?.tokenCount ?? 0 };
      const into = (byModel[m.modelId ?? "?"] ??= emptyTokens());
      for (const k of ["input", "cache_write", "cache_read", "output"] as const) {
        into[k] += t[k];
        tokens[k] += t[k];
      }
    }
  }
  return { sessions: last.size, interventions, tokens, by_model: byModel };
}

export function copilotAdapter(o: { model?: string; run?: Launcher } = {}): AgentAdapter {
  const run = o.run ?? runProcess;
  return {
    name: "copilot",
    async turn({ dir, message, session, output, timeoutMs, signal, env: extra }) {
      // Le CLI du kit et `.spawn/` vivent hors du worktree : sans --allow-all-paths, Copilot refuse en non interactif
      // toute commande ou lecture qui y touche, même avec --allow-all-tools (« permission denied » vu en essai réel).
      const args = ["-p", message, "--output-format", "json", "--allow-all-tools", "--allow-all-paths", "--no-ask-user", "--plugin-dir", KIT_CORE, ...(session ? ["--resume", session] : []), ...(o.model ? ["--model", o.model] : [])];
      const env = { ...process.env, ...extra, SPAWN_AGENT: "copilot" };
      const code = await run("copilot", args, { cwd: dir, output, timeoutMs, env, ...(signal ? { signal } : {}) });
      return { code, session: firstField(output, "sessionId") ?? session };
    },
    read: readCopilot,
    async maxContext() {
      return null;
    },
    async check() {
      const r = runSync("copilot", ["--version"], process.cwd());
      return r.code === 0 ? [] : ["copilot : absent → installer GitHub Copilot CLI (https://docs.github.com/copilot/how-tos/copilot-cli) puis `copilot login`"];
    },
    // Les traces sont les sorties des tours (`turn-N.jsonl`), à côté du dossier d'exports du pilote.
    async measure({ exportsDir }) {
      const dir = dirname(exportsDir);
      if (!existsSync(dir)) return null;
      const turns = readdirSync(dir)
        .filter((f) => /^turn-\d+\.jsonl$/.test(f))
        .sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10))
        .map((f) => readFileSync(join(dir, f), "utf8"));
      const m = measureCopilot(turns);
      return m.sessions > 0 ? m : null;
    },
  };
}
