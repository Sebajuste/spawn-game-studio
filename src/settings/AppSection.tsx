// Réglages > Application : pour toute l'app, sur cette machine. La langue, et les fonctions facultatives (les modules
// hors socle) avec ce qu'elles font, ou pourquoi l'une est éteinte malgré le choix.
import { getLang, LANGS, setLang, t, type Lang } from "../i18n/i18n.ts";
import type { ModuleState } from "../shared/api.ts";
import { SettingRow } from "./SettingRow.tsx";

export function AppSection({ modules, onToggle }: { modules: ModuleState[]; onToggle: (id: string, active: boolean) => void }) {
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
