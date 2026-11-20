// Sélecteur de portée (Ctrl+P, ou clic sur le bloc de portée) : chercher, choisir un workspace ou un projet, ou en
// créer un. Au clavier : flèches et Entrée. En surimpression sur la coque, ou à la place du contenu quand aucune portée
// n'est ouverte.
import { useState } from "react";
import type { ProjectView, WorkspaceView } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";
import type { Route } from "../navigation/route.ts";
import { pickerRows, type PickerRow } from "./pickerRows.ts";

interface Props {
  projects: ProjectView[];
  workspaces: WorkspaceView[];
  inline: boolean;
  notice: string | null;
  onPick: (route: Route) => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onNewWorkspace: () => void;
  onClose: () => void;
}

function countText(row: PickerRow): string {
  if (row.kind === "workspace") return t(row.count === 1 ? "nav.scope.workspace.one" : "nav.scope.workspace.other", { n: row.count });
  if (row.count === 0) return t("nav.picker.nothing");
  return t(row.count === 1 ? "nav.picker.open.one" : "nav.picker.open.other", { n: row.count });
}

export function ScopePicker({ projects, workspaces, inline, notice, onPick, onNewProject, onOpenProject, onNewWorkspace, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [rank, setRank] = useState(0);
  const rows = pickerRows(projects, workspaces, search);
  const all = [...rows.workspaces, ...rows.standalone];

  const row = (r: PickerRow) => {
    const i = all.indexOf(r);
    return (
      <button key={r.key} className={`picker-row ${r.kind === "member" ? "member" : ""} ${i === rank ? "selected" : ""}`} onMouseEnter={() => setRank(i)} onClick={() => onPick(r.route)}>
        {r.kind !== "member" && <span className={`logo ${r.kind === "workspace" ? "ws" : ""}`}>{r.label.charAt(0).toUpperCase()}</span>}
        <span className="picker-label">{r.label}</span>
        <small>{countText(r)}</small>
      </button>
    );
  };

  const body = (
    <div className={`scope-picker ${inline ? "inline" : ""}`} role="dialog" aria-label={t("nav.picker.title")}>
      {notice && <p className="alert">{notice}</p>}
      <input
        autoFocus
        value={search}
        placeholder={t("nav.picker.search")}
        onChange={(e) => {
          setSearch(e.target.value);
          setRank(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setRank((r) => Math.min(r + 1, all.length - 1));
          else if (e.key === "ArrowUp") setRank((r) => Math.max(r - 1, 0));
          else if (e.key === "Enter" && all[rank]) onPick(all[rank].route);
          else return;
          e.preventDefault();
        }}
      />
      {rows.workspaces.length > 0 && <h5>{t("nav.picker.workspaces")}</h5>}
      {rows.workspaces.map(row)}
      {rows.standalone.length > 0 && <h5>{t("nav.picker.standalone")}</h5>}
      {rows.standalone.map(row)}
      {all.length === 0 && <p className="muted">{t("nav.picker.none")}</p>}
      <hr />
      <button className="picker-row" onClick={onNewProject}>
        {t("nav.picker.newProject")}
        <small>Ctrl+N</small>
      </button>
      <button className="picker-row" onClick={onOpenProject}>
        {t("nav.picker.openProject")}
        <small>Ctrl+O</small>
      </button>
      <button className="picker-row" onClick={onNewWorkspace}>
        {t("nav.picker.newWorkspace")}
      </button>
    </div>
  );

  if (inline) return body;
  return (
    <div className="picker-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {body}
    </div>
  );
}
