// Lieu « Epics » d'un workspace (docs/navigation.md §4) : un epic par carte ; « + Epic » est la création du lieu.
import type { WorkspaceView } from "../shared/api.ts";
import { PlaceHeader } from "../shared/PlaceHeader.tsx";
import { t } from "../i18n/i18n.ts";
import { epicDone } from "./epicState.ts";
import { EpicSummary } from "./EpicSummary.tsx";
import "./workspace.css";

export function WorkspaceEpics({ workspace, onNew, onOpen }: { workspace: WorkspaceView; onNew: () => void; onOpen: (epic: string) => void }) {
  const done = workspace.epics.filter(epicDone).length;
  const subtitle = workspace.epics.length === 0 ? t("nav.epics.subtitle.zero") : t("nav.epics.subtitle", { active: workspace.epics.length - done, done });
  return (
    <>
      <PlaceHeader title={t("nav.place.epics")} subtitle={subtitle}>
        <button className="btn primary" onClick={onNew}>
          {t("nav.epics.add")}
        </button>
      </PlaceHeader>
      <div className="scroll">
        {workspace.epics.length === 0 && <p className="muted">{t("workspace.noEpics")}</p>}
        {workspace.epics.map((e) => (
          <EpicSummary key={e.id} epic={e} onOpen={() => onOpen(e.id)} />
        ))}
      </div>
    </>
  );
}
