// Les workspaces et leurs epics ; relus à l'événement « workspaces » du service, et à « stories » : un epic porte
// l'état de ses stories.
import { useCallback, useEffect, useState } from "react";
import type { Api, WorkspaceView } from "../shared/api.ts";
import { newestResponse } from "./newest.ts";

const EVENTS = ["workspaces", "stories"];

export function useWorkspaces(api: Api, events: EventSource | null, onError: (e: string) => void): { workspaces: WorkspaceView[] | null; reload: () => Promise<void> } {
  const [workspaces, setWorkspaces] = useState<WorkspaceView[] | null>(null);
  const [request] = useState(newestResponse);
  const reload = useCallback(async () => {
    const isNewer = request();
    try {
      const workspaces = await api.call<WorkspaceView[]>("GET", "/api/workspaces");
      if (isNewer()) setWorkspaces(workspaces);
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
    for (const name of EVENTS) events.addEventListener(name, onChange);
    return () => {
      for (const name of EVENTS) events.removeEventListener(name, onChange);
    };
  }, [events, reload]);
  return { workspaces, reload };
}
