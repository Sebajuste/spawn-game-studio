// Les backlogs des projets de la portée (un projet, ou tous ceux d'un workspace), chargés une fois et partagés par
// À juger (Accueil), le Backlog, le badge, la barre d'état et « Aller à ». Chaque événement ne recharge que son projet.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Api, StoryView } from "../shared/api.ts";
import type { Backlogs } from "./inbox.ts";

const EVENTS = ["stories", "conversation-end", "backlog"];

export function useBacklogs(api: Api, events: EventSource | null, projects: readonly string[], enabled: boolean, onError: (e: string) => void): { backlogs: Backlogs; reload: (project: string) => Promise<void> } {
  const [backlogs, setBacklogs] = useState<Backlogs>(new Map());
  const key = projects.join("\u0000");
  const wanted = useRef<ReadonlySet<string>>(new Set());
  wanted.current = new Set(projects);

  const reload = useCallback(
    async (project: string) => {
      if (!enabled) return;
      try {
        const list = await api.call<StoryView[]>("GET", `/api/projects/${encodeURIComponent(project)}/backlog`);
        // Une réponse arrivée après un changement de portée ne doit pas réapparaître.
        if (wanted.current.has(project)) setBacklogs((m) => new Map(m).set(project, list));
      } catch (e) {
        onError((e as Error).message);
      }
    },
    [api, enabled, onError],
  );

  useEffect(() => {
    const ids = key ? key.split("\u0000") : [];
    setBacklogs((m) => new Map(ids.map((id) => [id, m.get(id) ?? null])));
    for (const id of ids) void reload(id);
  }, [key, reload]);

  useEffect(() => {
    if (!events) return;
    const onChange = (e: Event) => {
      const d = JSON.parse((e as MessageEvent<string>).data) as { project?: string };
      if (d.project && wanted.current.has(d.project)) void reload(d.project);
    };
    for (const name of EVENTS) events.addEventListener(name, onChange);
    return () => {
      for (const name of EVENTS) events.removeEventListener(name, onChange);
    };
  }, [events, reload]);

  return { backlogs, reload };
}
