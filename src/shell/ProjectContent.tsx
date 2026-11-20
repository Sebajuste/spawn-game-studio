// Le contenu d'un projet selon l'adresse : la page d'une story, À traiter ou le Backlog.
import type { Api, ProjectView } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";
import { inProgress, waitingFor, type Backlogs } from "../data/inbox.ts";
import { Inbox } from "../inbox/Inbox.tsx";
import { projectRoute, type ProjectRoute, type Route } from "../navigation/route.ts";
import { ProjectBacklog } from "../project/ProjectBacklog.tsx";
import { StoryPage } from "../story/StoryPage.tsx";

interface Props {
  api: Api;
  events: EventSource | null;
  route: ProjectRoute;
  project: ProjectView;
  backlogs: Backlogs;
  active: ReadonlySet<string>;
  composing: boolean;
  onCompose: (open: boolean) => void;
  navigate: (route: Route, replace?: boolean) => void;
  onLaunch: (story: string | null) => void;
  onError: (e: string | null) => void;
}

export function ProjectContent({ api, events, route, project, backlogs, active, composing, onCompose, navigate, onLaunch, onError }: Props) {
  const here = (place: ProjectRoute["place"], story: string | null = null) => projectRoute(project.id, route.workspace, place, story);
  if (route.story) {
    const story = route.story;
    return <StoryPage key={`${project.id}/${story}`} api={api} events={events} project={project.id} story={story} active={active} onLaunch={() => onLaunch(story)} onError={onError} onClosed={() => navigate(here(route.place), true)} />;
  }
  if (!active.has("backlog")) return <main className="empty">{t("project.off")}</main>;
  const stories = backlogs.get(project.id) ?? null;
  if (route.place === "backlog") {
    return <ProjectBacklog api={api} project={project.id} stories={stories} composing={composing} onCompose={onCompose} onOpen={(s) => navigate(here("backlog", s))} />;
  }
  const ids = [project.id];
  return (
    <Inbox
      waiting={stories === null ? null : waitingFor(backlogs, ids)}
      running={inProgress(backlogs, ids)}
      workspace={null}
      projectName={() => project.name}
      onOpen={(item) => navigate(here("inbox", item.story.story))}
      onBacklog={() => navigate(here("backlog"))}
    />
  );
}
