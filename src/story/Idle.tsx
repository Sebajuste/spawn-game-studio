import type { StoryDetail } from "../shared/api.ts";
import { label, Refusal, type Action } from "../shared/action.ts";
import { t } from "../i18n/i18n.ts";

// Dernière phrase du dernier message de l'agent : ce qu'il a dit avant de s'arrêter.
function lastSentence(text: string | null): string {
  const parts = (text ?? "").trim().split(/(?<=[.!?…])\s+|\n+/).filter(Boolean);
  return parts.at(-1)?.slice(0, 200) ?? t("story.noSaid");
}

// Sans tour en cours, jamais de libellé d'activité : ce qui attend l'utilisateur, ou l'état de repos.
export function Idle({ detail, act, onResume }: { detail: StoryDetail; act: Action; onResume: () => void }) {
  const w = detail.waiting;
  if (!w) return null;
  if (w.reason === "paused" || w.reason === "stopped") {
    return (
      <div className="banner grey">
        <span>{w.reason === "paused" ? t("story.idle.paused") : t("story.idle.stopped", { text: lastSentence(w.text) })}</span>
        <button className="btn small primary" disabled={act.pending !== null} onClick={onResume}>
          {label(act, "resume", t("story.resume"), t("story.resuming"))}
        </button>
        <Refusal action={act} k="resume" />
      </div>
    );
  }
  const what = w.reason === "spec-approval" ? t("story.idle.specApproval") : w.reason === "interrupted" ? t("story.idle.interrupted") : (w.text ?? t("story.idle.decision")).split("\n")[0]?.slice(0, 160) ?? "";
  return <div className="banner blue">{t("story.idle.yourTurn", { what })}</div>;
}
