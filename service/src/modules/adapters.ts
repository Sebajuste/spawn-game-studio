// Les moteurs proposés sur cette machine (docs/reglages.md §3.1) : tous les adaptateurs présents, cochés ou non. Un
// moteur décoché n'est plus proposé à la création ni à l'adoption ; les projets déjà inscrits continuent de fonctionner.
import { listAdapters } from "../../../kit/core/src/adapters.ts";
import { findProject } from "../../../kit/core/src/project.ts";
import { readRegistry } from "../../../kit/core/src/registry.ts";
import { readConfig, writeConfig } from "../config.ts";
import type { AdapterChoice } from "../contract.ts";
import type { ModuleContext } from "../module.ts";
import { HttpError } from "../router.ts";

function engineOf(root: string): string | null {
  try {
    return findProject(root)?.config.engine ?? null;
  } catch {
    return null;
  }
}

export function adapterChoices(): AdapterChoice[] {
  const off = readConfig().engines;
  const used = readRegistry().map((p) => engineOf(p.root));
  return listAdapters().map((a) => ({ ...a, active: off[a.engine] !== false, projects: used.filter((e) => e === a.engine).length }));
}

export function activeEngines(): string[] {
  return adapterChoices()
    .filter((a) => a.active)
    .map((a) => a.engine);
}

// Création, diagnostic et adoption refusent un moteur décoché : l'app ne le propose pas, un appel direct non plus.
export function requireActive(engine: string): void {
  const a = adapterChoices().find((x) => x.engine === engine);
  if (a && !a.active) throw new HttpError(400, `moteur ${a.title} décoché sur cette machine (Réglages > Application)`);
}

export function adapterRoutes({ routes }: Pick<ModuleContext, "routes">): void {
  routes.add("GET", "/api/adapters", (): AdapterChoice[] => adapterChoices());

  routes.add("PUT", "/api/adapters/:engine", ({ params, body }): AdapterChoice[] => {
    const engine = params.engine ?? "";
    const all = adapterChoices();
    const target = all.find((a) => a.engine === engine);
    if (!target) throw new HttpError(404, `moteur inconnu : ${engine}`);
    const active = (body as { active?: unknown } | null)?.active;
    if (typeof active !== "boolean") throw new HttpError(400, 'corps attendu : { "active": true|false }');
    if (!active && target.active && all.filter((a) => a.active).length === 1) throw new HttpError(409, `${target.title} est le dernier moteur coché : il en faut au moins un`);
    const config = readConfig();
    // Absent veut dire coché : seuls les moteurs décochés sont écrits.
    const engines = Object.fromEntries(Object.entries({ ...config.engines, [engine]: active }).filter(([, on]) => !on));
    writeConfig({ ...config, engines });
    return adapterChoices();
  });
}
