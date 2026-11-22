// Ce qui attend une réponse de l'utilisateur : la question de l'agent, ou la reprise d'un tour interrompu.
import { useState } from "react";
import type { StoryDetail } from "../shared/api.ts";
import { label, Refusal, type Action } from "../shared/action.ts";
import { t } from "../i18n/i18n.ts";

export function Answer({ detail, act, onAnswer, onResume }: { detail: StoryDetail; act: Action; onAnswer: (m: string) => Promise<boolean>; onResume: () => void }) {
  const [text, setText] = useState("");
  const w = detail.waiting;
  if (w?.reason === "interrupted") {
    return (
      <section className="card waiting">
        <h2>{t("story.interrupted.title")}</h2>
        <p>{t("story.interrupted.body")}</p>
        <button className="btn primary" disabled={act.pending !== null} onClick={onResume}>
          {label(act, "resume", t("story.resume"), t("story.resuming"))}
        </button>
        <Refusal action={act} k="resume" />
      </section>
    );
  }
  return (
    <section className="card waiting">
      <h2>{w?.reason === "question" ? t("story.blocked.question") : t("story.blocked.stopped")}</h2>
      {w?.text ? <div className="agent-text">{w.text}</div> : <p className="muted">{t("story.blocked.nothing")}</p>}
      <form
        className="reply"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void onAnswer(text.trim()).then((ok) => ok && setText(""));
        }}
      >
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={w?.reason === "question" ? t("story.answer.question") : t("story.answer.other")} autoFocus />
        <button type="submit" className="btn primary" disabled={!text.trim() || act.pending !== null}>
          {label(act, "answer", t("story.answer"), t("story.sending"))}
        </button>
        <Refusal action={act} k="answer" />
      </form>
    </section>
  );
}
