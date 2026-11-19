// Module stories : l'état technique de chaque story, son ledger lisible et l'étape donnée par spawn next.
// Surveille `.spawn/` de chaque projet et prévient l'interface (événement « stories ») au lieu de la laisser interroger.
import { existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { ledgerPath } from "../../../kit/core/src/context.ts";
import { readStory, listStories, type Story } from "../../../kit/core/src/stories.ts";
import { readLedger, render } from "../../../kit/core/src/ledger.ts";
import { readRefusals } from "../../../kit/core/src/guard/log.ts";
import { findProject, type Project } from "../../../kit/core/src/project.ts";
import { readRegistry } from "../../../kit/core/src/registry.ts";
import { nextAction, type Action } from "../../../kit/core/src/next.ts";
import type { StoryStateDetail, StoryStateView } from "../contract.ts";
import type { ServiceModule } from "../module.ts";
import { HttpError } from "../router.ts";
import { conversationInterrupted } from "./conversation.ts";
import { projectById } from "./projects.ts";

function spawnProject(id: string): Project {
  const p = projectById(id);
  const project = findProject(p.root);
  if (project === null) throw new HttpError(409, `le projet ${id} n'est plus un projet Spawn : ${p.root}`);
  return project;
}

function nextActionOf(project: Project, story: Story): Action | null {
  if (story.status === "cleaned") return null;
  const dir = story.worktree ? join(project.root, story.worktree) : project.root;
  try {
    return nextAction({ project, story: story.story, dir: existsSync(dir) ? dir : project.root });
  } catch {
    return null;
  }
}

export function storyStateView(project: Project, story: Story, conversation = false): StoryStateView {
  return { ...story, step: nextActionOf(project, story)?.step ?? null, interrupted: conversation && conversationInterrupted(project.root, story.story) };
}

export function storyStateDetail(project: Project, name: string, conversation = false): StoryStateDetail {
  const story = readStory(project.root, name);
  if (story === null) throw new HttpError(404, `fil inconnu : ${name}`);
  const action = nextActionOf(project, story);
  const zone = story.worktree ? join(project.root, story.worktree).toLowerCase() : null;
  return {
    ...story,
    step: action?.step ?? null,
    interrupted: conversation && conversationInterrupted(project.root, name),
    ledger: readLedger(ledgerPath(project.root, name)).map(render),
    next: action,
    // Les refus du périmètre vus depuis cette story : un blocage ne doit pas rester invisible.
    refusals: zone ? readRefusals(project.root).filter((r) => r.cwd.toLowerCase().startsWith(zone)).slice(-20) : [],
  };
}

export const storiesModule: ServiceModule = {
  id: "stories",
  title: "Fils",
  description: "Un onglet par fil : statut, étape suivante, ledger, refus du périmètre.",
  defaultOn: true,
  dependencies: ["projects"],
  start({ routes, emit, active }) {
    const conversation = active.has("conversation");
    routes.add("GET", "/api/projects/:id/stories", ({ params }) => {
      const project = spawnProject(params.id ?? "");
      return listStories(project.root).map((f) => storyStateView(project, f, conversation));
    });
    routes.add("GET", "/api/projects/:id/stories/:story", ({ params }) => storyStateDetail(spawnProject(params.id ?? ""), params.story ?? "", conversation));

    // Une surveillance par projet ; les rafales d'écritures (écriture atomique, ledger) sont regroupées.
    const watchers: FSWatcher[] = [];
    const timers = new Map<string, NodeJS.Timeout>();
    for (const p of readRegistry()) {
      const dir = join(p.root, ".spawn");
      if (!existsSync(p.root)) continue;
      try {
        // Un projet neuf n'a pas encore .spawn/ (ignoré par git) : sa première story doit pourtant se voir.
        mkdirSync(dir, { recursive: true });
        watchers.push(
          watch(dir, { recursive: true }, (_e, file) => {
            // De la conversation, seul son état compte (session, tour coupé) : ses sorties bougent sans cesse.
            if (file && !/^((stories|ledgers|logs|story-meta)[\\/]|settings\.json$|conversations[\\/][^\\/]+[\\/]state\.json$)/.test(String(file))) return;
            clearTimeout(timers.get(p.id));
            timers.set(p.id, setTimeout(() => emit("stories", { project: p.id }), 150));
          }),
        );
      } catch {
        // Surveillance impossible (dossier verrouillé) : l'interface rafraîchit à la demande.
      }
    }
    return () => {
      for (const w of watchers) w.close();
      for (const t of timers.values()) clearTimeout(t);
    };
  },
};
