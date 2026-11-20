// Toute la navigation tient dans une adresse (docs/navigation.md §8) : la portée (projet ou workspace), le lieu, et
// l'objet ouvert. Lire et écrire l'adresse ici seulement : un lien, une capture de recette ou le retour arrière
// redonnent exactement le même écran.

export type ProjectPlace = "inbox" | "backlog";
export type WorkspacePlace = "inbox" | "epics" | "projects";
export type Place = ProjectPlace | WorkspacePlace;

export type ProjectRoute = { kind: "project"; workspace: string | null; project: string; place: ProjectPlace; story: string | null };
export type WorkspaceRoute = { kind: "workspace"; workspace: string; place: WorkspacePlace; epic: string | null };
export type Route = { kind: "picker" } | ProjectRoute | WorkspaceRoute;

const PROJECT_PLACES: readonly string[] = ["inbox", "backlog"] satisfies ProjectPlace[];
const WORKSPACE_PLACES: readonly string[] = ["inbox", "epics", "projects"] satisfies WorkspacePlace[];

export const projectRoute = (project: string, workspace: string | null = null, place: ProjectPlace = "inbox", story: string | null = null): ProjectRoute => ({ kind: "project", workspace, project, place, story });
export const workspaceRoute = (workspace: string, place: WorkspacePlace = "inbox", epic: string | null = null): WorkspaceRoute => ({ kind: "workspace", workspace, place, epic });

function decode(segment: string | undefined): string | null {
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

// `#/p/<p>[/<lieu>[/s/<story>]]` ; `parent` est le workspace par lequel on est arrivé.
function parseProject(parts: string[], parent: string | null): Route | null {
  const project = decode(parts[0]);
  if (!project) return null;
  const place = parts[1] ?? "inbox";
  if (!PROJECT_PLACES.includes(place)) return null;
  if (parts.length === 2 || parts.length === 1) return projectRoute(project, parent, place as ProjectPlace);
  const story = parts[2] === "s" ? decode(parts[3]) : null;
  if (!story || parts.length !== 4) return null;
  return projectRoute(project, parent, place as ProjectPlace, story);
}

export function parseRoute(hash: string): Route | null {
  const path = hash.replace(/^#/, "");
  if (!path.startsWith("/")) return null;
  const parts = path.slice(1).split("/").filter((p) => p !== "");
  if (parts[0] === "pick" && parts.length === 1) return { kind: "picker" };
  if (parts[0] === "p") return parseProject(parts.slice(1), null);
  if (parts[0] !== "w") return null;
  const workspace = decode(parts[1]);
  if (!workspace) return null;
  if (parts[2] === "p") return parseProject(parts.slice(3), workspace);
  const place = parts[2] ?? "inbox";
  if (!WORKSPACE_PLACES.includes(place)) return null;
  if (parts.length <= 3) return workspaceRoute(workspace, place as WorkspacePlace);
  // Seuls les epics ont une page à eux dans un workspace.
  if (place !== "epics" || parts.length !== 4) return null;
  const epic = decode(parts[3]);
  return epic ? workspaceRoute(workspace, "epics", epic) : null;
}

const enc = encodeURIComponent;

export function formatRoute(route: Route): string {
  if (route.kind === "picker") return "#/pick";
  if (route.kind === "workspace") {
    const base = `#/w/${enc(route.workspace)}`;
    if (route.epic) return `${base}/epics/${enc(route.epic)}`;
    return route.place === "inbox" ? base : `${base}/${route.place}`;
  }
  const base = route.workspace ? `#/w/${enc(route.workspace)}/p/${enc(route.project)}` : `#/p/${enc(route.project)}`;
  if (route.story) return `${base}/${route.place}/s/${enc(route.story)}`;
  return route.place === "inbox" ? base : `${base}/${route.place}`;
}

// Ancien format des liens (`#workspace=<id>&project=<id>`), encore lu pour les liens et captures existants.
export function legacyRoute(hash: string): Route | null {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const workspace = q.get("workspace");
  const project = q.get("project");
  if (project) return projectRoute(project, workspace);
  if (workspace) return workspaceRoute(workspace);
  return null;
}

export function sameRoute(a: Route, b: Route): boolean {
  return formatRoute(a) === formatRoute(b);
}
