// Le contenu d'un workspace selon l'adresse : À traiter, les Epics (ou la page d'un epic), les Projets.
import type { Api, ProjectView, WorkspaceView } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";
import { inProgress, waitingFor, type Backlogs } from "../data/inbox.ts";
import { Inbox } from "../inbox/Inbox.tsx";
import { projectRoute, workspaceRoute, type Route, type WorkspaceRoute } from "../navigation/route.ts";
import { EpicPage } from "../workspace/EpicPage.tsx";
import { WorkspaceEpics } from "../workspace/WorkspaceEpics.tsx";
import { WorkspaceProjects } from "../workspace/WorkspaceProjects.tsx";

interface Props {
  api: Api;
  route: WorkspaceRoute;
  workspace: WorkspaceView;
  projects: ProjectView[];
  backlogs: Backlogs;
  active: ReadonlySet<string>;
  projectName: (id: string) => string;
  navigate: (route: Route, replace?: boolean) => void;
  onNewEpic: () => void;
  onChanged: () => void;
  onError: (e: string) => void;
}

export function WorkspaceContent({ api, route, workspace, projects, backlogs, active, projectName, navigate, onNewEpic, onChanged, onError }: Props) {
  const ws = workspace.id;
  if (route.place === "epics") {
    const epic = route.epic ? workspace.epics.find((e) => e.id === route.epic) : undefined;
    if (epic) {
      return <EpicPage api={api} workspace={ws} projects={workspace.projects} epic={epic} projectName={projectName} onChanged={onChanged} onOpenStory={(s) => navigate(projectRoute(s.project, ws, "backlog", s.story))} />;
    }
    return <WorkspaceEpics workspace={workspace} onNew={onNewEpic} onOpen={(id) => navigate(workspaceRoute(ws, "epics", id))} />;
  }
  if (route.place === "projects") {
    return (
      <WorkspaceProjects
        api={api}
        workspace={workspace}
        projects={projects}
        backlogs={backlogs}
        onOpen={(p) => navigate(projectRoute(p, ws))}
        onChanged={onChanged}
        onDeleted={() => {
          onChanged();
          navigate({ kind: "picker" }, true);
        }}
        onError={onError}
      />
    );
  }
  if (!active.has("backlog")) return <main className="empty">{t("project.off")}</main>;
  const ids = workspace.projects;
  const loading = ids.some((p) => (backlogs.get(p) ?? null) === null);
  return (
    <Inbox
      waiting={loading ? null : waitingFor(backlogs, ids)}
      running={inProgress(backlogs, ids)}
      workspace={workspace.name}
      projectName={projectName}
      onOpen={(item) => navigate(projectRoute(item.project, ws, "inbox", item.story.story))}
      onBacklog={null}
    />
  );
}
