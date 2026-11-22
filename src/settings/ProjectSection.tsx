// Réglages > Projet : ses réglages machine, ce que dit son spawn.json (en lecture), et « Retirer de Spawn » (le dossier
// reste tel quel, il se rajoute par « Ajouter un projet existant »).
import { useState } from "react";
import type { AdapterInfo, Api, ProjectView } from "../shared/api.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { engineTitle } from "../data/useAdapters.ts";
import { t } from "../i18n/i18n.ts";
import { openFolder } from "../project/launch.ts";
import { DangerZone } from "./DangerZone.tsx";
import { ProjectMachineSettings } from "./ProjectMachineSettings.tsx";
import { SettingRow } from "./SettingRow.tsx";

interface Props {
  api: Api;
  project: ProjectView;
  adapters: AdapterInfo[] | null;
  onRemoved: () => void;
  onError: (e: string) => void;
}

export function ProjectSection({ api, project, adapters, onRemoved, onError }: Props) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <h3>{t("settings.project.title", { name: project.name })}</h3>
      <p className="settings-intro">{t("settings.project.intro")}</p>
      <ProjectMachineSettings key={project.id} api={api} project={project.id} />
      <h4>{t("settings.project.declared")}</h4>
      <SettingRow label={t("settings.project.engine")}>
        <span>{`${engineTitle(adapters, project.engine)} ${project.version ?? ""}`.trim() || "—"}</span>
      </SettingRow>
      <SettingRow label={t("settings.project.tag")}>
        <span>{project.tag ?? "—"}</span>
      </SettingRow>
      <SettingRow label={t("settings.project.folder")}>
        <span className="setting-folder">
          <code>{project.root}</code>
          <button className="btn small" onClick={() => openFolder(api, project.id).catch((e: Error) => onError(e.message))}>
            {t("settings.project.openFolder")}
          </button>
        </span>
      </SettingRow>
      <DangerZone action={t("settings.project.remove")} consequence={t("settings.project.removeConsequence")} button={t("settings.project.removeButton")} onClick={() => setConfirming(true)} />
      {confirming && (
        <ConfirmDialog
          title={t("settings.project.removeTitle", { name: project.name })}
          consequence={t("settings.project.removeConsequence")}
          confirm={t("settings.project.removeConfirm")}
          pending={t("settings.removing")}
          onConfirm={async () => {
            await api.call("DELETE", `/api/projects/${encodeURIComponent(project.id)}`);
            onRemoved();
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
