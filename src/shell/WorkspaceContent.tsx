// Le contenu d'un workspace selon l'adresse : l'Accueil, les Epics (ou la page d'un epic), les Projets.
import type { Api, ProjectView, WorkspaceView } from "../shared/api.ts";
import { inProgress, waitingFor, type Backlogs } from "../data/inbox.ts";
import { Home } from "../home/Home.tsx";
import { projectRoute, workspaceRoute, type Route, type WorkspaceRoute } from "../navigation/route.ts";
import { EpicPage } from "../workspace/EpicPage.tsx";
import { WorkspaceEpics } from "../workspace/WorkspaceEpics.tsx";
import { WorkspaceProjects } from "../workspace/WorkspaceProjects.tsx";

interface Props {
  api: Api;
  events: EventSource | null;
  route: WorkspaceRoute;
  workspace: WorkspaceView;
  projects: ProjectView[];
  backlogs: Backlogs;
  active: ReadonlySet<string>;
  projectName: (id: string) => string;
  // Change à chaque Ctrl+J : le curseur va dans la conversation.
  focus: number;
  navigate: (route: Route, replace?: boolean) => void;
  onNewEpic: () => void;
  onManage: () => void;
  onChanged: () => void;
}

export function WorkspaceContent({ api, events, route, workspace, projects, backlogs, active, projectName, focus, navigate, onNewEpic, onManage, onChanged }: Props) {
  const ws = workspace.id;
  if (route.place === "epics") {
    const epic = route.epic ? workspace.epics.find((e) => e.id === route.epic) : undefined;
    if (epic) {
      return <EpicPage api={api} workspace={ws} projects={workspace.projects} epic={epic} projectName={projectName} onChanged={onChanged} onDeleted={() => {
            onChanged();
            navigate(workspaceRoute(ws, "epics"), true);
          }} onOpenStory={(s) => navigate(projectRoute(s.project, ws, "backlog", s.story))} />;
    }
    return <WorkspaceEpics workspace={workspace} onNew={onNewEpic} onOpen={(id) => navigate(workspaceRoute(ws, "epics", id))} />;
  }
  if (route.place === "projects") {
    return <WorkspaceProjects workspace={workspace} projects={projects} backlogs={backlogs} onOpen={(p) => navigate(projectRoute(p, ws))} onManage={onManage} />;
  }
  const ids = workspace.projects;
  const loading = ids.some((p) => (backlogs.get(p) ?? null) === null);
  return (
    <Home
      api={api}
      events={events}
      scope="workspace"
      id={ws}
      active={active}
      focus={focus}
      waiting={loading ? null : waitingFor(backlogs, ids)}
      running={inProgress(backlogs, ids)}
      projectName={projectName}
      onOpenItem={(item) => navigate(projectRoute(item.project, ws, "home", item.story.story))}
      onOpenStory={(project, story) => navigate(projectRoute(project, ws, "home", story))}
      onOpenEpic={(epic) => navigate(workspaceRoute(ws, "epics", epic))}
    />
  );
}
