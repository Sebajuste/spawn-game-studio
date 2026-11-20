// Un epic dans la liste des Epics : son nom, son avancement ; un clic ouvre sa page.
import type { EpicView } from "../shared/api.ts";
import { EpicProgress } from "./EpicProgress.tsx";

export function EpicSummary({ epic, onOpen }: { epic: EpicView; onOpen: () => void }) {
  return (
    <section className="card epic clickable" onClick={onOpen}>
      <header className="epic-head">
        <h2>
          <span className="muted">{epic.id}</span> {epic.title}
        </h2>
      </header>
      <EpicProgress epic={epic} />
    </section>
  );
}
