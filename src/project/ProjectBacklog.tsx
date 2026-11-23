// Lieu « Backlog » d'un projet (docs/navigation.md §4) : les stories ouvertes par groupe, les livrées et les fermées en
// filtres. Rien ne s'y crée : on demande dans la conversation de l'Accueil (docs/conversation.md). Les stories ouvertes se
// rangent en glissant dans leur groupe : cet ordre décide laquelle démarre quand une place se libère (docs/reglages.md §3.2).
import { useMemo, useState } from "react";
import type { Api, StoryGroup, StoryView } from "../shared/api.ts";
import { moved } from "../shared/reorder.ts";
import { PlaceHeader } from "../shared/PlaceHeader.tsx";
import { t } from "../i18n/i18n.ts";
import { BacklogFilters } from "./BacklogFilters.tsx";
import { countByFilter, filterBacklog, type BacklogFilter } from "./backlogFilter.ts";
import { EndedTable } from "./EndedTable.tsx";
import { StoryCard } from "./StoryCard.tsx";
import "./project.css";

const OPEN_GROUPS: { id: StoryGroup; title: () => string }[] = [
  { id: "blocked", title: () => t("project.group.blocked") },
  { id: "acceptance", title: () => t("project.group.acceptance") },
  { id: "active", title: () => t("project.group.active") },
];

interface Props {
  api: Api;
  project: string;
  stories: StoryView[] | null;
  onOpen: (story: string) => void;
  // Ctrl+J : l'Accueil, curseur dans la conversation.
  onTalk: () => void;
  onError: (e: string) => void;
}

function subtitleOf(n: number): string {
  return n === 0 ? t("nav.backlog.subtitle.zero") : t(n === 1 ? "nav.backlog.subtitle.one" : "nav.backlog.subtitle.other", { n });
}

export function ProjectBacklog({ api, project, stories, onOpen, onTalk, onError }: Props) {
  const [filter, setFilter] = useState<BacklogFilter>("open");
  const [search, setSearch] = useState("");
  const all = useMemo(() => stories ?? [], [stories]);
  const counts = useMemo(() => countByFilter(all), [all]);
  const list = useMemo(() => filterBacklog(all, filter, search), [all, filter, search]);
  const [dragged, setDragged] = useState<string | null>(null);
  // Tout l'ordre ouvert est envoyé : le service range le Backlog entier d'après cette liste.
  const drop = (target: string) => {
    if (!dragged || dragged === target) return setDragged(null);
    const open = all.filter((s) => s.group !== "history").map((s) => s.story);
    setDragged(null);
    api.call("PUT", `/api/projects/${project}/backlog/order`, { stories: moved(open, dragged, target) }).catch((e: Error) => onError(e.message));
  };

  return (
    <>
      <PlaceHeader title={t("nav.place.backlog")} subtitle={stories && subtitleOf(counts.open)}>
        <button className="btn" onClick={onTalk} title="Ctrl+J">
          {t("nav.backlog.talk")}
        </button>
      </PlaceHeader>
      <div className="scroll">
        {stories === null ? (
          <p className="muted">{t("nav.home.loading")}</p>
        ) : all.length === 0 ? (
          <section className="card prompt" onClick={onTalk}>
            <h2>{t("nav.backlog.firstTitle")}</h2>
            <p>{t("nav.backlog.firstBody")}</p>
          </section>
        ) : (
          <>
            <div className="backlog-tools">
              <BacklogFilters value={filter} counts={counts} onChange={setFilter} />
              {filter !== "open" && <input className="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("nav.backlog.search")} />}
            </div>
            {filter === "open" ? (
              list.length === 0 ? (
                <p className="muted">{t("nav.backlog.noneOpen")}</p>
              ) : (
                OPEN_GROUPS.map(({ id, title }) => {
                  const group = list.filter((s) => s.group === id);
                  if (group.length === 0) return null;
                  return (
                    <section key={id}>
                      <h3 className="group-title">{title()}</h3>
                      {group.map((s) => (
                        <div
                          key={s.story}
                          draggable
                          className={dragged === s.story ? "dragging" : ""}
                          onDragStart={() => setDragged(s.story)}
                          onDragEnd={() => setDragged(null)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            // Seulement dans son groupe : l'ordre entre groupes dit l'état, pas la priorité.
                            if (all.find((x) => x.story === dragged)?.group === id) drop(s.story);
                            else setDragged(null);
                          }}
                        >
                          <StoryCard story={s} onOpen={() => onOpen(s.story)} />
                        </div>
                      ))}
                    </section>
                  );
                })
              )
            ) : list.length === 0 ? (
              <p className="muted">{search.trim() ? t("project.history.noMatch") : t(filter === "delivered" ? "nav.backlog.noneDelivered" : "nav.backlog.noneClosed")}</p>
            ) : (
              <EndedTable stories={list} onOpen={onOpen} />
            )}
          </>
        )}
      </div>
    </>
  );
}
