// Le flux d'événements du service, ouvert une fois pour toute la fenêtre ; `connected` nourrit la barre d'état.
import { useEffect, useState } from "react";
import type { Api } from "../shared/api.ts";

export function useEvents(api: Api): { events: EventSource | null; connected: boolean } {
  const [events, setEvents] = useState<EventSource | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const source = api.events();
    // EventSource se reconnecte seul : on ne fait que dire où il en est.
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(source.readyState === EventSource.OPEN);
    setEvents(source);
    return () => source.close();
  }, [api]);
  return { events, connected };
}
