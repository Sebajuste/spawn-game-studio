// Écran du premier lancement (docs/navigation.md §3) : le seul sans barre de gauche, tant qu'aucun projet ni workspace
// n'existe.
import { t } from "../i18n/i18n.ts";

export function FirstRun({ onNew, onOpen }: { onNew: () => void; onOpen: () => void }) {
  return (
    <main className="first-run">
      <div>
        <h1>Spawn App Studio</h1>
        <p className="muted">{t("nav.firstRun.tagline")}</p>
        <div className="big-buttons">
          <button onClick={onNew}>
            <strong>{t("nav.firstRun.new")}</strong>
            <span className="muted">Ctrl+N</span>
          </button>
          <button onClick={onOpen}>
            <strong>{t("nav.firstRun.open")}</strong>
            <span className="muted">{t("nav.firstRun.openHint")}</span>
          </button>
        </div>
      </div>
    </main>
  );
}
