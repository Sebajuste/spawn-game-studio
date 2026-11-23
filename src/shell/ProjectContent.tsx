// Le contenu d'un projet selon l'adresse : la page d'une story, l'Accueil ou le Backlog.
import type { Api, LoadView, ProjectView } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";
import { inProgress, waitingFor, type Backlogs } from "../data/inbox.ts";
import { Home } from "../home/Home.tsx";
import { projectRoute, type ProjectRoute, type Route } from "../navigation/route.ts";
import { ProjectBacklog } from "../project/ProjectBacklog.tsx";
import { StoryPage } from "../story/StoryPage.tsx";

interface Props {
  api: Api;
  events: EventSource | null;
  route: ProjectRoute;
  project: ProjectView;
  backlogs: Backlogs;
  load: LoadView | null;
  active: ReadonlySet<string>;
  // Change à chaque Ctrl+J : le curseur va dans la conversation.
  focus: number;
  onTalk: () => void;
  navigate: (route: Route, replace?: boolean) => void;
  onLaunch: (story: string | null) => void;
  // Réglages > Application, où se règle la charge de la machine.
  onLoadSettings: () => void;
  onError: (e: string | null) => void;
}

export function ProjectContent({ api, events, route, project, backlogs, load, active, focus, onTalk, navigate, onLaunch, onLoadSettings, onError }: Props) {
  const here = (place: ProjectRoute["place"], story: string | null = null) => projectRoute(project.id, route.workspace, place, story);
  if (route.story) {
    const story = route.story;
    return <StoryPage key={`${project.id}/${story}`} api={api} events={events} project={project.id} story={story} active={active} onLaunch={() => onLaunch(story)} machine={load} onLoadSettings={onLoadSettings} onError={onError} onClosed={() => navigate(here(route.place), true)} />;
  }
  const stories = backlogs.get(project.id) ?? null;
  if (route.place === "backlog") {
    if (!active.has("backlog")) return <main className="empty">{t("project.off")}</main>;
    return <ProjectBacklog api={api} project={project.id} stories={stories} onOpen={(s) => navigate(here("backlog", s))} onTalk={onTalk} onError={(e) => onError(e)} />;
  }
  const ids = [project.id];
  return (
    <Home
      api={api}
      events={events}
      scope="project"
      id={project.id}
      active={active}
      focus={focus}
      waiting={stories === null ? null : waitingFor(backlogs, ids)}
      running={inProgress(backlogs, ids)}
      projectName={null}
      onOpenItem={(item) => navigate(here("home", item.story.story))}
      onOpenStory={(_, story) => navigate(here("home", story))}
      onOpenEpic={() => undefined}
    />
  );
}
