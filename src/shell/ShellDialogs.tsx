// Le dialogue ouvert par la coque, un seul à la fois ; chacun dit où mène sa réussite.
import type { Api, ProjectView, WorkspaceView } from "../shared/api.ts";
import type { Backlogs } from "../data/inbox.ts";
import { GoToDialog } from "../navigation/GoToDialog.tsx";
import { goToEntries } from "../navigation/goto.ts";
import { projectRoute, workspaceRoute, type Route } from "../navigation/route.ts";
import { NewProjectDialog } from "../project/NewProjectDialog.tsx";
import { OpenProjectDialog } from "../project/OpenProjectDialog.tsx";
import { SettingsDialog } from "../project/SettingsDialog.tsx";
import { subtitle } from "../project/storyText.ts";
import { NewEpicDialog } from "../workspace/NewEpicDialog.tsx";
import { NewWorkspaceDialog } from "../workspace/NewWorkspaceDialog.tsx";
import type { DialogKind } from "./dialogs.ts";
import { ScopePicker } from "./ScopePicker.tsx";

interface Props {
  dialog: DialogKind;
  api: Api;
  events: EventSource | null;
  route: Route;
  projects: ProjectView[];
  workspaces: WorkspaceView[];
  scope: readonly string[];
  backlogs: Backlogs;
  projectName: (id: string) => string;
  open: (dialog: DialogKind) => void;
  close: () => void;
  navigate: (route: Route) => void;
  addProject: (dir: string) => void;
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
  if (dialog === "picker") {
    return <ScopePicker projects={p.projects} workspaces={p.workspaces} inline={false} notice={null} onPick={go} onNewProject={() => p.open("new")} onOpenProject={() => p.open("open")} onNewWorkspace={() => p.open("workspace")} onClose={close} />;
  }
  if (dialog === "new") {
    return <NewProjectDialog api={api} events={p.events} onClose={close} onCreated={(made) => void p.reloadProjects().then(() => go(projectRoute(made.id)))} />;
  }
  if (dialog === "open") return <OpenProjectDialog onClose={close} onOpen={p.addProject} />;
  if (dialog === "workspace") {
    return <NewWorkspaceDialog api={api} projects={p.projects} onClose={close} onCreated={(w) => void p.reloadWorkspaces().then(() => go(workspaceRoute(w.id)))} />;
  }
  if (dialog === "settings" && route.kind === "project") {
    return <SettingsDialog api={api} project={route.project} name={p.projectName(route.project)} onClose={close} onError={p.onError} />;
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
