// Les sections de la fenêtre Réglages (docs/reglages.md §3) : l'Application toujours ; le Workspace si la portée en est
// un, ou un projet ouvert dans un workspace ; le Projet si la portée est un projet.
import type { Route } from "../navigation/route.ts";

export type SettingsSection = "app" | "workspace" | "project";

export interface SettingsScope {
  workspace: string | null;
  project: string | null;
}

export function settingsScope(route: Route): SettingsScope {
  if (route.kind === "picker") return { workspace: null, project: null };
  return { workspace: route.workspace, project: route.kind === "project" ? route.project : null };
}

export function sectionsOf(scope: SettingsScope): SettingsSection[] {
  return ["app", ...(scope.workspace ? (["workspace"] as const) : []), ...(scope.project ? (["project"] as const) : [])];
}

// La section demandée si elle existe pour cette portée, l'Application sinon.
export function openingSection(asked: SettingsSection, scope: SettingsScope): SettingsSection {
  return sectionsOf(scope).includes(asked) ? asked : "app";
}
