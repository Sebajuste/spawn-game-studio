// Ajouter un projet existant (docs/adoption.md) : le diagnostic en lecture seule, l'adoption dont chaque étape est
// poussée à l'interface (événement « adoption »). Les moteurs proposés : adapters.ts.
import { isAbsolute, resolve } from "node:path";
import { adoptProject, AdoptionRefused } from "../../../kit/core/src/adopt/adopt.ts";
import { diagnose } from "../../../kit/core/src/adopt/diagnose.ts";
import type { AdoptionView, Diagnosis } from "../contract.ts";
import type { ModuleContext } from "../module.ts";
import { HttpError } from "../router.ts";
import { activeEngines, requireActive } from "./adapters.ts";
import { projectView } from "./projects.ts";

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function folder(body: unknown): string {
  const dir = text((body as { dir?: unknown } | null)?.dir);
  if (!dir || !isAbsolute(dir)) throw new HttpError(400, 'corps attendu : { "dir": "<chemin absolu du projet>" }');
  return resolve(dir);
}

export function adoptionRoutes({ routes, emit, remount }: Pick<ModuleContext, "routes" | "emit" | "remount">): void {
  routes.add("POST", "/api/projects/diagnose", async ({ body }): Promise<Diagnosis> => {
    const dir = folder(body);
    const engine = text((body as { engine?: unknown }).engine);
    if (engine) requireActive(engine);
    try {
      return await diagnose(dir, engine ? { engine } : { only: activeEngines() });
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });

  let adopting = false;
  routes.add("POST", "/api/projects/adopt", async ({ body }): Promise<AdoptionView> => {
    const dir = folder(body);
    const b = (body ?? {}) as Record<string, unknown>;
    const engine = text(b.engine);
    const version = text(b.version);
    const tag = text(b.tag).toUpperCase();
    const workspace = text(b.workspace);
    if (!engine || !version || !tag) throw new HttpError(400, 'corps attendu : { "dir", "engine", "version", "tag", "workspace"? }');
    requireActive(engine);
    if (adopting) throw new HttpError(409, "une adoption est déjà en cours");
    adopting = true;
    try {
      const a = await adoptProject({ dir, engine, version, tag, ...(workspace ? { workspace } : {}), log: (line) => emit("adoption", { line }) });
      await remount();
      emit("projects", {});
      if (workspace) emit("workspaces", {});
      return { project: projectView(a.project), commit: a.commit, baseline: a.baseline, gaps: a.gaps, leftovers: a.leftovers };
    } catch (e) {
      if (e instanceof AdoptionRefused) throw new HttpError(409, e.message, { diagnosis: e.diagnosis });
      throw new HttpError(400, (e as Error).message);
    } finally {
      adopting = false;
    }
  });
}
