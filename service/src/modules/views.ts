// Modules de vue autour de la conversation : chacun s'éteint seul. Activité et barre d'état n'ont rien à servir de plus
// (ils lisent les événements de la conversation) : leur état décide s'ils ont une place à l'écran. La jauge de
// contexte demande à l'adaptateur la taille à laquelle se rapporter.
import { findProject } from "../../../kit/core/src/project.ts";
import type { AgentName } from "../contract.ts";
import type { ServiceModule } from "../module.ts";
import { HttpError } from "../router.ts";
import { defaultAgentFactory, type AgentFactory } from "./conversation.ts";
import { projectById } from "./projects.ts";

export const activityModule: ServiceModule = {
  id: "activity",
  title: "Ligne d'activité",
  description: "Ce que fait l'agent en ce moment : outil en cours, sous-agents lancés.",
  defaultOn: true,
  dependencies: ["conversation"],
  start: () => undefined,
};

export const statusBarModule: ServiceModule = {
  id: "status-bar",
  title: "Barre d'état",
  description: "Agent, modèle, branche et worktree du fil.",
  defaultOn: true,
  dependencies: ["conversation"],
  start: () => undefined,
};

export function contextModule(factory: AgentFactory = defaultAgentFactory): ServiceModule {
  return {
    id: "context",
    title: "Jauge de contexte",
    description: "Place prise dans le contexte de la session, rapportée au seuil de compactage (ou au contexte du modèle local).",
    defaultOn: true,
    dependencies: ["conversation"],
    start({ routes }) {
      routes.add("GET", "/api/projects/:id/context/:agent", async ({ params }) => {
        const project = findProject(projectById(params.id ?? "").root);
        if (project === null) throw new HttpError(409, `le projet ${params.id} n'est plus un projet Spawn`);
        const agent = params.agent as AgentName;
        if (agent !== "claude-code" && agent !== "opencode") throw new HttpError(400, `agent inconnu : ${agent}`);
        return { max: await factory(agent, project).maxContext(project.root) };
      });
      return undefined;
    },
  };
}
