// Ce que « Aller à » (Ctrl+K) propose dans la portée : ses stories, et ses epics dans un workspace. Chaque entrée porte
// l'adresse où elle mène, pour qu'aller à un objet passe par le même chemin que tout le reste.
import type { EpicView, StoryView } from "../shared/api.ts";
import { projectRoute, workspaceRoute, type Route } from "./route.ts";

export interface GoToEntry {
  key: string;
  label: string;
  detail: string;
  search: string;
  route: Route;
}

export function goToEntries(
  scopeProjects: readonly string[],
  backlogs: ReadonlyMap<string, StoryView[] | null>,
  workspace: { id: string; epics: readonly EpicView[] } | null,
  projectName: (id: string) => string,
  describe: (s: StoryView) => string,
): GoToEntry[] {
  const stories = scopeProjects.flatMap((p) =>
    (backlogs.get(p) ?? []).map((s) => ({
      key: `s:${p}/${s.story}`,
      label: s.title,
      detail: workspace ? `${projectName(p)} · ${describe(s)}` : describe(s),
      search: `${s.title} ${s.request ?? ""} ${s.story} ${p}`.toLowerCase(),
      route: projectRoute(p, workspace?.id ?? null, s.group === "blocked" || s.group === "acceptance" ? "home" : "backlog", s.story),
    })),
  );
  const epics: GoToEntry[] = workspace
    ? workspace.epics.map((e) => ({ key: `e:${e.id}`, label: e.title, detail: "epic", search: `${e.title} ${e.id}`.toLowerCase(), route: workspaceRoute(workspace.id, "epics", e.id) }))
    : [];
  return [...epics, ...stories];
}

export function matchEntries(entries: readonly GoToEntry[], text: string, max = 12): GoToEntry[] {
  const q = text.trim().toLowerCase();
  return entries.filter((e) => !q || e.search.includes(q)).slice(0, max);
}
