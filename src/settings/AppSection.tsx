// Réglages > Application : pour toute l'app, sur cette machine. La langue, les moteurs proposés, et les fonctions
// facultatives (les modules hors socle) avec ce qu'elles font, ou pourquoi l'une est éteinte malgré le choix.
import { getLang, LANGS, setLang, t, type Lang } from "../i18n/i18n.ts";
import type { AdapterChoice, Api, ModuleState } from "../shared/api.ts";
import { EnginesSettings } from "./EnginesSettings.tsx";
import { SettingRow } from "./SettingRow.tsx";

interface Props {
  api: Api;
  modules: ModuleState[];
  onToggle: (id: string, active: boolean) => void;
  adapters: AdapterChoice[] | null;
  onAdapters: (a: AdapterChoice[]) => void;
  onError: (e: string) => void;
}

export function AppSection({ api, modules, onToggle, adapters, onAdapters, onError }: Props) {
  const optional = modules.filter((m) => !m.core);
  return (
    <>
      <h3>{t("settings.app.title")}</h3>
      <p className="settings-intro">{t("settings.app.intro")}</p>
      <SettingRow label={t("settings.app.language")}>
        <select value={getLang()} onChange={(e) => setLang(e.target.value as Lang)}>
          {LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <EnginesSettings api={api} adapters={adapters} onChanged={onAdapters} onError={onError} />
      <h4>{t("settings.app.modules")}</h4>
      {optional.length === 0 && <p className="muted">{t("settings.app.noModules")}</p>}
      {optional.map((m) => (
        <label key={m.id} className="setting-module">
          <input type="checkbox" checked={m.active} disabled={m.reason !== null} onChange={() => onToggle(m.id, !m.active)} />
          <span>
            <strong>{m.title}</strong>
            <small>{m.reason ? t("settings.app.unavailable", { reason: m.reason }) : m.description}</small>
          </span>
        </label>
      ))}
    </>
  );
}
