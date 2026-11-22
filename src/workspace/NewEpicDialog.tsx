// Nouvel epic : une intention en une phrase et ses critères d'acceptation, un par ligne.
import { useState } from "react";
import type { Api } from "../shared/api.ts";
import { Dialog } from "../shared/Dialog.tsx";
import { t } from "../i18n/i18n.ts";
import { useSubmit } from "./useSubmit.ts";

export function NewEpicDialog({ api, workspace, onClose, onDone }: { api: Api; workspace: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const { pending, error, submit } = useSubmit(
    () => api.call("POST", `/api/workspaces/${encodeURIComponent(workspace)}/epics`, { title: title.trim(), acceptance: acceptance.split("\n") }),
    onDone,
  );
  return (
    <Dialog title={t("workspace.epic.title")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>{t("workspace.epic.name")}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>{t("workspace.epic.acceptance")}</span>
          <textarea rows={4} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
        </label>
        {error && <p className="alert">{error}</p>}
        <div className="actions end">
          <button type="button" className="btn" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!title.trim() || pending}>
            {pending ? t("workspace.saving") : t("workspace.save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
