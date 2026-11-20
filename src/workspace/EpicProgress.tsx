// Avancement d'un epic : « n / total fusionnées » et sa barre.
import type { EpicView } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";

export function EpicProgress({ epic }: { epic: EpicView }) {
  const total = epic.stories.length;
  return (
    <div className="epic-progress">
      <span className="muted">{total === 0 ? t("workspace.epic.empty") : t("workspace.epic.progress", { done: epic.merged, total })}</span>
      <div className="epic-bar">
        <b style={{ width: total === 0 ? "0%" : `${Math.round((epic.merged / total) * 100)}%` }} />
      </div>
    </div>
  );
}
