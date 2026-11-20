// Lieu « Accueil » d'une portée (docs/conversation.md, docs/navigation.md §4) : la conversation avec son agent au centre,
// À juger à droite. Le même pour un projet et pour un workspace.
import { t } from "../i18n/i18n.ts";
import type { InboxItem } from "../data/inbox.ts";
import type { Api, TalkScope } from "../shared/api.ts";
import { Talk } from "../talk/Talk.tsx";
import { ToJudge } from "./ToJudge.tsx";
import "./home.css";

interface Props {
  api: Api;
  events: EventSource | null;
  scope: TalkScope;
  id: string;
  active: ReadonlySet<string>;
  focus: number;
  // null tant que les backlogs ne sont pas lus.
  waiting: InboxItem[] | null;
  running: InboxItem[];
  projectName: ((id: string) => string) | null;
  onOpenItem: (item: InboxItem) => void;
  onOpenStory: (project: string, story: string) => void;
  onOpenEpic: (epic: string) => void;
}

export function Home({ api, events, scope, id, active, focus, waiting, running, projectName, onOpenItem, onOpenStory, onOpenEpic }: Props) {
  return (
    <div className="home">
      {active.has("talk") ? (
        <Talk key={`${scope}/${id}`} api={api} events={events} scope={scope} id={id} showActivity={active.has("activity")} focus={focus} projectName={projectName} onOpenStory={onOpenStory} onOpenEpic={onOpenEpic} />
      ) : (
        <main className="empty">{t("talk.off")}</main>
      )}
      {active.has("backlog") && <ToJudge waiting={waiting} running={running} projectName={projectName} onOpen={onOpenItem} />}
    </div>
  );
}
