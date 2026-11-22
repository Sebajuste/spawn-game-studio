// Les projets d'un workspace, dans ses réglages : chacun avec « Retirer » (le projet reste dans Spawn), puis les trois
// façons d'en ajouter un (un projet connu, un dossier existant à adopter, un nouveau projet).
import { useState } from "react";
import type { Api, ProjectView, WorkspaceView } from "../shared/api.ts";
import { Refusal, useAction } from "../shared/action.ts";
import { t } from "../i18n/i18n.ts";

interface Props {
  api: Api;
  workspace: WorkspaceView;
  projects: ProjectView[];
  onChanged: () => Promise<void>;
  onAdopt: () => void;
  onNewProject: () => void;
}

export function WorkspaceMembers({ api, workspace, projects, onChanged, onAdopt, onNewProject }: Props) {
  const act = useAction();
  const [adding, setAdding] = useState("");
  const byId = new Map(projects.map((p) => [p.id, p]));
  const known = projects.filter((p) => !workspace.projects.includes(p.id));
  const base = `/api/workspaces/${encodeURIComponent(workspace.id)}`;
  const busy = act.pending !== null;

  const remove = (id: string) =>
    act.run(`remove:${id}`, async () => {
      await api.call("DELETE", `${base}/projects/${encodeURIComponent(id)}`);
      await onChanged();
    });
  const add = (id: string) =>
    act.run("add", async () => {
      await api.call("POST", `${base}/projects`, { project: id });
      await onChanged();
    });

  return (
    <>
      <h4>{t("settings.workspace.projects")}</h4>
      {workspace.projects.length === 0 && <p className="muted">{t("nav.projects.none")}</p>}
      {workspace.projects.map((id) => {
        const p = byId.get(id);
        return (
          <div key={id} className="setting-line">
            <span className="logo">{(p?.name ?? id).charAt(0).toUpperCase()}</span>
            <span className="setting-line-text">
              <strong>{p?.name ?? id}</strong>
              <small>{p ? [p.root, [p.engine, p.version].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : ""}</small>
              <Refusal action={act} k={`remove:${id}`} />
            </span>
            <button className="btn small" disabled={busy} onClick={() => void remove(id)}>
              {t("settings.workspace.remove")}
            </button>
          </div>
        );
      })}
      <div className="actions setting-add">
        {known.length > 0 && (
          <select
            value={adding}
            disabled={busy}
            aria-label={t("settings.workspace.addKnown")}
            onChange={(e) => {
              const id = e.target.value;
              setAdding("");
              if (id) void add(id);
            }}
          >
            <option value="">{t("settings.workspace.addKnown")}</option>
            {known.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn" onClick={onAdopt}>
          {t("settings.workspace.addExisting")}
        </button>
        <button className="btn" onClick={onNewProject}>
          {t("settings.workspace.addNew")}
        </button>
        <Refusal action={act} k="add" />
      </div>
    </>
  );
}
