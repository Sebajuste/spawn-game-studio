// Un tour de la conversation de portée, en bulles : le message de l'utilisateur, ce que l'agent répond (sans ses blocs
// d'action), puis ce que le service a créé. Les outils de l'agent ne sont montrés qu'en direct (ligne d'activité).
import { t } from "../i18n/i18n.ts";
import type { TalkTurn as Turn } from "../shared/api.ts";
import { ActionResult } from "./ActionResult.tsx";
import { withoutActions } from "./strip.ts";

interface Props {
  turn: Turn;
  projectName: ((id: string) => string) | null;
  onOpenStory: (project: string, story: string) => void;
  onOpenEpic: (epic: string) => void;
}

export function TalkTurn({ turn, projectName, onOpenStory, onOpenEpic }: Props) {
  return (
    <>
      {turn.message && <div className="talk-me">{turn.message}</div>}
      {turn.refused.map((r, i) => (
        <div key={`r${i}`} className="error-banner">
          {t("conversation.turnRefused", { reason: r })}
        </div>
      ))}
      {turn.events.map((e, i) => {
        if (e.type === "text" && !e.subagent) {
          const text = withoutActions(e.text);
          return text ? (
            <div key={i} className="talk-agent">
              {text}
            </div>
          ) : null;
        }
        if (e.type === "end" && e.error) return <div key={i} className="error-banner">{t("conversation.endError", { error: e.error })}</div>;
        return null;
      })}
      {turn.actions.map((a, i) => (
        <ActionResult key={`a${i}`} result={a} projectName={projectName} onOpenStory={onOpenStory} onOpenEpic={onOpenEpic} />
      ))}
      {turn.stopped && <div className="muted talk-note">{t("conversation.stopped")}</div>}
      {turn.interrupted && <div className="muted talk-note">{t("conversation.cut")}</div>}
    </>
  );
}
