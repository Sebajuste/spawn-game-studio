// Le dialogue ouvert par la coque, un seul à la fois ; chacun dit où mène sa réussite.
import type { Api, ModuleState, ProjectView, WorkspaceView } from "../shared/api.ts";
import { AdoptWindow } from "../adopt/AdoptWindow.tsx";
import type { Backlogs } from "../data/inbox.ts";
import { GoToDialog } from "../navigation/GoToDialog.tsx";
import { goToEntries } from "../navigation/goto.ts";
import { projectRoute, workspaceRoute, type Route } from "../navigation/route.ts";
import { NewProjectDialog } from "../project/NewProjectDialog.tsx";
import { subtitle } from "../project/storyText.ts";
import { settingsScope, type SettingsSection } from "../settings/sections.ts";
import { SettingsWindow } from "../settings/SettingsWindow.tsx";
import { NewEpicDialog } from "../workspace/NewEpicDialog.tsx";
import { NewWorkspaceDialog } from "../workspace/NewWorkspaceDialog.tsx";
import type { DialogKind } from "./dialogs.ts";
import { ScopePicker } from "./ScopePicker.tsx";

interface Props {
  dialog: DialogKind;
  section: SettingsSection;
  api: Api;
  events: EventSource | null;
  route: Route;
  projects: ProjectView[];
  workspaces: WorkspaceView[];
  modules: ModuleState[];
  scope: readonly string[];
  backlogs: Backlogs;
  projectName: (id: string) => string;
  open: (dialog: DialogKind) => void;
  close: () => void;
  navigate: (route: Route) => void;
  toggleModule: (id: string, active: boolean) => void;
  reloadProjects: () => Promise<void>;
  reloadWorkspaces: () => Promise<void>;
  onError: (e: string) => void;
}

export function ShellDialogs(p: Props) {
  const { dialog, api, route, close, navigate } = p;
  const go = (r: Route) => {
    close();
    navigate(r);
  };
  // Un projet créé ou adopté depuis un workspace y est ajouté, et s'ouvre dans ce workspace.
  const inWorkspace = route.kind === "picker" ? null : (p.workspaces.find((w) => w.id === route.workspace) ?? null);
  const opened = (project: ProjectView) => void Promise.all([p.reloadProjects(), p.reloadWorkspaces()]).then(() => go(projectRoute(project.id, inWorkspace?.id ?? null)));

  if (dialog === "picker") {
    return <ScopePicker projects={p.projects} workspaces={p.workspaces} inline={false} notice={null} onPick={go} onNewProject={() => p.open("new")} onOpenProject={() => p.open("adopt")} onNewWorkspace={() => p.open("workspace")} onClose={close} />;
  }
  if (dialog === "new") {
    return (
      <NewProjectDialog
        api={api}
        events={p.events}
        onClose={close}
        onCreated={(made) => {
          const added = inWorkspace ? api.call("POST", `/api/workspaces/${encodeURIComponent(inWorkspace.id)}/projects`, { project: made.id }) : Promise.resolve();
          void added.catch((e: Error) => p.onError(e.message)).then(() => opened(made));
        }}
      />
    );
  }
  if (dialog === "adopt") return <AdoptWindow api={api} events={p.events} workspace={inWorkspace} onClose={close} onOpen={opened} />;
  if (dialog === "workspace") {
    return <NewWorkspaceDialog api={api} projects={p.projects} onClose={close} onCreated={(w) => void p.reloadWorkspaces().then(() => go(workspaceRoute(w.id)))} />;
  }
  if (dialog === "settings") {
    const scope = settingsScope(route);
    const workspace = p.workspaces.find((w) => w.id === scope.workspace) ?? null;
    const project = p.projects.find((x) => x.id === scope.project) ?? null;
    return (
      <SettingsWindow
        api={api}
        section={p.section}
        workspace={workspace}
        project={project}
        projects={p.projects}
        modules={p.modules}
        onToggleModule={p.toggleModule}
        onWorkspacesChanged={p.reloadWorkspaces}
        onWorkspaceDeleted={() => void p.reloadWorkspaces().then(() => go({ kind: "picker" }))}
        onProjectRemoved={() => void Promise.all([p.reloadProjects(), p.reloadWorkspaces()]).then(() => go(workspace ? workspaceRoute(workspace.id) : { kind: "picker" }))}
        onAdopt={() => p.open("adopt")}
        onNewProject={() => p.open("new")}
        onClose={close}
        onError={p.onError}
      />
    );
  }
  if (dialog === "epic" && route.kind === "workspace") {
    return <NewEpicDialog api={api} workspace={route.workspace} onClose={close} onDone={() => void p.reloadWorkspaces().then(close)} />;
  }
  if (dialog === "goto" && route.kind !== "picker") {
    const ws = route.kind === "workspace" ? (p.workspaces.find((w) => w.id === route.workspace) ?? null) : null;
    const parent = route.kind === "project" && route.workspace ? { id: route.workspace, epics: [] } : null;
    const entries = goToEntries(p.scope, p.backlogs, ws ?? parent, p.projectName, subtitle);
    return <GoToDialog entries={entries} onClose={close} onPick={go} />;
  }
  return null;
}
