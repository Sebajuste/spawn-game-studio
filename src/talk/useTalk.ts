// La conversation d'une portée vue par l'app : lue au service, complétée en direct par le flux d'événements, et ses
// deux gestes (envoyer, arrêter). Une portée a une seule conversation : changer de portée recharge tout.
import { useCallback, useEffect, useState } from "react";
import type { Action } from "../shared/action.ts";
import type { Api, TalkEnd, TalkEvent, TalkScope, TalkTurn, TalkView } from "../shared/api.ts";

export interface Talk {
  view: TalkView | null;
  error: string | null;
  // Vrai si le service a pris le message ; le texte du refus est alors dans `act`.
  send: (message: string) => Promise<boolean>;
  stop: () => Promise<boolean>;
}

export const talkPath = (scope: TalkScope, id: string) => `/api/${scope === "project" ? "projects" : "workspaces"}/${encodeURIComponent(id)}/talk`;

export function useTalk(api: Api, events: EventSource | null, scope: TalkScope, id: string, act: Action): Talk {
  const [view, setView] = useState<TalkView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = talkPath(scope, id);

  const load = useCallback(async () => {
    try {
      setView(await api.call<TalkView>("GET", path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, path]);

  useEffect(() => {
    setView(null);
    void load();
  }, [load]);

  // Les événements d'un tour en cours s'ajoutent à ce tour ; sa fin relit la vue, avec ce que le service a créé.
  useEffect(() => {
    if (!events) return;
    const mine = (d: { scope: TalkScope; id: string }) => d.scope === scope && d.id === id;
    const onEvents = (e: Event) => {
      const d = JSON.parse((e as MessageEvent<string>).data) as TalkEvent;
      if (!mine(d)) return;
      setView((v) => {
        if (!v) return v;
        const turns = v.turns.some((t) => t.n === d.turn) ? v.turns : [...v.turns, emptyTurn(d.turn, v)];
        return { ...v, running: true, turns: turns.map((t) => (t.n === d.turn ? { ...t, events: [...t.events, ...d.events] } : t)) };
      });
    };
    const onEnd = (e: Event) => {
      if (mine(JSON.parse((e as MessageEvent<string>).data) as TalkEnd)) void load();
    };
    events.addEventListener("talk", onEvents);
    events.addEventListener("talk-end", onEnd);
    return () => {
      events.removeEventListener("talk", onEvents);
      events.removeEventListener("talk-end", onEnd);
    };
  }, [events, scope, id, load]);

  const send = (message: string) =>
    act.run("send", async () => {
      await api.call("POST", path, { message });
      await load();
    });
  const stop = () =>
    act.run("stop", async () => {
      await api.call("POST", `${path}/stop`);
      await load();
    });
  return { view, error, send, stop };
}

function emptyTurn(n: number, v: TalkView): TalkTurn {
  return { n, agent: v.agent ?? "claude-code", message: "", start: new Date().toISOString(), end: null, code: null, stopped: false, interrupted: false, refused: [], events: [], actions: [] };
}
