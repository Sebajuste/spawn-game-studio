import { useEffect, useState } from "react";
import type { Api, StoryDetail } from "../shared/api.ts";
import { label, Refusal, type Action } from "../shared/action.ts";
import { t } from "../i18n/i18n.ts";

// La seule question de la story : la spec proposée, à valider telle quelle ou à faire corriger.
export function ApproveSpec({ api, project, detail, act, onApprove, onAnswer }: { api: Api; project: string; detail: StoryDetail; act: Action; onApprove: () => Promise<boolean>; onAnswer: (m: string) => Promise<boolean> }) {
  const [spec, setSpec] = useState<string | null>(null);
  const [text, setText] = useState("");
  const path = detail.waiting?.spec ?? null;
  useEffect(() => {
    if (!path) return;
    api
      .text(project, path)
      .then(setSpec)
      .catch((e: Error) => setSpec(t("story.spec.unreadable", { message: e.message })));
  }, [api, project, path]);
  return (
    <section className="card waiting">
      <h2>{t("story.spec.title")}</h2>
      <p className="muted small-text">{t("story.spec.only")}</p>
      <div className="agent-text">{spec ?? "…"}</div>
      <div className="actions">
        <button className="btn green" disabled={act.pending !== null} onClick={() => void onApprove()}>
          {act.pending === "approve" ? t("story.approving") : t("story.spec.approve")}
        </button>
        <Refusal action={act} k="approve" />
      </div>
      <form
        className="reply"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void onAnswer(text.trim()).then((ok) => ok && setText(""));
        }}
      >
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("story.spec.placeholder")} />
        <button type="submit" className="btn" disabled={!text.trim() || act.pending !== null}>
          {label(act, "changes", t("story.requestChanges"), t("story.sending"))}
        </button>
        <Refusal action={act} k="changes" />
      </form>
    </section>
  );
}
