// Story en attente d'une place (docs/reglages.md §3.2) : rien à faire, elle démarre seule ; on voit qui tient les places,
// on peut ouvrir la charge de la machine ou la retirer de la file (ses messages restent).
import type { LoadView, StoryDetail } from "../shared/api.ts";
import { label, Refusal, type Action } from "../shared/action.ts";
import { t } from "../i18n/i18n.ts";

interface Props {
  detail: StoryDetail;
  machine: LoadView | null;
  act: Action;
  onLeave: () => void;
  onSettings: (() => void) | undefined;
}

export function Place({ detail, machine, act, onLeave, onSettings }: Props) {
  if (detail.place === null) return null;
  const name = (id: string) => machine?.projects.find((p) => p.id === id)?.name ?? id;
  const holders = (machine?.running ?? []).map((r) => `${name(r.project)} › ${r.story}`).join(", ");
  return (
    <div className="banner grey place">
      <span>
        <strong>{t("story.place.title")}</strong>
        <br />
        {t("story.place.body", { max: machine?.stories ?? "…", holders: holders || "…" })}
      </span>
      <span className="place-actions">
        {onSettings && (
          <button className="btn small" onClick={onSettings}>
            {t("story.place.settings")}
          </button>
        )}
        <button className="btn small" disabled={act.pending !== null} onClick={onLeave}>
          {label(act, "leave", t("story.place.leave"), t("story.place.leaving"))}
        </button>
        <Refusal action={act} k="leave" />
      </span>
    </div>
  );
}
