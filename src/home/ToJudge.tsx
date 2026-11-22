// Colonne « À juger » de l'Accueil (docs/conversation.md §2) : ce qui attend une décision ou une recette, puis ce qui
// tourne. Dans un workspace, chaque carte dit son projet.
import { t } from "../i18n/i18n.ts";
import type { InboxItem } from "../data/inbox.ts";
import { StoryCard } from "../project/StoryCard.tsx";

interface Props {
  waiting: InboxItem[] | null;
  running: InboxItem[];
  // Nom du projet d'une carte, seulement quand la portée en mêle plusieurs.
  projectName: ((id: string) => string) | null;
  onOpen: (item: InboxItem) => void;
}

export function ToJudge({ waiting, running, projectName, onOpen }: Props) {
  if (waiting === null) return <aside className="to-judge muted">{t("nav.home.loading")}</aside>;
  const tag = (item: InboxItem) => projectName?.(item.project);
  const key = (item: InboxItem) => `${item.project}/${item.story.story}`;
  return (
    <aside className="to-judge">
      <h3>{t("nav.home.judge", { n: waiting.length })}</h3>
      {waiting.length === 0 && <p className="muted">{t("nav.home.nothing")}</p>}
      {waiting.map((item) => {
        const decide = item.story.group === "blocked";
        return <StoryCard key={key(item)} story={item.story} project={tag(item)} action={decide ? t("nav.home.decide") : t("nav.home.review")} primary={decide} onOpen={() => onOpen(item)} />;
      })}
      {running.length > 0 && (
        <>
          <h3 className="group-title">{t("project.group.active")}</h3>
          {running.map((item) => (
            <StoryCard key={key(item)} story={item.story} project={tag(item)} onOpen={() => onOpen(item)} />
          ))}
        </>
      )}
    </aside>
  );
}
