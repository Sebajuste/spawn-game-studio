// Lecture d'une story d'epic pour l'écran : sa clé, son état en mots, sa couleur, et les mégaoctets de cache.
import type { EpicStoryView, EpicView } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";

export const refKey = (r: { project: string; story: string }) => `${r.project}/${r.story}`;

export function stateLabel(state: string): string {
  if (state.startsWith("blocked:")) return t("project.step.waitingUser");
  // `t` rend undefined pour une clé absente, malgré son type.
  const label = t(`workspace.state.${state}` as Parameters<typeof t>[0]) as string | undefined;
  return label ?? t("workspace.state.other", { state });
}

export const stateClass = (s: EpicStoryView) => (s.merged ? "done" : s.state === "not-started" ? (s.waiting_for.length > 0 ? "waiting" : "idle") : "running");

export const megas = (n: number) => (n / 1_000_000).toFixed(1);

// Un epic est livré quand toutes ses stories sont fusionnées ; un epic vide n'est pas livré.
export const epicDone = (e: EpicView) => e.stories.length > 0 && e.merged === e.stories.length;
