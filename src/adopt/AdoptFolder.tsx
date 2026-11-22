// Première étape : le dossier du projet à ajouter. Rien n'est écrit tant que le diagnostic n'a pas été validé.
import { Refusal, type Action } from "../shared/action.ts";
import { t } from "../i18n/i18n.ts";
import { FolderField } from "../project/FolderField.tsx";

export function AdoptFolder({ dir, act, onDir, onDiagnose, onCancel }: { dir: string; act: Action; onDir: (d: string) => void; onDiagnose: () => void; onCancel: () => void }) {
  return (
    <form
      className="adopt-folder"
      onSubmit={(e) => {
        e.preventDefault();
        if (dir.trim()) onDiagnose();
      }}
    >
      <p className="settings-intro">{t("adopt.folderIntro")}</p>
      <label className="field">
        <span>{t("adopt.folder")}</span>
        <FolderField value={dir} onChange={onDir} title={t("adopt.folderPick")} />
      </label>
      <Refusal action={act} k="diagnose" />
      <div className="actions end">
        <button type="button" className="btn" onClick={onCancel}>
          {t("dialog.cancel")}
        </button>
        <button type="submit" className="btn primary" disabled={!dir.trim() || act.pending !== null}>
          {act.pending === "diagnose" ? t("adopt.diagnosing") : t("adopt.diagnose")}
        </button>
      </div>
    </form>
  );
}
