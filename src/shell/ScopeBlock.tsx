// Le bloc de portée en haut de la barre de gauche (docs/navigation.md §3) : ce qu'on regarde, et un clic pour en changer.
// Pour un projet, ▶ Lancer à côté.
import { t } from "../i18n/i18n.ts";

export interface Scope {
  name: string;
  line: string;
  workspace: boolean;
}

export function ScopeBlock({ scope, onOpen, onLaunch }: { scope: Scope | null; onOpen: () => void; onLaunch: (() => void) | null }) {
  return (
    <div className="scope">
      <button className="scope-button" onClick={onOpen} title={t("nav.scope.change")}>
        {scope && <span className={`logo ${scope.workspace ? "ws" : ""}`}>{scope.name.charAt(0).toUpperCase()}</span>}
        <span className="scope-text">
          <strong>{scope ? scope.name : t("nav.scope.none")}</strong>
          {scope && <small>{scope.line}</small>}
        </span>
        <span className="chevron">▾</span>
      </button>
      {onLaunch && (
        <button className="scope-launch" onClick={onLaunch} title={t("nav.scope.launch")}>
          ▶
        </button>
      )}
    </div>
  );
}
