// Lieu « Backlog » d'un projet (docs/navigation.md §4) : les stories ouvertes par groupe, les livrées et les fermées en
// filtres, et « + Nouvelle feature », la seule création du projet.
import { useMemo, useState } from "react";
import type { Api, StoryGroup, StoryView } from "../shared/api.ts";
import { PlaceHeader } from "../shared/PlaceHeader.tsx";
import { t } from "../i18n/i18n.ts";
import { BacklogFilters } from "./BacklogFilters.tsx";
import { countByFilter, filterBacklog, type BacklogFilter } from "./backlogFilter.ts";
import { EndedTable } from "./EndedTable.tsx";
import { NewFeatureForm } from "./NewFeatureForm.tsx";
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
  composing: boolean;
  onCompose: (open: boolean) => void;
  onOpen: (story: string) => void;
}

function subtitleOf(n: number): string {
  return n === 0 ? t("nav.backlog.subtitle.zero") : t(n === 1 ? "nav.backlog.subtitle.one" : "nav.backlog.subtitle.other", { n });
}

export function ProjectBacklog({ api, project, stories, composing, onCompose, onOpen }: Props) {
  const [filter, setFilter] = useState<BacklogFilter>("open");
  const [search, setSearch] = useState("");
  const all = useMemo(() => stories ?? [], [stories]);
  const counts = useMemo(() => countByFilter(all), [all]);
  const list = useMemo(() => filterBacklog(all, filter, search), [all, filter, search]);

  return (
    <>
      <PlaceHeader title={t("nav.place.backlog")} subtitle={stories && subtitleOf(counts.open)}>
        {!composing && (
          <button className="btn primary" onClick={() => onCompose(true)} title="Ctrl+Maj+N">
            {t("nav.backlog.newFeature")}
          </button>
        )}
      </PlaceHeader>
      <div className="scroll">
        {composing && (
          <NewFeatureForm
            api={api}
            project={project}
            onCancel={() => onCompose(false)}
            onCreated={(story) => {
              onCompose(false);
              onOpen(story);
            }}
          />
        )}
        {stories === null ? (
          <p className="muted">{t("nav.inbox.loading")}</p>
        ) : all.length === 0 ? (
          !composing && (
            <section className="card prompt" onClick={() => onCompose(true)}>
              <h2>{t("nav.backlog.firstTitle")}</h2>
              <p>{t("nav.backlog.firstBody")}</p>
            </section>
          )
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
                        <StoryCard key={s.story} story={s} onOpen={() => onOpen(s.story)} />
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
