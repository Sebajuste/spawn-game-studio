// Un tour de conversation : le message envoyé, puis ce que l'agent a dit et fait.
import type { ConversationTurn } from "../../shared/api.ts";
import { t } from "../../i18n/i18n.ts";

export function Turn({ turn }: { turn: ConversationTurn }) {
  const results = new Map(turn.events.flatMap((e) => (e.type === "tool-result" ? [[e.id, e] as const] : [])));
  return (
    <div className="turn">
      {turn.message && <div className="bubble-me">{turn.message}</div>}
      {turn.refused.map((r, i) => (
        <div key={i} className="error-banner">
          {t("conversation.turnRefused", { reason: r })}
        </div>
      ))}
      {turn.events.map((e, i) => {
        if (e.type === "text") return <div key={i} className={`bubble-agent ${e.subagent ? "subagent" : ""}`}>{e.text}</div>;
        if (e.type === "subagent") return <div key={i} className="tool-line">{t("conversation.subagent")} <strong>{e.agent}</strong> : {e.description}</div>;
        if (e.type === "tool" && e.name !== "Agent" && e.name !== "Task" && e.name !== "subagent") {
          const r = results.get(e.id);
          return (
            <div key={i} className={`tool-line ${e.subagent ? "subagent" : ""} ${r?.error ? "error" : ""}`} title={r?.excerpt}>
              {r?.error ? "✗" : "▸"} {e.name} <span className="muted">{e.summary}</span>
            </div>
          );
        }
        if (e.type === "end" && e.error) return <div key={i} className="error-banner">{t("conversation.endError", { error: e.error })}</div>;
        return null;
      })}
      {turn.stopped && <div className="muted">{t("conversation.stopped")}</div>}
      {turn.interrupted && <div className="muted">{t("conversation.cut")}</div>}
    </div>
  );
}
