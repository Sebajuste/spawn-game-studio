// Échap pour ce qui est au-dessus de tout (menu ⋯, confirmation) : écouté avant la coque (phase de capture) et
// arrêté là, sinon la coque fermerait aussi la fenêtre du dessous (useShortcuts ferme le dialogue ouvert sur Échap).
import { useEffect } from "react";

export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onEscape();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, onEscape]);
}
