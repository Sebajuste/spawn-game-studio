// Ouvrir un projet (Ctrl+O) : le sélecteur de Windows sous Tauri, tout de suite ; un champ de dossier sinon.
import { useEffect, useState } from "react";
import { inTauri, pickFolder } from "../shared/api.ts";
import { Dialog } from "../shared/Dialog.tsx";
import { t } from "../i18n/i18n.ts";
import { FolderField } from "./FolderField.tsx";

export function OpenProjectDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (dir: string) => void }) {
  const [dir, setDir] = useState("");
  useEffect(() => {
    if (!inTauri()) return;
    void pickFolder(t("open.title")).then((d) => (d ? onOpen(d) : onClose()));
  }, [onOpen, onClose]);
  if (inTauri()) return null;
  return (
    <Dialog title={t("open.title")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dir.trim()) onOpen(dir.trim());
        }}
      >
        <label className="field">
          <span>{t("open.folder")}</span>
          <FolderField value={dir} onChange={setDir} title={t("open.title")} />
        </label>
        <div className="actions end">
          <button type="button" className="btn" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!dir.trim()}>
            {t("open.action")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
