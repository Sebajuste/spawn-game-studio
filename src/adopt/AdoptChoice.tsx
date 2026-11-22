// La barre de choix du diagnostic : moteur (un adaptateur du kit ; le changer refait le diagnostic), version (celles
// configurées sur la machine en suggestion), préfixe d'exigences.
import type { AdapterInfo } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";
import type { Choice } from "./useAdoption.ts";

interface Props {
  adapters: AdapterInfo[] | null;
  choice: Choice;
  versions: string[];
  disabled: boolean;
  onChange: (c: Choice) => void;
  onEngine: (engine: string) => void;
}

export function AdoptChoice({ adapters, choice, versions, disabled, onChange, onEngine }: Props) {
  return (
    <div className="adopt-choice">
      <label>
        {t("adopt.engine")}
        <select value={choice.engine} disabled={disabled} onChange={(e) => onEngine(e.target.value)}>
          {choice.engine === "" && <option value="">{t("adopt.enginePick")}</option>}
          {(adapters ?? []).map((a) => (
            <option key={a.engine} value={a.engine}>
              {a.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("adopt.version")}
        <input value={choice.version} size={6} list="adopt-versions" disabled={disabled} onChange={(e) => onChange({ ...choice, version: e.target.value.trim() })} />
        <datalist id="adopt-versions">
          {versions.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </label>
      <label>
        {t("adopt.tag")}
        <input value={choice.tag} size={6} disabled={disabled} onChange={(e) => onChange({ ...choice, tag: e.target.value.toUpperCase().trim() })} />
      </label>
    </div>
  );
}
