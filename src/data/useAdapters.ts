// Les moteurs que le kit sait mener (`GET /api/adapters`). `useAdapterChoices` : tous, cochés ou non, pour les Réglages
// et les titres ; `useAdapters` : les seuls cochés sur cette machine, pour les choix de Nouveau projet et d'adoption.
import { useEffect, useMemo, useState } from "react";
import type { AdapterChoice, AdapterInfo, Api } from "../shared/api.ts";

export function useAdapterChoices(api: Api): [AdapterChoice[] | null, (a: AdapterChoice[]) => void] {
  const [adapters, setAdapters] = useState<AdapterChoice[] | null>(null);
  useEffect(() => {
    let live = true;
    api.call<AdapterChoice[]>("GET", "/api/adapters").then(
      (a) => live && setAdapters(a),
      () => live && setAdapters([]),
    );
    return () => {
      live = false;
    };
  }, [api]);
  return [adapters, setAdapters];
}

export function useAdapters(api: Api): AdapterChoice[] | null {
  const [adapters] = useAdapterChoices(api);
  return useMemo(() => adapters && adapters.filter((a) => a.active), [adapters]);
}

export const engineTitle = (adapters: readonly AdapterInfo[] | null, engine: string | null): string => (engine ? (adapters?.find((a) => a.engine === engine)?.title ?? engine) : "");
