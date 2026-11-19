// Un module = une fonctionnalité de l'app qu'on peut éteindre. Éteint, il n'a ni route, ni surveillance, ni place
// à l'écran : il n'est pas caché, il n'existe pas. Ses dépendances éteintes l'éteignent aussi.
import type { Router } from "./router.ts";

export interface ModuleContext {
  routes: Router;
  emit(type: string, data: unknown): void;
  // Modules actifs : un module peut adapter ce qu'il expose à ses voisins (ex. le module stories sans le module conversation).
  active: ReadonlySet<string>;
  // Redémarre tous les modules (ex. après l'inscription d'un projet, que les surveillances doivent couvrir).
  remount(): Promise<void>;
}

export type Stop = () => void | Promise<void>;

export interface ServiceModule {
  id: string;
  title: string;
  description: string;
  // Le socle ne s'éteint pas.
  core?: boolean;
  defaultOn: boolean;
  dependencies: readonly string[];
  // Rend de quoi arrêter le module (surveillances, minuteries), ou undefined s'il n'y a rien à arrêter.
  start(ctx: ModuleContext): Stop | undefined | Promise<Stop | undefined>;
  // À la fermeture du service seulement (pas aux remontages) : arrêter ce qui survit aux remontages, comme un agent.
  close?(): void | Promise<void>;
}

export interface ModuleState {
  id: string;
  title: string;
  description: string;
  core: boolean;
  active: boolean;
  // Pourquoi un module voulu actif ne l'est pas (dépendance éteinte).
  reason: string | null;
  dependencies: readonly string[];
}

// Résout l'état de chaque module : voulu par la config (ou par défaut), puis éteint si une dépendance l'est.
export function resolveModules(modules: readonly ServiceModule[], wanted: Readonly<Record<string, boolean>>): ModuleState[] {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const active = new Map<string, boolean>();
  const reason = new Map<string, string | null>();
  const visit = (id: string, stack: string[]): boolean => {
    const known = active.get(id);
    if (known !== undefined) return known;
    const m = byId.get(id);
    if (!m) {
      active.set(id, false);
      return false;
    }
    if (stack.includes(id)) throw new Error(`dépendance circulaire : ${[...stack, id].join(" → ")}`);
    let ok = m.core === true || (wanted[id] ?? m.defaultOn);
    let why: string | null = null;
    if (ok) {
      const off = m.dependencies.find((d) => !visit(d, [...stack, id]));
      if (off) {
        ok = false;
        why = `dépend de « ${byId.get(off)?.title ?? off} », éteint`;
      }
    }
    active.set(id, ok);
    reason.set(id, why);
    return ok;
  };
  return modules.map((m) => {
    const ok = visit(m.id, []);
    return { id: m.id, title: m.title, description: m.description, core: m.core === true, active: ok, reason: reason.get(m.id) ?? null, dependencies: m.dependencies };
  });
}
