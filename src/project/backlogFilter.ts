// Le Backlog montre les stories ouvertes ; « Livrées » et « Fermées » sont des filtres (ils remplacent l'Historique).
import type { StoryView } from "../shared/api.ts";

export type BacklogFilter = "open" | "delivered" | "closed";

export function filterOf(s: StoryView): BacklogFilter {
  if (s.group !== "history") return "open";
  return s.result === "accepted" ? "delivered" : "closed";
}

export function countByFilter(stories: readonly StoryView[]): Record<BacklogFilter, number> {
  const n: Record<BacklogFilter, number> = { open: 0, delivered: 0, closed: 0 };
  for (const s of stories) n[filterOf(s)] += 1;
  return n;
}

export function filterBacklog(stories: readonly StoryView[], filter: BacklogFilter, search: string): StoryView[] {
  const q = search.trim().toLowerCase();
  return stories.filter((s) => filterOf(s) === filter && (!q || `${s.title} ${s.request ?? ""} ${s.story}`.toLowerCase().includes(q)));
}
