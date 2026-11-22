// Étapes de la story, avec leurs tâches et leur durée.
import type { ProgressStep } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";

const ICONS: Record<ProgressStep["state"], string> = { done: "✓", current: "…", pending: "" };

// Étape rendue par l'outil que l'app ne connaît pas : dite telle quelle, à la place de l'étape en cours (après la
// dernière étape faite) ; l'app ne devine jamais une étape.
export function Steps({ steps, unknown }: { steps: ProgressStep[]; unknown: string | null }) {
  const firstPending = steps.findIndex((e) => e.state !== "done");
  const at = firstPending === -1 ? steps.length : firstPending;
  const rows: (ProgressStep | "unknown")[] = unknown ? [...steps.slice(0, at), "unknown", ...steps.slice(at)] : steps;
  return (
    <ol className="steps">
      {rows.map((e) =>
        e === "unknown" ? (
          <li key="unknown" className="current">
            <span className="icon current">…</span>
            <strong>{t("story.unknownStep", { step: unknown ?? "" })}</strong>
            <span />
          </li>
        ) : (
        <li key={e.id} className={e.state}>
          <span className={`icon ${e.state}`}>{e.id === "tasks" && e.state === "current" && e.detail ? e.detail.split("/")[0] : ICONS[e.state]}</span>
          <span>
            <strong>{e.title}</strong>
            {e.detail && <span className="muted"> · {e.detail}</span>}
            {e.tasks && e.tasks.length > 0 && (
              <ul className="tasks">
                {e.tasks.map((task) => (
                  <li key={task.number} className={task.state}>
                    {task.state === "done" ? "✓" : task.state === "parked" ? "⏸" : task.state === "current" ? "●" : "○"} {task.title}
                    {task.rounds > 0 && <span className="muted">{t(task.rounds > 1 ? "story.corrections.other" : "story.corrections.one", { count: task.rounds })}</span>}
                    {task.state === "parked" && <span className="muted">{t("story.parked")}</span>}
                  </li>
                ))}
              </ul>
            )}
          </span>
          <span className="muted small-text">{duration(e.start, e.end)}</span>
        </li>
        ),
      )}
    </ol>
  );
}

function duration(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  const s = (Date.parse(end) - Date.parse(start)) / 1000;
  if (s < 60) return `${Math.max(1, Math.round(s))} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
