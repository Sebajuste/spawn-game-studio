// « Ajouter un projet existant » (Ctrl+O ; docs/adoption.md §2, maquette reglages.html) : dossier, diagnostic, adoption,
// résultat. Une fois l'adoption lancée, la fenêtre ne se ferme plus avant sa fin : elle écrit dans le dépôt.
import type { Api, ProjectView } from "../shared/api.ts";
import { Refusal } from "../shared/action.ts";
import { useEscape } from "../shared/useEscape.ts";
import { useAdapters } from "../data/useAdapters.ts";
import { t } from "../i18n/i18n.ts";
import { AdoptChoice } from "./AdoptChoice.tsx";
import { AdoptFolder } from "./AdoptFolder.tsx";
import { AdoptResult } from "./AdoptResult.tsx";
import { DiagnosisList } from "./DiagnosisList.tsx";
import { useAdoption, validChoice } from "./useAdoption.ts";
import "./adopt.css";

interface Props {
  api: Api;
  events: EventSource | null;
  workspace: { id: string; name: string } | null;
  onClose: () => void;
  onOpen: (p: ProjectView) => void;
}

export function AdoptWindow({ api, events, workspace, onClose, onOpen }: Props) {
  const a = useAdoption(api, events, workspace?.id ?? null);
  const adapters = useAdapters(api);
  const busy = a.act.pending !== null;
  // Toujours pris ici : la coque fermerait sinon la fenêtre en pleine adoption.
  useEscape(true, () => !busy && onClose());
  const d = a.diagnosis;
  const name = a.result?.project.name ?? d?.name ?? "";

  const title =
    a.step === "done" ? t("adopt.doneTitle", { name }) : a.step === "adopting" ? t("adopt.adoptingTitle", { name }) : d && a.step === "diagnosis" ? t("adopt.titleOf", { name }) : t("adopt.title");
  const subtitle = a.step === "done" ? (workspace ? t("adopt.addedTo", { workspace: workspace.name }) : a.result?.project.root) : a.step === "diagnosis" && d ? t("adopt.nothingWritten", { dir: d.dir }) : null;

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={`adopt-window ${a.step === "folder" ? "small" : ""}`} role="dialog" aria-label={title}>
        <header>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </header>
        {a.step === "folder" && <AdoptFolder dir={a.dir} act={a.act} onDir={a.setDir} onDiagnose={() => void a.diagnose()} onCancel={onClose} />}
        {a.step === "diagnosis" && d && (
          <>
            <AdoptChoice adapters={adapters} choice={a.choice} versions={a.versions} disabled={busy} onChange={a.setChoice} onEngine={(engine) => void a.diagnose(engine)} />
            <div className="adopt-list">
              <DiagnosisList diagnosis={d} />
            </div>
            <footer>
              <span className="adopt-then">{workspace ? t("adopt.thenIn", { workspace: workspace.name }) : t("adopt.then")}</span>
              <Refusal action={a.act} k="adopt" />
              <Refusal action={a.act} k="diagnose" />
              <button className="btn" onClick={a.back} disabled={busy}>
                {t("adopt.otherFolder")}
              </button>
              <button className="btn" onClick={onClose} disabled={busy}>
                {t("dialog.cancel")}
              </button>
              <button className="btn primary" disabled={busy || !d.ready || !validChoice(a.choice)} title={d.ready ? undefined : t("adopt.notReady")} onClick={() => void a.adopt()}>
                {t("adopt.adopt")}
              </button>
            </footer>
          </>
        )}
        {a.step === "adopting" && (
          <div className="adopt-list">
            <pre className="adopt-log">{[...a.lines, "…"].join("\n")}</pre>
          </div>
        )}
        {a.step === "done" && a.result && (
          <>
            <div className="adopt-list">
              <AdoptResult result={a.result} lines={a.lines} />
            </div>
            <footer>
              <button className="btn" onClick={onClose}>
                {t("dialog.close")}
              </button>
              <button className="btn primary" autoFocus onClick={() => a.result && onOpen(a.result.project)}>
                {t("adopt.open", { name })}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
