import type { AgentEvent, ConversationTurn } from "../../shared/api.ts";
import { t } from "../../i18n/i18n.ts";

// Ce que l'agent fait maintenant : les outils sans résultat, les sous-agents en cours.
export function Activity({ turn }: { turn: ConversationTurn | undefined }) {
  const evs = turn?.events ?? [];
  const done = new Set(evs.flatMap((e) => (e.type === "tool-result" ? [e.id] : [])));
  const subagents = evs.filter((e): e is Extract<AgentEvent, { type: "subagent" }> => e.type === "subagent" && !done.has(e.id));
  const tool = [...evs].reverse().find((e): e is Extract<AgentEvent, { type: "tool" }> => e.type === "tool" && !done.has(e.id) && e.name !== "Agent" && e.name !== "Task" && e.name !== "subagent");
  return (
    <div className="activity">
      <span className="live-dot" />
      {tool ? (
        <span>
          {tool.name} <span className="muted">{tool.summary}</span>
        </span>
      ) : (
        <span className="muted">{t("conversation.thinking")}</span>
      )}
      {subagents.length > 0 && <span className="muted"> · {t("conversation.subagents", { count: subagents.length })} : {subagents.map((s) => s.agent).join(", ")}</span>}
    </div>
  );
}
