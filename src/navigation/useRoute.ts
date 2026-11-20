// La route courante, tenue par le hash de l'URL : l'historique du navigateur porte le retour arrière (Alt+←), et la
// dernière adresse est retenue pour la rouvrir au démarrage (docs/navigation.md §8).
import { useCallback, useEffect, useState } from "react";
import { formatRoute, legacyRoute, parseRoute, projectRoute, type Route } from "./route.ts";

const ROUTE_KEY = "spawn.route";
// Clés d'avant l'adresse unique : le dernier projet ouvert. Lues une fois, puis effacées.
const LEGACY_KEYS = ["spawn.game", "spawn.jeu"];

function stored(): Route | null {
  try {
    const saved = localStorage.getItem(ROUTE_KEY);
    if (saved) return parseRoute(saved);
    for (const key of LEGACY_KEYS) {
      const id = localStorage.getItem(key);
      if (id) return projectRoute(id);
    }
  } catch {
    // stockage indisponible : le sélecteur s'ouvre
  }
  return null;
}

function remember(route: Route): void {
  try {
    localStorage.setItem(ROUTE_KEY, formatRoute(route));
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    // stockage indisponible : l'adresse ne sera pas rouverte au prochain démarrage
  }
}

function initial(): Route {
  const hash = window.location.hash;
  return parseRoute(hash) ?? legacyRoute(hash) ?? stored() ?? { kind: "picker" };
}

export function useRoute(): { route: Route; navigate: (route: Route, replace?: boolean) => void } {
  const [route, setRoute] = useState<Route>(initial);

  // L'URL dit toujours l'écran ouvert, même au démarrage depuis la dernière adresse ou un ancien lien.
  useEffect(() => {
    const hash = formatRoute(route);
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
    remember(route);
  }, [route]);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash) ?? legacyRoute(window.location.hash) ?? { kind: "picker" });
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((next: Route, replace = false) => {
    const hash = formatRoute(next);
    if (window.location.hash === hash) return;
    if (replace) window.history.replaceState(null, "", hash);
    else window.history.pushState(null, "", hash);
    setRoute(next);
  }, []);

  return { route, navigate };
}
