// Lieu « Projets » d'un workspace (docs/navigation.md §4) : ses projets avec leur état, l'ajout d'un projet connu, et la
// suppression du workspace (les projets et leurs stories ne sont pas touchés).
import { useState } from "react";
import type { Api, ProjectView, StoryView, WorkspaceView } from "../shared/api.ts";
import { PlaceHeader } from "../shared/PlaceHeader.tsx";
import { t } from "../i18n/i18n.ts";
import { projectState } from "./projectState.ts";
import "./workspace.css";

interface Props {
  api: Api;
  workspace: WorkspaceView;
  projects: ProjectView[];
  backlogs: ReadonlyMap<string, StoryView[] | null>;
  onOpen: (project: string) => void;
  onChanged: () => void;
  onDeleted: () => void;
  onError: (m: string) => void;
}

export function WorkspaceProjects({ api, workspace, projects, backlogs, onOpen, onChanged, onDeleted, onError }: Props) {
  const [adding, setAdding] = useState("");
  const byId = new Map(projects.map((p) => [p.id, p]));
  const addable = projects.filter((p) => !workspace.projects.includes(p.id));
  const base = `/api/workspaces/${encodeURIComponent(workspace.id)}`;
  const n = workspace.projects.length;

  const add = (project: string) => void api.call("POST", `${base}/projects`, { project }).then(onChanged, (e: Error) => onError(e.message));
  const remove = () => {
    if (window.confirm(t("workspace.deleteConfirm", { name: workspace.name }))) void api.call("DELETE", base).then(onDeleted, (e: Error) => onError(e.message));
  };

  return (
    <>
      <PlaceHeader title={t("nav.place.projects")} subtitle={t(n === 1 ? "nav.projects.subtitle.one" : "nav.projects.subtitle.other", { n, name: workspace.name })}>
        {addable.length > 0 && (
          <select
            value={adding}
            aria-label={t("nav.projects.add")}
            onChange={(e) => {
              const id = e.target.value;
              setAdding("");
              if (id) add(id);
            }}
          >
            <option value="">{t("nav.projects.add")}</option>
            {addable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
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
        <div className="danger-zone">
          <button className="btn small danger" onClick={remove}>
            {t("workspace.delete")}
          </button>
        </div>
      </div>
    </>
  );
}
