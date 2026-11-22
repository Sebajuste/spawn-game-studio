// Le registre des projets de la machine ; `null` tant qu'il n'est pas lu (la coque attend avant de juger une adresse).
import { useCallback, useEffect, useState } from "react";
import type { Api, ProjectView } from "../shared/api.ts";

export function useProjects(api: Api, onError: (e: string) => void): { projects: ProjectView[] | null; reload: () => Promise<void> } {
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const reload = useCallback(async () => {
    try {
      setProjects(await api.call<ProjectView[]>("GET", "/api/projects"));
    } catch (e) {
      onError((e as Error).message);
    }
  }, [api, onError]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { projects, reload };
}
