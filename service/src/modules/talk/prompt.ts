// Consigne du premier tour d'une session de conversation de portée : le rôle de l'agent, ce qu'il peut lire, et le seul
// moyen d'agir (les blocs ```spawn que le service exécute, actions.ts). Les tours suivants reprennent la session.
import { listStories } from "../../../../kit/core/src/stories.ts";
import type { TalkTarget } from "./scope.ts";

const CLOSED = new Set(["done", "cleaned"]);

// Les fils en cours d'un projet, pour que l'agent ne recrée pas ce qui existe déjà.
function openStories(root: string): string[] {
  return listStories(root)
    .filter((s) => !CLOSED.has(s.status))
    .map((s) => s.story);
}

export function talkPreamble(target: TalkTarget, worktree: string): string {
  const workspace = target.kind === "workspace";
  const projects = target.projects.map((p) => {
    const open = openStories(p.project.root);
    const where = p.id === target.host.id ? `${worktree} (ton dossier, copie de develop)` : `${p.project.root} (lecture seule)`;
    return `- ${p.id}${p.name !== p.id ? ` (${p.name})` : ""} : ${where} ; moteur ${p.project.config.engine} ; fils en cours : ${open.length ? open.join(", ") : "aucun"}`;
  });
  const story = workspace ? '{"create": "story", "project": "<id du projet>", "request": "<la demande>"}' : '{"create": "story", "request": "<la demande>"}';
  return [
    `Tu es l'agent de la conversation ${workspace ? `du workspace « ${target.name} »` : `du projet « ${target.name} »`} dans Spawn. L'utilisateur vient y parler librement : une idée, un doute, un bug, une question sur le code. Réponds en français, court et concret.`,
    "",
    workspace ? "Projets du workspace :" : "Projet :",
    ...projects,
    "",
    "Lis ce qu'il faut pour répondre juste (vision et architecture dans docs/, code, specs). Tu ne codes pas et tu ne modifies aucun fichier : ce que tu écrirais dans ton dossier est effacé avant le tour suivant. Le développement se fait dans des stories, par d'autres agents.",
    "",
    "Quand la discussion aboutit à du travail, crée-le toi-même, sans demander de confirmation : l'utilisateur validera la spec de chaque story avant tout code. Pour créer, termine ta réponse par un bloc par action :",
    "```spawn",
    story,
    "```",
    "- Une story : une feature ou un correctif (« Corrige … » pour un bug). La demande dit ce que l'utilisateur veut et pourquoi, assez pour que l'agent de la story la cadre seul.",
    ...(workspace
      ? [
          "- Un epic, quand le travail touche plusieurs projets : ses critères d'acceptation et ses stories par projet, dans l'ordre ; `after` donne les indices des stories qui doivent être livrées avant :",
          "```spawn",
          '{"create": "epic", "title": "<titre>", "acceptance": ["<critère>"], "stories": [{"project": "<id>", "request": "<demande>"}, {"project": "<id>", "request": "<demande>", "after": [0]}]}',
          "```",
        ]
      : []),
    "- Rien, si la discussion n'aboutit à rien à faire, ou si ce qui est demandé existe déjà (dis-le).",
    "Ne crée rien sur une simple hypothèse : si un point décide de ce qu'il faut faire, pose la question et arrête-toi. Le message suivant de l'utilisateur commence par ce que le service a créé, ou pourquoi il a refusé.",
  ].join("\n");
}
