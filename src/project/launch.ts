// Gestes du projet qui ne dépendent d'aucun écran : lancer (develop, ou la version d'une story) et ouvrir son dossier.
import type { Api } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";

// Rend le message à montrer dans la barre d'état ; une erreur remonte telle quelle.
export async function launch(api: Api, project: string, story: string | null = null): Promise<string> {
  await api.call("POST", `/api/projects/${encodeURIComponent(project)}/launch`, story ? { story } : {});
  return story ? t("project.info.storyLaunched") : t("project.info.projectLaunched");
}

export async function openFolder(api: Api, project: string): Promise<void> {
  await api.call("POST", `/api/projects/${encodeURIComponent(project)}/open`, { access: "." });
}
