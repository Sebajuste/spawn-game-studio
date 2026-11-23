// Charge de la machine (docs/reglages.md §3.2) : réglages, stories au travail et en attente, agents en cours. Lue par la
// barre d'état et la page d'une story en attente ; rechargée quand une story démarre, finit ou change de place.
import { useCallback, useEffect, useState } from "react";
import type { Api, LoadView } from "../shared/api.ts";

const EVENTS = ["load", "conversation-end", "stories"];

export function useLoad(api: Api, events: EventSource | null, enabled: boolean): { load: LoadView | null; reload: () => Promise<void> } {
  const [load, setLoad] = useState<LoadView | null>(null);
  const reload = useCallback(async () => {
    if (!enabled) return setLoad(null);
    try {
      setLoad(await api.call<LoadView>("GET", "/api/load"));
    } catch {
      // Service ancien ou module éteint : la barre d'état n'affiche simplement pas la charge.
      setLoad(null);
    }
  }, [api, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!events) return;
    const onChange = () => void reload();
    for (const name of EVENTS) events.addEventListener(name, onChange);
    return () => {
      for (const name of EVENTS) events.removeEventListener(name, onChange);
    };
  }, [events, reload]);

  return { load, reload };
}
