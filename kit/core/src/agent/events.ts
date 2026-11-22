// Événements normalisés d'un tour d'agent, pour l'app : ce que chaque agent écrit à sa façon (flux JSON de Claude
// Code, événements d'OpenCode) devient la même suite. Ce qui est propre à un agent reste dans son lecteur.

export type AgentEvent =
  | { type: "start"; session: string | null; model: string | null }
  | { type: "text"; text: string; subagent: boolean }
  | { type: "tool"; id: string; name: string; summary: string; files: string[]; subagent: boolean }
  | { type: "tool-result"; id: string; error: boolean; excerpt: string }
  | { type: "subagent"; id: string; agent: string; description: string }
  | { type: "usage"; context: number; output: number }
  | { type: "end"; text: string | null; error: string | null };

const EXCERPT = 300;

// Résumé d'un appel d'outil en une ligne, et fichiers qu'il écrit (« Fichiers touchés » de l'app).
export function summarizeTool(name: string, input: Record<string, unknown>): { summary: string; files: string[] } {
  const text = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const path = text("file_path") || text("filePath") || text("notebook_path") || text("path");
  const written = /^(write|edit|multiedit|notebookedit|patch|create)$/i.test(name);
  const summary =
    text("command") ||
    text("description") ||
    path ||
    text("pattern") ||
    text("query") ||
    text("url") ||
    text("prompt").slice(0, 120) ||
    JSON.stringify(input).slice(0, 120);
  return { summary: summary.replace(/\s+/g, " ").slice(0, 200), files: written && path ? [path] : [] };
}

export function excerpt(content: unknown): string {
  if (typeof content === "string") return content.slice(0, EXCERPT);
  if (Array.isArray(content)) return content.map((c: { text?: unknown }) => (typeof c?.text === "string" ? c.text : "")).join("\n").slice(0, EXCERPT);
  return "";
}
