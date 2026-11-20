// Les lieux de la portée, dans leur ordre fixe, chacun avec son raccourci ; l'Accueil porte le nombre de cartes à juger.
import { t } from "../i18n/i18n.ts";
import type { Place } from "../navigation/route.ts";
import { placeLabel } from "./placeLabel.ts";

export function PlaceList({ places, current, badge, onPick }: { places: Place[]; current: Place | null; badge: number; onPick: (place: Place) => void }) {
  return (
    <nav className="places" aria-label={t("nav.places")}>
      {places.map((p, i) => (
        <button key={p} className={`place ${p === current ? "current" : ""}`} aria-current={p === current ? "page" : undefined} onClick={() => onPick(p)}>
          {placeLabel(p)}
          {p === "home" && badge > 0 && <span className="badge">{badge}</span>}
          <kbd>Ctrl+{i + 1}</kbd>
        </button>
      ))}
    </nav>
  );
}
