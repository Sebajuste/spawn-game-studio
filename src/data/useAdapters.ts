// Les moteurs que le kit sait mener (`GET /api/adapters`) : leur nom pour les choix, leur titre pour l'affichage.
import { useEffect, useState } from "react";
import type { AdapterInfo, Api } from "../shared/api.ts";

export function useAdapters(api: Api): AdapterInfo[] | null {
  const [adapters, setAdapters] = useState<AdapterInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    api.call<AdapterInfo[]>("GET", "/api/adapters").then(
      (a) => live && setAdapters(a),
      () => live && setAdapters([]),
    );
    return () => {
      live = false;
    };
  }, [api]);
  return adapters;
}

export const engineTitle = (adapters: readonly AdapterInfo[] | null, engine: string | null): string => (engine ? (adapters?.find((a) => a.engine === engine)?.title ?? engine) : "");
