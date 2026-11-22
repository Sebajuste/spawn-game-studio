// Le bloc de portée en haut de la barre de gauche (docs/navigation.md §3, docs/reglages.md §5) : ce qu'on regarde ; un
// clic ouvre son menu (changer de portée, ses réglages). Pour un projet, ▶ Lancer à côté.
import { t } from "../i18n/i18n.ts";
import { MenuButton, type MenuItem } from "../shared/MenuButton.tsx";

export interface Scope {
  name: string;
  line: string;
  workspace: boolean;
}

interface Props {
  scope: Scope | null;
  onChange: () => void;
  onSettings: () => void;
  onLaunch: (() => void) | null;
}

export function ScopeBlock({ scope, onChange, onSettings, onLaunch }: Props) {
  const items: MenuItem[] = [{ title: t("nav.scope.change"), shortcut: "Ctrl+P", action: onChange }];
  if (scope) items.push("-", { title: scope.workspace ? t("menu.workspace.settings") : t("menu.project.settings"), action: onSettings });
  return (
    <div className="scope">
      <MenuButton
        items={items}
        align="left"
        className="scope-button"
        title={t("nav.scope.menu")}
        trigger={
          <>
            {scope && <span className={`logo ${scope.workspace ? "ws" : ""}`}>{scope.name.charAt(0).toUpperCase()}</span>}
            <span className="scope-text">
              <strong>{scope ? scope.name : t("nav.scope.none")}</strong>
              {scope && <small>{scope.line}</small>}
            </span>
            <span className="chevron">▾</span>
          </>
        }
      />
      {onLaunch && (
        <button className="scope-launch" onClick={onLaunch} title={t("nav.scope.launch")}>
          ▶
        </button>
      )}
    </div>
  );
}
