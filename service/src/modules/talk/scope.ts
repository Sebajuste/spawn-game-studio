// Une portée de conversation (projet ou workspace) ramenée à ce dont un tour a besoin : le projet où tourne l'agent,
// les projets qu'il peut lire, le dossier de stockage, l'agent des réglages.
import { dirname, join } from "node:path";
import { readRegistry, registryPath } from "../../../../kit/core/src/registry.ts";
import { readProjectSettings } from "../../../../kit/core/src/settings.ts";
import { findProject, type Project } from "../../../../kit/core/src/project.ts";
import { readWorkspaces } from "../../../../kit/core/src/workspaces.ts";
import type { AgentName, TalkScope } from "../../contract.ts";
import { HttpError } from "../../router.ts";
import { projectById } from "../projects.ts";

export interface ScopeProject {
  id: string;
  name: string;
  project: Project;
}

export interface TalkTarget {
  kind: TalkScope;
  id: string;
  name: string;
  // Projet dont le worktree `_talk` accueille l'agent : le projet lui-même, ou le premier du workspace.
  host: ScopeProject;
  // Le suffixe du worktree : vide pour un projet ; le workspace sinon, pour que ses tours ne remettent pas à zéro
  // le worktree d'une conversation de projet en cours.
  suffix: string;
  projects: ScopeProject[];
  store: string;
  agent: AgentName;
}

function spawnProject(id: string, name: string, root: string): ScopeProject {
  const project = findProject(root);
  if (project === null) throw new HttpError(409, `le projet ${id} n'est plus un projet Spawn`);
  return { id, name, project };
}

export function resolveScope(kind: TalkScope, id: string): TalkTarget {
  if (kind === "project") {
    const p = projectById(id);
    const host = spawnProject(p.id, p.name, p.root);
    return { kind, id, name: p.name, host, suffix: "", projects: [host], store: join(host.project.root, ".spawn", "talk"), agent: readProjectSettings(host.project.root).agent };
  }
  const w = readWorkspaces().find((x) => x.id === id);
  if (!w) throw new HttpError(404, `workspace inconnu : ${id}`);
  const registry = new Map(readRegistry().map((p) => [p.id, p]));
  const projects = w.projects.flatMap((pid) => {
    const p = registry.get(pid);
    return p ? [spawnProject(p.id, p.name, p.root)] : [];
  });
  const host = projects[0];
  if (!host) throw new HttpError(409, `le workspace ${w.name} n'a aucun projet : ajoute-en un avant de parler à son agent`);
  // Jamais à côté de `SPAWN_WORKSPACES`, qui peut être un dépôt d'équipe : la conversation reste sur la machine.
  const store = join(dirname(registryPath()), "talk", w.id);
  return { kind, id, name: w.name, host, suffix: w.id, projects, store, agent: readProjectSettings(host.project.root).agent };
}
