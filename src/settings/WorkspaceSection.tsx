// Réglages > Workspace : son nom, ses projets, et sa suppression (ses projets restent dans Spawn et sur le disque).
import { useState } from "react";
import type { Api, ProjectView, WorkspaceView } from "../shared/api.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { t } from "../i18n/i18n.ts";
import { BlurField } from "./BlurField.tsx";
import { DangerZone } from "./DangerZone.tsx";
import { SettingRow } from "./SettingRow.tsx";
import { WorkspaceMembers } from "./WorkspaceMembers.tsx";

interface Props {
  api: Api;
  workspace: WorkspaceView;
  projects: ProjectView[];
  onChanged: () => Promise<void>;
  onDeleted: () => void;
  onAdopt: () => void;
  onNewProject: () => void;
}

export function WorkspaceSection({ api, workspace, projects, onChanged, onDeleted, onAdopt, onNewProject }: Props) {
  const [confirming, setConfirming] = useState(false);
  const base = `/api/workspaces/${encodeURIComponent(workspace.id)}`;
  const n = workspace.projects.length;
  const e = workspace.epics.length;
  return (
    <>
      <h3>{t("settings.workspace.title", { name: workspace.name })}</h3>
      <p className="settings-intro">{t("settings.workspace.intro")}</p>
      <SettingRow label={t("settings.workspace.name")}>
        <BlurField
          key={workspace.id}
          value={workspace.name}
          onSave={async (name) => {
            await api.call("PATCH", base, { name });
            await onChanged();
          }}
        />
      </SettingRow>
      <WorkspaceMembers api={api} workspace={workspace} projects={projects} onChanged={onChanged} onAdopt={onAdopt} onNewProject={onNewProject} />
      <DangerZone action={t("settings.workspace.delete")} consequence={t("settings.workspace.deleteConsequence", { n, e })} button={t("settings.workspace.deleteButton")} onClick={() => setConfirming(true)} />
      {confirming && (
        <ConfirmDialog
          title={t("settings.workspace.deleteTitle", { name: workspace.name })}
          consequence={t("settings.workspace.deleteConsequence", { n, e })}
          confirm={t("settings.workspace.deleteConfirm")}
          pending={t("settings.deleting")}
          onConfirm={async () => {
            await api.call("DELETE", base);
            onDeleted();
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
