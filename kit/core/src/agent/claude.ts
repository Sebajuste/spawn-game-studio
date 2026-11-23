// Adaptateur d'agent Claude Code : `claude -p` en flux JSON, bypass des permissions (le hook de périmètre du plugin
// tient le projet), reprise par `--resume`. Mesures lues dans les transcripts du projet et de ses worktrees.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { measure } from "../metrics.ts";
import { checkPrerequisites } from "../prerequisites.ts";
import { excerpt, summarizeTool, type AgentEvent } from "./events.ts";
import type { AgentAdapter } from "./type.ts";
import { runProcess, firstField, type Launcher } from "./process.ts";

interface Block {
  type?: string;
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

interface ClaudeLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  parent_tool_use_id?: string | null;
  result?: string;
  is_error?: boolean;
  message?: { content?: Block[]; usage?: Record<string, number> };
}

// Flux `--output-format stream-json` : init (session, modèle), messages assistant (texte, appels d'outils, usage),
// messages user (résultats d'outils), result (fin). Un message de sous-agent porte parent_tool_use_id.
export function readClaude(line: string): AgentEvent[] {
  let e: ClaudeLine;
  try {
    e = JSON.parse(line) as ClaudeLine;
  } catch {
    return [];
  }
  const subagent = e.parent_tool_use_id != null;
  if (e.type === "system" && e.subtype === "init") return [{ type: "start", session: e.session_id ?? null, model: e.model ?? null }];
  if (e.type === "result") return [{ type: "end", text: e.result ?? null, error: e.subtype === "success" && !e.is_error ? null : (e.subtype ?? "error") }];
  const evs: AgentEvent[] = [];
  for (const b of e.message?.content ?? []) {
    if (e.type === "assistant" && b.type === "text" && b.text) evs.push({ type: "text", text: b.text, subagent });
    else if (e.type === "assistant" && b.type === "tool_use" && b.name) {
      const input = b.input ?? {};
      const { summary, files } = summarizeTool(b.name, input);
      if (b.name === "Agent" || b.name === "Task") {
        evs.push({ type: "subagent", id: b.id ?? "", agent: String(input.subagent_type ?? "general"), description: String(input.description ?? summary) });
      }
      evs.push({ type: "tool", id: b.id ?? "", name: b.name, summary, files, subagent });
    } else if (e.type === "user" && b.type === "tool_result") {
      evs.push({ type: "tool-result", id: b.tool_use_id ?? "", error: b.is_error === true, excerpt: excerpt(b.content) });
    }
  }
  // L'usage d'un message de la session principale dit la place prise dans son contexte.
  const u = e.message?.usage;
  if (e.type === "assistant" && u && !subagent) {
    evs.push({ type: "usage", context: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens ?? 0 });
  }
  return evs;
}

export function claudeAdapter(o: { model?: string; run?: Launcher } = {}): AgentAdapter {
  const run = o.run ?? runProcess;
  return {
    name: "claude-code",
    async turn({ dir, message, session, output, timeoutMs, signal, env: extra }) {
      const args = [
        "-p",
        message,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        ...(session ? ["--resume", session] : []),
        ...(o.model ? ["--model", o.model] : []),
      ];
      const env = { ...process.env, ...extra };
      delete env.SPAWN_AGENT;
      const code = await run("claude", args, { cwd: dir, output, timeoutMs, env, ...(signal ? { signal } : {}) });
      return { code, session: firstField(output, "session_id") ?? session };
    },
    async delegate({ dir, agent, model, prompt, output, timeoutMs, signal, env: extra }) {
      // L'agent du plugin, comme l'outil Agent le lancerait ; le hook de périmètre du plugin vaut aussi ici.
      const args = ["-p", prompt, "--agent", `spawnstudio:${agent}`, "--model", model, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"];
      const env = { ...process.env, ...extra };
      delete env.SPAWN_AGENT;
      const code = await run("claude", args, { cwd: dir, output, timeoutMs, env, ...(signal ? { signal } : {}) });
      return { code, session: firstField(output, "session_id") };
    },
    read: readClaude,
    // Le seuil de compactage du projet (D3) : c'est lui que la jauge doit montrer, pas la fenêtre du modèle.
    async maxContext(root) {
      const path = join(root, ".claude", "settings.json");
      if (!existsSync(path)) return null;
      try {
        const env = (JSON.parse(readFileSync(path, "utf8")) as { env?: Record<string, unknown> }).env ?? {};
        const v = Number(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
        return Number.isFinite(v) && v > 0 ? v : null;
      } catch {
        return null;
      }
    },
    async check(root) {
      // Le périmètre de Claude Code est le hook du plugin : actif dans le projet et versionné, il vaut pour les worktrees.
      const checks = await checkPrerequisites(root);
      return checks.filter((c) => !c.ok).map((c) => `${c.name} : ${c.detail}${c.correction ? ` → ${c.correction}` : ""}`);
    },
    async measure({ root, since }) {
      const m = measure(root, since);
      return { sessions: m.sessions, interventions: m.interventions, tokens: m.tokens, by_model: m.by_model };
    },
  };
}
