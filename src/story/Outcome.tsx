import type { StoryDetail } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";

// Issue de la dernière fusion. Une fusion refusée n'est plus d'actualité une fois la story revenue en recette (l'agent
// a corrigé) ; une erreur reste dite tant qu'une nouvelle fusion ne l'efface pas.
export function Outcome({ detail }: { detail: StoryDetail }) {
  const m = detail.lastMerge;
  if (!m) return null;
  if (m.verdict === "merged") return detail.group === "history" ? <div className="banner green">{t("story.delivered")}{m.commit ? ` (${m.commit.slice(0, 7)})` : ""}</div> : null;
  if (m.verdict === "refused") return detail.group === "acceptance" || detail.group === "history" ? null : <div className="banner orange">{t("story.mergeRefused", { cause: m.cause ?? t("story.unknownCause") })}</div>;
  return detail.group === "history" ? null : <div className="banner orange">{t("story.mergeError", { cause: m.cause ?? t("story.unknownCause") })}</div>;
}
