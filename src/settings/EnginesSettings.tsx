// Réglages > Application > Moteurs (docs/reglages.md §3.1) : une case par adaptateur présent. Décocher ne retire rien :
// les projets inscrits continuent de fonctionner, leur nombre le rappelle. La dernière case cochée reste cochée.
import { t } from "../i18n/i18n.ts";
import type { AdapterChoice, Api } from "../shared/api.ts";

interface Props {
  api: Api;
  adapters: AdapterChoice[] | null;
  onChanged: (adapters: AdapterChoice[]) => void;
  onError: (e: string) => void;
}

const projectsText = (n: number) => (n === 0 ? t("settings.app.engineProjects.zero") : n === 1 ? t("settings.app.engineProjects.one") : t("settings.app.engineProjects.other", { count: n }));

export function EnginesSettings({ api, adapters, onChanged, onError }: Props) {
  const checked = (adapters ?? []).filter((a) => a.active).length;
  const toggle = (a: AdapterChoice) =>
    api.call<AdapterChoice[]>("PUT", `/api/adapters/${a.engine}`, { active: !a.active }).then(onChanged, (e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  return (
    <>
      <h4>{t("settings.app.engines")}</h4>
      <p className="settings-intro">{t("settings.app.enginesIntro")}</p>
      {(adapters ?? []).map((a) => {
        const last = a.active && checked === 1;
        return (
          <label key={a.engine} className="setting-module">
            <input type="checkbox" checked={a.active} disabled={last} onChange={() => void toggle(a)} />
            <span>
              <strong>{a.title}</strong>
              <small>{[a.product, projectsText(a.projects), ...(last ? [t("settings.app.engineLast")] : [])].filter(Boolean).join(" · ")}</small>
            </span>
          </label>
        );
      })}
    </>
  );
}
