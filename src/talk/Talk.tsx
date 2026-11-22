// La conversation d'une portée (docs/conversation.md) : le fil, ce que l'agent fait en direct, et la saisie. On y dit ce
// qu'on veut ; l'agent répond, et ce qu'il fait créer au service s'affiche sous sa réponse, vérifié, avec un lien.
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n/i18n.ts";
import { label, Refusal, useAction } from "../shared/action.ts";
import type { Api, TalkScope } from "../shared/api.ts";
import { Activity } from "../story/conversation/Activity.tsx";
import { TalkTurn } from "./TalkTurn.tsx";
import { useTalk } from "./useTalk.ts";
import "./talk.css";

interface Props {
  api: Api;
  events: EventSource | null;
  scope: TalkScope;
  id: string;
  showActivity: boolean;
  // Change à chaque Ctrl+J : le curseur revient dans la saisie.
  focus: number;
  projectName: ((id: string) => string) | null;
  onOpenStory: (project: string, story: string) => void;
  onOpenEpic: (epic: string) => void;
}

export function Talk({ api, events, scope, id, showActivity, focus, projectName, onOpenStory, onOpenEpic }: Props) {
  const act = useAction();
  const { view, error, send, stop } = useTalk(api, events, scope, id, act);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus > 0) input.current?.focus();
  }, [focus]);
  // Le fil suit la fin, comme une messagerie.
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [view]);

  const running = view?.running === true;
  const submit = async () => {
    const text = message.trim();
    if (!text || running) return;
    if (await send(text)) setMessage("");
  };
  const last = view?.turns[view.turns.length - 1];

  return (
    <section className="talk">
      <div className="talk-thread" ref={thread}>
        {view && view.turns.length === 0 && <p className="muted talk-empty">{t(scope === "project" ? "talk.empty.project" : "talk.empty.workspace")}</p>}
        {view?.turns.map((turn) => <TalkTurn key={turn.n} turn={turn} projectName={projectName} onOpenStory={onOpenStory} onOpenEpic={onOpenEpic} />)}
      </div>
      {running && showActivity && <Activity turn={last} />}
      {error && <div className="error-banner">{error}</div>}
      <form
        className="talk-input"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={input}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={running ? t("talk.placeholderRunning") : t("talk.placeholder")}
        />
        {running ? (
          <button type="button" className="btn" disabled={act.pending !== null} onClick={() => void stop()}>
            {label(act, "stop", t("talk.stop"), t("talk.stopping"))}
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={!message.trim() || act.pending !== null}>
            {label(act, "send", t("talk.send"), t("talk.sending"))}
          </button>
        )}
      </form>
      <Refusal action={act} k="send" />
      <Refusal action={act} k="stop" />
    </section>
  );
}
