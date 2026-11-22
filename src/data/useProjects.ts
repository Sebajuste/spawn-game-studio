// Le registre des projets de la machine, relu à l'événement « projects » du service ; `null` tant
// qu'il n'est pas lu (la coque attend avant de juger une adresse).
import { useCallback, useEffect, useState } from "react";
import type { Api, ProjectView } from "../shared/api.ts";
import { newestResponse } from "./newest.ts";

export function useProjects(api: Api, events: EventSource | null, onError: (e: string) => void): { projects: ProjectView[] | null; reload: () => Promise<void> } {
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [request] = useState(newestResponse);
  const reload = useCallback(async () => {
    const isNewer = request();
    try {
      const projects = await api.call<ProjectView[]>("GET", "/api/projects");
      if (isNewer()) setProjects(projects);
    } catch (e) {
      onError((e as Error).message);
    }
  }, [api, onError, request]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!events) return;
    const onChange = () => void reload();
    events.addEventListener("projects", onChange);
    return () => events.removeEventListener("projects", onChange);
  }, [events, reload]);
  return { projects, reload };
}
