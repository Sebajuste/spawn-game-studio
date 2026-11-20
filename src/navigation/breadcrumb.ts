// Le fil d'Ariane (docs/navigation.md §5) : seul geste de retour. Chaque segment mène à sa route, sauf le dernier, qui
// est l'écran ouvert. Les libellés sont fournis par l'appelant : ce module reste pur (testé sans React ni langue).
import { projectRoute, workspaceRoute, type Place, type Route } from "./route.ts";

export interface Crumb {
  label: string;
  route: Route | null;
}

export interface Names {
  project(id: string): string;
  workspace(id: string): string;
  epic(workspace: string, id: string): string;
}

export function crumbs(route: Route, names: Names, placeLabel: (place: Place) => string): Crumb[] {
  const list: Crumb[] = [];
  if (route.kind === "workspace") {
    list.push({ label: names.workspace(route.workspace), route: workspaceRoute(route.workspace) });
    list.push({ label: placeLabel(route.place), route: workspaceRoute(route.workspace, route.place) });
    if (route.epic) list.push({ label: names.epic(route.workspace, route.epic), route: null });
  } else if (route.kind === "project") {
    if (route.workspace) list.push({ label: names.workspace(route.workspace), route: workspaceRoute(route.workspace) });
    list.push({ label: names.project(route.project), route: projectRoute(route.project, route.workspace) });
    list.push({ label: placeLabel(route.place), route: projectRoute(route.project, route.workspace, route.place) });
    if (route.story) list.push({ label: route.story, route: null });
  }
  const last = list.at(-1);
  if (last) last.route = null;
  return list;
}
