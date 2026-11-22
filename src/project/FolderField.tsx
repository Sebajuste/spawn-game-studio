// Champ de dossier : le sélecteur de Windows sous Tauri, la saisie sinon (et toujours possible).
import { inTauri, pickFolder } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";

export function FolderField({ value, onChange, title }: { value: string; onChange: (v: string) => void; title: string }) {
  return (
    <div className="field-row">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="C:\Dev" autoFocus={!inTauri()} />
      {inTauri() && (
        <button type="button" className="btn" onClick={() => void pickFolder(title).then((d) => d && onChange(d))}>
          {t("dialog.browse")}
        </button>
      )}
    </div>
  );
}
