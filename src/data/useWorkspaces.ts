// Les workspaces et leurs epics ; relus à l'événement « workspaces » du service.
import { useCallback, useEffect, useState } from "react";
import type { Api, WorkspaceView } from "../shared/api.ts";

export function useWorkspaces(api: Api, events: EventSource | null, onError: (e: string) => void): { workspaces: WorkspaceView[] | null; reload: () => Promise<void> } {
  const [workspaces, setWorkspaces] = useState<WorkspaceView[] | null>(null);
  const reload = useCallback(async () => {
    try {
      setWorkspaces(await api.call<WorkspaceView[]>("GET", "/api/workspaces"));
    } catch (e) {
      onError((e as Error).message);
    }
  }, [api, onError]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!events) return;
    const onChange = () => void reload();
    events.addEventListener("workspaces", onChange);
    return () => events.removeEventListener("workspaces", onChange);
  }, [events, reload]);
  return { workspaces, reload };
}
