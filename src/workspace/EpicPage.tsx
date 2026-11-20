// La page d'un epic : son intention, ses critères, ses stories en voies et le coût mesuré. « + Story » est l'action
// de cet objet.
import { useState } from "react";
import type { Api, EpicStoryView, EpicView } from "../shared/api.ts";
import { PlaceHeader } from "../shared/PlaceHeader.tsx";
import { t } from "../i18n/i18n.ts";
import { AddStoryDialog } from "./AddStoryDialog.tsx";
import { EpicLanes } from "./EpicLanes.tsx";
import { EpicProgress } from "./EpicProgress.tsx";
import { megas } from "./epicState.ts";
import "./workspace.css";

interface Props {
  api: Api;
  workspace: string;
  projects: readonly string[];
  epic: EpicView;
  projectName: (id: string) => string;
  onChanged: () => void;
  onOpenStory: (s: EpicStoryView) => void;
}

export function EpicPage({ api, workspace, projects, epic, projectName, onChanged, onOpenStory }: Props) {
  const [adding, setAdding] = useState(false);
  const measured = epic.stories.flatMap((s) => (s.metrics ? [s.metrics] : []));
  const sum = (k: "duration_min" | "interventions" | "cache_read") => measured.reduce((a, m) => a + m[k], 0);
  return (
    <>
      <PlaceHeader
        title={
          <>
            <span className="muted">{epic.id}</span> {epic.title}
          </>
        }
        subtitle={<EpicProgress epic={epic} />}
      >
        <button className="btn primary" onClick={() => setAdding(true)} disabled={projects.length === 0}>
          {t("nav.epic.addStory")}
        </button>
      </PlaceHeader>
      <div className="scroll">
        {epic.acceptance.length > 0 && (
          <ul className="acceptance-list muted">
            {epic.acceptance.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
        <EpicLanes epic={epic} projectName={projectName} onOpen={onOpenStory} />
        {measured.length > 0 && <p className="muted">{t("workspace.metrics.epic", { min: sum("duration_min"), n: sum("interventions"), cache: megas(sum("cache_read")) })}</p>}
      </div>
      {adding && (
        <AddStoryDialog
          api={api}
          workspace={workspace}
          projects={projects}
          epic={epic}
          projectName={projectName}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}
