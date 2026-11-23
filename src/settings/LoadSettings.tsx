// Réglages > Application > Charge de la machine (docs/reglages.md §3.2) : stories au travail et agents en même temps,
// tous projets confondus, et l'ordre des projets qui décide quelle story en attente démarre. Enregistré aussitôt.
import { useEffect, useState } from "react";
import { t } from "../i18n/i18n.ts";
import type { Api, LoadView } from "../shared/api.ts";
import { moved } from "../shared/reorder.ts";
import { SettingRow } from "./SettingRow.tsx";

interface Props {
  api: Api;
  onError: (e: string) => void;
}

const BOUNDS = { stories: [1, 10], agents: [1, 20] } as const;

export function LoadSettings({ api, onError }: Props) {
  const [load, setLoad] = useState<LoadView | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  useEffect(() => {
    api.call<LoadView>("GET", "/api/load").then(setLoad, (e: Error) => onError(e.message));
  }, [api, onError]);
  if (!load) return null;

  const save = (change: Partial<{ stories: number; agents: number; projects: string[] }>) =>
    api.call<LoadView>("PUT", "/api/load", change).then(setLoad, (e: Error) => onError(e.message));
  const number = (k: "stories" | "agents") => (
    <input
      type="number"
      min={BOUNDS[k][0]}
      max={BOUNDS[k][1]}
      value={load[k]}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isInteger(v) && v >= BOUNDS[k][0] && v <= BOUNDS[k][1]) void save({ [k]: v });
      }}
    />
  );
  const ids = load.projects.map((p) => p.id);

  return (
    <>
      <h4>{t("settings.app.load")}</h4>
      <p className="settings-intro">{t("settings.app.loadIntro")}</p>
      <SettingRow label={t("settings.app.loadStories")} note={t("settings.app.loadStoriesNote")}>
        {number("stories")}
      </SettingRow>
      <SettingRow label={t("settings.app.loadAgents")} note={t("settings.app.loadAgentsNote")}>
        {number("agents")}
      </SettingRow>
      <SettingRow label={t("settings.app.loadOrder")} note={t("settings.app.loadOrderNote")}>
        <ol className="load-order">
          {load.projects.map((p, i) => (
            <li
              key={p.id}
              draggable
              className={dragged === p.id ? "dragging" : ""}
              onDragStart={() => setDragged(p.id)}
              onDragEnd={() => setDragged(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged && dragged !== p.id) void save({ projects: moved(ids, dragged, p.id) });
                setDragged(null);
              }}
            >
              <span className="grip" aria-hidden>
                ⠿
              </span>
              <span>
                {i + 1}. <strong>{p.name}</strong>
              </span>
            </li>
          ))}
        </ol>
      </SettingRow>
    </>
  );
}
