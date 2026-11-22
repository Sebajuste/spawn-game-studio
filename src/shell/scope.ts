// La portée de l'adresse : les projets qu'elle couvre (backlogs à charger) et ce que montre son bloc.
import { t } from "../i18n/i18n.ts";
import type { ProjectView, WorkspaceView } from "../shared/api.ts";
import type { Route } from "../navigation/route.ts";
import type { Scope } from "./ScopeBlock.tsx";

export function scopeProjects(route: Route, workspaces: readonly WorkspaceView[]): string[] {
  if (route.kind === "project") return [route.project];
  if (route.kind === "workspace") return workspaces.find((w) => w.id === route.workspace)?.projects ?? [];
  return [];
}

export function scopeOf(route: Route, project: ProjectView | null, workspace: WorkspaceView | null, parent: WorkspaceView | null): Scope | null {
  if (route.kind === "workspace" && workspace) {
    const n = workspace.projects.length;
    return { name: workspace.name, line: t(n === 1 ? "nav.scope.workspace.one" : "nav.scope.workspace.other", { n }), workspace: true };
  }
  if (route.kind === "project" && project) {
    const engine = project.problem ?? `${project.engine ?? ""} ${project.version ?? ""}`.trim();
    const line = parent ? [t("nav.scope.in", { name: parent.name }), engine].filter(Boolean).join(" · ") : engine;
    return { name: project.name, line, workspace: false };
  }
  return null;
}
