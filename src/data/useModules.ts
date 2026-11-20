// Les modules de l'app (menu Affichage) : le service les pousse à la connexion, puis à chaque changement.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Api, ModuleState } from "../shared/api.ts";

export function useModules(api: Api, events: EventSource | null, onError: (e: string) => void) {
  const [modules, setModules] = useState<ModuleState[]>([]);
  useEffect(() => {
    if (!events) return;
    const onModules = (e: Event) => setModules(JSON.parse((e as MessageEvent<string>).data) as ModuleState[]);
    events.addEventListener("modules", onModules);
    return () => events.removeEventListener("modules", onModules);
  }, [events]);
  const active = useMemo<ReadonlySet<string>>(() => new Set(modules.filter((m) => m.active).map((m) => m.id)), [modules]);
  const toggle = useCallback(
    async (id: string, value: boolean) => {
      try {
        setModules(await api.call<ModuleState[]>("PUT", `/api/modules/${id}`, { active: value }));
      } catch (e) {
        onError((e as Error).message);
      }
    },
    [api, onError],
  );
  return { modules, active, toggle };
}
