// Nouveau workspace : un nom et les projets qu'il regroupe (un projet peut être dans plusieurs workspaces).
import { useRef, useState } from "react";
import type { Api, ProjectView, WorkspaceView } from "../shared/api.ts";
import { Dialog } from "../shared/Dialog.tsx";
import { t } from "../i18n/i18n.ts";
import { useSubmit } from "./useSubmit.ts";

export function NewWorkspaceDialog({ api, projects, onClose, onCreated }: { api: Api; projects: ProjectView[]; onClose: () => void; onCreated: (w: WorkspaceView) => void }) {
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const created = useRef<WorkspaceView | null>(null);
  const { pending, error, submit } = useSubmit(
    async () => {
      created.current = await api.call<WorkspaceView>("POST", "/api/workspaces", { name: name.trim(), projects: chosen });
    },
    () => created.current && onCreated(created.current),
  );
  return (
    <Dialog title={t("workspace.new.title")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>{t("workspace.new.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("workspace.new.namePlaceholder")} autoFocus />
        </label>
        <div className="field">
          <span>{t("workspace.new.projects")}</span>
          {projects.length === 0 && <p className="muted">{t("workspace.new.none")}</p>}
          {projects.map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))} /> {p.name}
            </label>
          ))}
        </div>
        {error && <p className="alert">{error}</p>}
        <div className="actions end">
          <button type="button" className="btn" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!name.trim() || pending}>
            {pending ? t("workspace.saving") : t("workspace.save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
