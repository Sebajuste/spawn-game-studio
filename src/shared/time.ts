// « il y a … » en mots de la langue choisie ; au-delà d'un jour, la date.
import { getLang, t } from "../i18n/i18n.ts";

export function since(date: string | null): string {
  if (!date) return "";
  const s = Math.max(0, (Date.now() - Date.parse(date)) / 1000);
  if (s < 60) return t("project.since.now");
  if (s < 3600) return t("project.since.min", { n: Math.round(s / 60) });
  if (s < 86400) return t("project.since.hours", { n: Math.round(s / 3600) });
  return t("project.since.on", { date: new Date(date).toLocaleDateString(getLang() === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "short" }) });
}
