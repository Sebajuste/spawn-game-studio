// Les lieux d'une portée, dans leur ordre fixe (docs/navigation.md §4) : Ctrl+1, Ctrl+2, Ctrl+3 les suivent.
import { projectRoute, workspaceRoute, type Place, type ProjectPlace, type Route, type WorkspacePlace } from "../navigation/route.ts";

const PROJECT: ProjectPlace[] = ["home", "backlog"];
const WORKSPACE: WorkspacePlace[] = ["home", "epics", "projects"];

export function placesOf(route: Route): Place[] {
  if (route.kind === "project") return PROJECT;
  if (route.kind === "workspace") return WORKSPACE;
  return [];
}

// Changer de lieu ferme l'objet ouvert et garde la portée (et son parent).
export function withPlace(route: Route, place: Place): Route {
  if (route.kind === "project" && (PROJECT as Place[]).includes(place)) return projectRoute(route.project, route.workspace, place as ProjectPlace);
  if (route.kind === "workspace" && (WORKSPACE as Place[]).includes(place)) return workspaceRoute(route.workspace, place as WorkspacePlace);
  return route;
}

// Le lieu actif, même quand un objet (story, epic) y est ouvert.
export function currentPlace(route: Route): Place | null {
  return route.kind === "picker" ? null : route.place;
}
