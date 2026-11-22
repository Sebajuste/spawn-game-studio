// Lieu « Projets » d'un workspace (docs/navigation.md §4) : ses projets avec leur état. Ajouter, retirer, supprimer le
// workspace : dans ses Réglages (« Gérer les projets… », docs/reglages.md §3).
import type { ProjectView, StoryView, WorkspaceView } from "../shared/api.ts";
import { PlaceHeader } from "../shared/PlaceHeader.tsx";
import { t } from "../i18n/i18n.ts";
import { projectState } from "./projectState.ts";
import "./workspace.css";

interface Props {
  workspace: WorkspaceView;
  projects: ProjectView[];
  backlogs: ReadonlyMap<string, StoryView[] | null>;
  onOpen: (project: string) => void;
  onManage: () => void;
}

export function WorkspaceProjects({ workspace, projects, backlogs, onOpen, onManage }: Props) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const n = workspace.projects.length;
  return (
    <>
      <PlaceHeader title={t("nav.place.projects")} subtitle={t(n === 1 ? "nav.projects.subtitle.one" : "nav.projects.subtitle.other", { n, name: workspace.name })}>
        <button className="btn" onClick={onManage}>
          {t("nav.projects.manage")}
        </button>
      </PlaceHeader>
      <div className="scroll">
        {n === 0 && <p className="muted">{t("nav.projects.none")}</p>}
        {workspace.projects.map((id) => {
          const p = byId.get(id);
          const state = projectState(backlogs.get(id));
          return (
            <div key={id} className="project-row clickable" onClick={() => onOpen(id)} title={p?.root}>
              <span className="logo">{(p?.name ?? id).charAt(0).toUpperCase()}</span>
              <span className="project-row-text">
                <strong>{p?.name ?? id}</strong>
                <small className="muted">{p ? (p.problem ?? `${p.engine ?? ""} ${p.version ?? ""}`.trim()) : ""}</small>
              </span>
              <span className={`state ${state.tone}`}>{state.text}</span>
              <button
                className="btn small"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(id);
                }}
              >
                {t("nav.projects.open")}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
