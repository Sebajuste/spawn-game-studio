// Ce qui attend l'utilisateur et ce qui tourne, sur un projet ou sur tous les projets d'un workspace
// (docs/navigation.md §4, À traiter ; §7, barre d'état). Lu dans les backlogs déjà chargés : aucun appel de plus.
import type { StoryView } from "../shared/api.ts";

export interface InboxItem {
  project: string;
  story: StoryView;
}

export type Backlogs = ReadonlyMap<string, StoryView[] | null>;

function pick(backlogs: Backlogs, projects: readonly string[], keep: (s: StoryView) => boolean): InboxItem[] {
  return projects.flatMap((project) => (backlogs.get(project) ?? []).filter(keep).map((story) => ({ project, story })));
}

// Décisions d'abord (rien n'avance sans l'utilisateur), puis les recettes.
export function waitingFor(backlogs: Backlogs, projects: readonly string[]): InboxItem[] {
  return [...pick(backlogs, projects, (s) => s.group === "blocked"), ...pick(backlogs, projects, (s) => s.group === "acceptance")];
}

export function inProgress(backlogs: Backlogs, projects: readonly string[]): InboxItem[] {
  return pick(backlogs, projects, (s) => s.group === "active");
}

// Les agents au travail en ce moment (barre d'état).
export function working(backlogs: Backlogs, projects: readonly string[]): InboxItem[] {
  return pick(backlogs, projects, (s) => s.running);
}
