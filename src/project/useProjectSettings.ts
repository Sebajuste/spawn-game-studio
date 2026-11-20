// Réglages d'un projet (agent par défaut, modèle local) : lus à l'ouverture, `null` tant qu'ils ne sont pas là.
import { useCallback, useEffect, useState } from "react";
import type { Api, ProjectSettings } from "../shared/api.ts";

export function useProjectSettings(api: Api, project: string) {
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const base = `/api/projects/${encodeURIComponent(project)}/settings`;
  useEffect(() => {
    let live = true;
    api
      .call<ProjectSettings>("GET", base)
      .then((s) => live && setSettings(s))
      .catch(() => live && setSettings(null));
    return () => {
      live = false;
    };
  }, [api, base]);
  const save = useCallback(async (next: ProjectSettings) => setSettings(await api.call<ProjectSettings>("PUT", base, next)), [api, base]);
  return { settings, save };
}
