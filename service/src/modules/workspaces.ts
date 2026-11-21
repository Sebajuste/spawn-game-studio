// Workspaces : projets regroupés et epics qui traversent plusieurs projets (docs/workspaces.md). Le suivi local est la
// source de vérité ; l'état réel de chaque story est lu dans son projet.
import {
  addEpicStory,
  addProject,
  createEpic,
  createWorkspace,
  epicStories,
  readWorkspaces,
  removeEpic,
  removeProject,
  removeWorkspace,
  renameEpic,
  renameWorkspace,
  type Epic,
  type Workspace,
} from "../../../kit/core/src/workspaces.ts";
import type { EpicView, WorkspaceView } from "../contract.ts";
import type { ServiceModule } from "../module.ts";
import { HttpError } from "../router.ts";

function epicView(e: Epic): EpicView {
  const stories = epicStories(e);
  return { id: e.id, title: e.title, acceptance: e.acceptance, stories, merged: stories.filter((s) => s.merged).length };
}

const workspaceView = (w: Workspace): WorkspaceView => ({ id: w.id, name: w.name, projects: w.projects, epics: w.epics.map(epicView) });

function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const ref = (v: unknown) => {
  const r = (v ?? {}) as { project?: unknown; story?: unknown };
  if (typeof r.project !== "string" || typeof r.story !== "string") throw new HttpError(400, '{ "project", "story" } attendu');
  return { project: r.project, story: r.story };
};

export const workspacesModule: ServiceModule = {
  id: "workspaces",
  title: "Workspaces",
  description: "Projets regroupés et epics qui touchent plusieurs projets.",
  defaultOn: true,
  dependencies: ["projects"],
  start({ routes, emit }) {
    const changed = () => emit("workspaces", {});
    routes.add("GET", "/api/workspaces", () => readWorkspaces().map(workspaceView));
    routes.add("POST", "/api/workspaces", ({ body }) => {
      const b = (body ?? {}) as { name?: unknown; projects?: unknown };
      if (typeof b.name !== "string") throw new HttpError(400, '{ "name", "projects" } attendu');
      const w = guard(() => createWorkspace(b.name as string, strings(b.projects)));
      changed();
      return workspaceView(w);
    });
    routes.add("DELETE", "/api/workspaces/:id", ({ params }) => {
      if (!removeWorkspace(params.id ?? "")) throw new HttpError(404, `workspace inconnu : ${params.id}`);
      changed();
      return { removed: params.id };
    });
    routes.add("PATCH", "/api/workspaces/:id", ({ params, body }) => {
      const name = (body as { name?: unknown } | null)?.name;
      if (typeof name !== "string") throw new HttpError(400, '{ "name" } attendu');
      const w = guard(() => renameWorkspace(params.id ?? "", name));
      changed();
      return workspaceView(w);
    });
    routes.add("DELETE", "/api/workspaces/:id/projects/:project", ({ params }) => {
      const w = guard(() => removeProject(params.id ?? "", params.project ?? ""));
      changed();
      return workspaceView(w);
    });
    routes.add("PATCH", "/api/workspaces/:id/epics/:epic", ({ params, body }) => {
      const title = (body as { title?: unknown } | null)?.title;
      if (typeof title !== "string") throw new HttpError(400, '{ "title" } attendu');
      const e = guard(() => renameEpic(params.id ?? "", params.epic ?? "", title));
      changed();
      return epicView(e);
    });
    routes.add("DELETE", "/api/workspaces/:id/epics/:epic", ({ params }) => {
      if (!guard(() => removeEpic(params.id ?? "", params.epic ?? ""))) throw new HttpError(404, `epic inconnu : ${params.epic}`);
      changed();
      return { removed: params.epic };
    });
    routes.add("POST", "/api/workspaces/:id/projects", ({ params, body }) => {
      const project = (body as { project?: unknown } | null)?.project;
      if (typeof project !== "string") throw new HttpError(400, '{ "project" } attendu');
      const w = guard(() => addProject(params.id ?? "", project));
      changed();
      return workspaceView(w);
    });
    routes.add("POST", "/api/workspaces/:id/epics", ({ params, body }) => {
      const b = (body ?? {}) as { title?: unknown; acceptance?: unknown };
      if (typeof b.title !== "string") throw new HttpError(400, '{ "title", "acceptance"? } attendu');
      const e = guard(() => createEpic(params.id ?? "", b.title as string, strings(b.acceptance)));
      changed();
      return epicView(e);
    });
    routes.add("POST", "/api/workspaces/:id/epics/:epic/stories", ({ params, body }) => {
      const b = (body ?? {}) as { blocked_by?: unknown };
      const blocked = Array.isArray(b.blocked_by) ? b.blocked_by.map(ref) : [];
      const e = guard(() => addEpicStory(params.id ?? "", params.epic ?? "", ref(body), blocked));
      changed();
      return epicView(e);
    });
  },
};
