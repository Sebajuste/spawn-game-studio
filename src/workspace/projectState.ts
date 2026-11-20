// État d'un projet dans la liste « Projets » d'un workspace, lu dans son backlog : ce qui attend l'utilisateur d'abord,
// puis les agents au travail, puis les stories ouvertes.
import type { StoryView } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";

export function projectState(stories: readonly StoryView[] | null | undefined): { text: string; tone: "orange" | "green" | "grey" } {
  const list = stories ?? [];
  const toDo = list.filter((s) => s.group === "blocked" || s.group === "acceptance").length;
  if (toDo > 0) return { text: t("nav.projects.state.toDo", { n: toDo }), tone: "orange" };
  const running = list.filter((s) => s.running).length;
  if (running > 0) return { text: t(running === 1 ? "nav.projects.state.working.one" : "nav.projects.state.working.other", { n: running }), tone: "green" };
  const open = list.filter((s) => s.group !== "history").length;
  if (open > 0) return { text: t(open === 1 ? "nav.projects.state.open.one" : "nav.projects.state.open.other", { n: open }), tone: "grey" };
  return { text: t("nav.projects.state.nothing"), tone: "grey" };
}
