// Les stories d'un epic en voies, une par projet. Une story commencée s'ouvre dans son projet, avec le workspace pour
// parent ; une story pas encore commencée n'a rien à montrer.
import type { EpicStoryView, EpicView } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";
import { megas, refKey, stateClass, stateLabel } from "./epicState.ts";

export function EpicLanes({ epic, projectName, onOpen }: { epic: EpicView; projectName: (id: string) => string; onOpen: (s: EpicStoryView) => void }) {
  const lanes = [...new Set(epic.stories.map((s) => s.project))];
  return (
    <div className="epic-lanes">
      {lanes.map((p) => (
        <div key={p} className="epic-lane">
          <h4>{projectName(p)}</h4>
          {epic.stories
            .filter((s) => s.project === p)
            .map((s) => {
              const started = s.state !== "not-started";
              return (
                <div key={refKey(s)} className={`epic-story ${stateClass(s)} ${started ? "clickable" : ""}`} onClick={started ? () => onOpen(s) : undefined}>
                  {s.story}
                  <small>
                    {stateLabel(s.state)}
                    {s.waiting_for.length > 0 && ` · ${t("workspace.story.waiting", { refs: s.waiting_for.map((d) => `${projectName(d.project)}/${d.story}`).join(", ") })}`}
                  </small>
                  {s.metrics && <small>{t("workspace.metrics.story", { min: s.metrics.duration_min, n: s.metrics.interventions, cache: megas(s.metrics.cache_read) })}</small>}
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}
