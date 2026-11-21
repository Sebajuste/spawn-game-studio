// La fenêtre Réglages (Ctrl+, ; docs/reglages.md §3) : une section par portée à gauche, son contenu à droite. Chaque
// changement s'enregistre aussitôt : pas de bouton Enregistrer. Échap ou ✕ ferme.
import { useState } from "react";
import type { Api, ModuleState, ProjectView, WorkspaceView } from "../shared/api.ts";
import { useAdapters } from "../data/useAdapters.ts";
import { t } from "../i18n/i18n.ts";
import { AppSection } from "./AppSection.tsx";
import { ProjectSection } from "./ProjectSection.tsx";
import type { SettingsSection } from "./sections.ts";
import { WorkspaceSection } from "./WorkspaceSection.tsx";
import "./settings.css";

interface Props {
  api: Api;
  section: SettingsSection;
  workspace: WorkspaceView | null;
  project: ProjectView | null;
  projects: ProjectView[];
  modules: ModuleState[];
  onToggleModule: (id: string, active: boolean) => void;
  onWorkspacesChanged: () => Promise<void>;
  onWorkspaceDeleted: () => void;
  onProjectRemoved: () => void;
  onAdopt: () => void;
  onNewProject: () => void;
  onClose: () => void;
  onError: (e: string) => void;
}

export function SettingsWindow(p: Props) {
  const [section, setSection] = useState<SettingsSection>(p.section);
  const adapters = useAdapters(p.api);
  const shown = section === "workspace" && !p.workspace ? "app" : section === "project" && !p.project ? "app" : section;
  const tab = (id: SettingsSection, title: string) => (
    <button key={id} className={shown === id ? "chosen" : ""} aria-current={shown === id} onClick={() => setSection(id)}>
      {title}
    </button>
  );
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="settings-window" role="dialog" aria-label={t("settings.title")}>
        <nav>
          <h4>{t("settings.nav.app")}</h4>
          {tab("app", t("settings.app.title"))}
          {(p.workspace || p.project) && <h4>{t("settings.nav.scope")}</h4>}
          {p.workspace && tab("workspace", t("settings.workspace.title", { name: p.workspace.name }))}
          {p.project && tab("project", t("settings.project.title", { name: p.project.name }))}
        </nav>
        <div className="settings-content">
          {shown === "app" && <AppSection modules={p.modules} onToggle={p.onToggleModule} />}
          {shown === "workspace" && p.workspace && (
            <WorkspaceSection api={p.api} workspace={p.workspace} projects={p.projects} onChanged={p.onWorkspacesChanged} onDeleted={p.onWorkspaceDeleted} onAdopt={p.onAdopt} onNewProject={p.onNewProject} />
          )}
          {shown === "project" && p.project && <ProjectSection api={p.api} project={p.project} adapters={adapters} onRemoved={p.onProjectRemoved} onError={p.onError} />}
        </div>
        <button className="settings-close" title={t("settings.close")} aria-label={t("settings.close")} onClick={p.onClose}>
          ✕
        </button>
      </div>
    </div>
  );
}
