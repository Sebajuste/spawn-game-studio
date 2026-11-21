// Module socle : les projets Spawn de la machine (registre `~/.spawn/projects.json`).
import { isAbsolute, resolve } from "node:path";
import { listStories } from "../../../kit/core/src/stories.ts";
import { readEngineSettings } from "../../../kit/core/src/engines.ts";
import { newProject, slug } from "../../../kit/core/src/new-project.ts";
import { findProject } from "../../../kit/core/src/project.ts";
import { unregister, register, readRegistry, type RegisteredProject } from "../../../kit/core/src/registry.ts";
import type { KnownEngine, ProjectView } from "../contract.ts";
import { forgetProject } from "../../../kit/core/src/workspaces.ts";
import type { ServiceModule } from "../module.ts";
import { HttpError } from "../router.ts";
import { adoptionRoutes } from "./adopt.ts";

// Champs à null si le dossier n'est plus un projet Spawn (déplacé, supprimé) : l'app le dit au lieu de le cacher.
export function projectView(p: RegisteredProject): ProjectView {
  try {
    const project = findProject(p.root);
    if (project === null) return { id: p.id, name: p.name, root: p.root, engine: null, version: null, tag: null, open_stories: 0, problem: "dossier introuvable ou sans spawn.json" };
    const open = listStories(project.root).filter((f) => f.status !== "cleaned").length;
    return { id: p.id, name: p.name, root: p.root, engine: project.config.engine, version: project.config.version, tag: project.config.tag ?? null, open_stories: open, problem: null };
  } catch (e) {
    return { id: p.id, name: p.name, root: p.root, engine: null, version: null, tag: null, open_stories: 0, problem: (e as Error).message };
  }
}

export function projectById(id: string): RegisteredProject {
  const p = readRegistry().find((x) => x.id === id);
  if (!p) throw new HttpError(404, `projet inconnu : ${id}`);
  return p;
}

export const projectsModule: ServiceModule = {
  id: "projects",
  title: "Projets",
  description: "Les projets de la machine : inscription, création, adoption d'un projet existant.",
  core: true,
  defaultOn: true,
  dependencies: [],
  start({ routes, remount, emit }) {
    routes.add("GET", "/api/projects", () => readRegistry().map(projectView));
    routes.add("POST", "/api/projects", async ({ body }) => {
      const dir = (body as { dir?: unknown } | null)?.dir;
      if (typeof dir !== "string" || !dir) throw new HttpError(400, 'corps attendu : { "dir": "<chemin du projet>" }');
      let registered: RegisteredProject;
      try {
        registered = register(dir);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      await remount();
      return projectView(registered);
    });
    // Moteurs connus de la machine (`~/.spawn/engines.json`), pour « Nouveau projet ».
    routes.add("GET", "/api/engines", (): KnownEngine[] =>
      Object.entries(readEngineSettings()).flatMap(([engine, versions]) => Object.entries(versions).map(([version, executable]) => ({ engine, version, executable }))),
    );

    // Nouveau projet : chaque étape est poussée à l'interface (événement « creation ») pendant qu'elle se fait.
    // `/api/projects/new` et non `/api/projects` : ce dernier ouvre un dossier déjà existant.
    let creating = false;
    routes.add("POST", "/api/projects/new", async ({ body }) => {
      const c = (body ?? {}) as Record<string, unknown>;
      const name = typeof c.name === "string" ? c.name.trim() : "";
      const parent = typeof c.parent === "string" ? c.parent.trim() : "";
      const version = typeof c.version === "string" ? c.version.trim() : "";
      const engine = typeof c.engine === "string" ? c.engine.trim() : "";
      if (!name || !parent || !version || !engine) throw new HttpError(400, 'corps attendu : { "name", "parent" (dossier absolu), "engine", "version", "tag"?, "remote"? }');
      if (!isAbsolute(parent)) throw new HttpError(400, `dossier parent absolu attendu : ${parent}`);
      if (creating) throw new HttpError(409, "une création de projet est déjà en cours");
      creating = true;
      try {
        const tag = typeof c.tag === "string" && c.tag.trim() ? c.tag.trim().toUpperCase() : slug(name).replace(/-/g, "").slice(0, 3).toUpperCase().padEnd(2, "X");
        const created = await newProject({
          name,
          parent: resolve(parent),
          engine,
          version,
          tag,
          remote: typeof c.remote === "string" && c.remote ? c.remote : "local",
          log: (line) => emit("creation", { line }),
        });
        await remount();
        const registered = readRegistry().find((p) => resolve(p.root).toLowerCase() === resolve(created.root).toLowerCase());
        if (!registered) throw new HttpError(500, `projet créé mais absent du registre : ${created.root}`);
        return projectView(registered);
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, (e as Error).message);
      } finally {
        creating = false;
      }
    });

    adoptionRoutes({ routes, emit, remount });

    routes.add("DELETE", "/api/projects/:id", async ({ params }) => {
      if (!unregister(params.id ?? "")) throw new HttpError(404, `projet inconnu : ${params.id}`);
      forgetProject(params.id ?? "");
      emit("workspaces", {});
      await remount();
      return { removed: params.id };
    });
  },
};
