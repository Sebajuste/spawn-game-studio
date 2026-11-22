// Une adresse peut nommer un projet, un workspace ou un epic qui n'existe plus (lien ancien, registre changé) : elle est
// ramenée à l'écran valide le plus proche, et `gone` dit à la coque de l'annoncer dans le sélecteur.
import { projectRoute, workspaceRoute, type Route } from "./route.ts";

export interface Known {
  projects: ReadonlySet<string>;
  workspaces: ReadonlyMap<string, { projects: readonly string[]; epics: readonly string[] }>;
}

export function resolveRoute(route: Route, known: Known): { route: Route; gone: boolean } {
  const picker = { route: { kind: "picker" } as Route, gone: true };
  if (route.kind === "picker") return { route, gone: false };
  if (route.kind === "workspace") {
    const ws = known.workspaces.get(route.workspace);
    if (!ws) return picker;
    if (route.epic && !ws.epics.includes(route.epic)) return { route: workspaceRoute(route.workspace, "epics"), gone: false };
    return { route, gone: false };
  }
  if (!known.projects.has(route.project)) return picker;
  // Un parent disparu, ou qui ne contient plus le projet, est retiré : le projet s'ouvre seul.
  const parent = route.workspace ? known.workspaces.get(route.workspace) : undefined;
  if (route.workspace && !parent?.projects.includes(route.project)) return { route: projectRoute(route.project, null, route.place, route.story), gone: false };
  return { route, gone: false };
}
