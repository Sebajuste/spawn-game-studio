// Les filtres du Backlog, avec leur compte : ouvertes, livrées, fermées.
import { t } from "../i18n/i18n.ts";
import type { BacklogFilter } from "./backlogFilter.ts";

const LABELS = { open: "nav.backlog.open", delivered: "nav.backlog.delivered", closed: "nav.backlog.closed" } as const;

export function BacklogFilters({ value, counts, onChange }: { value: BacklogFilter; counts: Record<BacklogFilter, number>; onChange: (f: BacklogFilter) => void }) {
  return (
    <div className="chips" role="tablist">
      {(Object.keys(LABELS) as BacklogFilter[]).map((f) => (
        <button key={f} role="tab" aria-selected={value === f} className={`chip ${value === f ? "on" : ""}`} onClick={() => onChange(f)}>
          {t(LABELS[f], { n: counts[f] })}
        </button>
      ))}
    </div>
  );
}
