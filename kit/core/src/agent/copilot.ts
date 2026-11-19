// Adaptateur d'agent GitHub Copilot CLI : `copilot -p` en JSONL, outils autorisés d'office (non interactif, il ne
// pourrait pas demander), reprise par `--resume <session>`. Le périmètre n'est PAS le hook du kit : on ne passe pas
// `--allow-all-paths`, donc Copilot reste borné à son dossier de travail (le worktree du fil) par ses propres règles.
// Les mesures (jetons, interventions) ne sont pas encore lues : `measure` rend null plutôt qu'un chiffre faux.
import { excerpt, summarizeTool, type AgentEvent } from "./events.ts";
import type { AgentAdapter } from "./type.ts";
import { runProcess, firstField, type Launcher } from "./process.ts";
import { run as runSync } from "../prerequisites.ts";

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

export function copilotAdapter(o: { model?: string; run?: Launcher } = {}): AgentAdapter {
  const run = o.run ?? runProcess;
  return {
    name: "copilot",
    async turn({ dir, message, session, output, timeoutMs, signal, env: extra }) {
      const args = ["-p", message, "--output-format", "json", "--allow-all-tools", "--no-ask-user", ...(session ? ["--resume", session] : []), ...(o.model ? ["--model", o.model] : [])];
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
    async measure() {
      return null;
    },
  };
}
