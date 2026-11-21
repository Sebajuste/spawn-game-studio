// Routeur HTTP minimal : méthode + chemin à paramètres (`/api/projects/:id/stories`), réponses JSON.
import type { IncomingMessage, ServerResponse } from "node:http";

export type Params = Record<string, string>;
export type Handler = (request: { params: Params; body: unknown; url: URL; raw: IncomingMessage; response: ServerResponse }) => unknown | Promise<unknown>;

export class HttpError extends Error {
  readonly status: number;
  // Champs ajoutés à la réponse d'erreur (ex. le diagnostic refait d'une adoption refusée).
  readonly extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    const names: string[] = [];
    const pattern = new RegExp(
      "^" +
        path.replace(/:([a-z_]+)/gi, (_t, name: string) => {
          names.push(name);
          return "([^/]+)";
        }) +
        "$",
    );
    this.routes.push({ method, pattern, names, handler });
  }

  find(method: string, path: string): { handler: Handler; params: Params } | null {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(path);
      if (!m) continue;
      const params: Params = {};
      r.names.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1] ?? "")));
      return { handler: r.handler, params };
    }
    return null;
  }
}
