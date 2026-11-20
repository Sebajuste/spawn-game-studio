// Lieu « À traiter » (docs/navigation.md §4), le même pour un projet et pour un workspace : ce qui attend une décision ou
// une recette, puis ce qui tourne. Dans un workspace, chaque carte dit son projet.
import { t } from "../i18n/i18n.ts";
import type { InboxItem } from "../data/inbox.ts";
import { PlaceHeader } from "../shared/PlaceHeader.tsx";
import { StoryCard } from "../project/StoryCard.tsx";
import "./inbox.css";

interface Props {
  waiting: InboxItem[] | null;
  running: InboxItem[];
  // Nom du workspace quand la portée en est un : les cartes montrent alors leur projet.
  workspace: string | null;
  projectName: (id: string) => string;
  onOpen: (item: InboxItem) => void;
  onBacklog: (() => void) | null;
}

function count(n: number, workspace: string | null): string {
  if (n === 0) return t("nav.inbox.subtitle.zero");
  if (workspace) return t(n === 1 ? "nav.inbox.subtitleIn.one" : "nav.inbox.subtitleIn.other", { n, name: workspace });
  return t(n === 1 ? "nav.inbox.subtitle.one" : "nav.inbox.subtitle.other", { n });
}

export function Inbox({ waiting, running, workspace, projectName, onOpen, onBacklog }: Props) {
  if (waiting === null) return <div className="scroll muted">{t("nav.inbox.loading")}</div>;
  const tag = (item: InboxItem) => (workspace ? projectName(item.project) : undefined);
  const key = (item: InboxItem) => `${item.project}/${item.story.story}`;
  return (
    <>
      <PlaceHeader title={t("nav.place.inbox")} subtitle={count(waiting.length, workspace)} />
      <div className="scroll">
        {waiting.map((item) => (
          <StoryCard key={key(item)} story={item.story} project={tag(item)} action={item.story.group === "blocked" ? t("nav.inbox.decide") : t("nav.inbox.review")} primary={item.story.group === "blocked"} onOpen={() => onOpen(item)} />
        ))}
        {waiting.length === 0 && (
          <div className="all-clear">
            <div className="all-clear-mark">✓</div>
            <p>
              <strong>{t("nav.inbox.empty")}</strong>
            </p>
            {running.length === 0 && (
              <p className="muted">
                {t("nav.inbox.noAgent")}{" "}
                {onBacklog && (
                  <button className="btn small" onClick={onBacklog}>
                    {t("nav.inbox.openBacklog")}
                  </button>
                )}
              </p>
            )}
          </div>
        )}
        {running.length > 0 && (
          <>
            <h3 className="group-title">{t("project.group.active")}</h3>
            {running.map((item) => (
              <StoryCard key={key(item)} story={item.story} project={tag(item)} onOpen={() => onOpen(item)} />
            ))}
          </>
        )}
      </div>
    </>
  );
}
