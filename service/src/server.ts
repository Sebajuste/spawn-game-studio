// Serveur du service de l'app : API JSON et flux d'événements (SSE), sur 127.0.0.1 et avec un jeton, parce que le
// service saura lancer des agents. Seuls les modules actifs sont montés ; une bascule les redémarre tous.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readConfig, writeConfig } from "./config.ts";
import { resolveModules, type Stop, type ModuleState, type ServiceModule } from "./module.ts";
import { HttpError, Router } from "./router.ts";

export interface Service {
  port: number;
  token: string;
  states(): ModuleState[];
  close(): Promise<void>;
}

const MAX_BODY = 1_000_000;

async function readBody(request: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) {
    text += chunk as string;
    if (text.length > MAX_BODY) throw new HttpError(413, "corps trop gros");
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "corps JSON illisible");
  }
}

export async function startService(o: { modules: readonly ServiceModule[]; port?: number; token?: string; log?: (l: string) => void }): Promise<Service> {
  const log = o.log ?? ((l: string) => console.error(`[service] ${l}`));
  const token = o.token ?? randomBytes(24).toString("hex");
  const clients = new Set<ServerResponse>();
  const emit = (type: string, data: unknown) => {
    const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(message);
  };

  let routes = new Router();
  let stops: Stop[] = [];
  let states: ModuleState[] = [];

  const mount = async () => {
    for (const s of stops.reverse()) await s();
    stops = [];
    routes = new Router();
    states = resolveModules(o.modules, readConfig().modules);
    const active = new Set(states.filter((e) => e.active).map((e) => e.id));
    for (const m of o.modules) {
      if (!active.has(m.id)) continue;
      try {
        const stop = await m.start({ routes, emit, active, remount: () => mount() });
        if (stop) stops.push(stop);
      } catch (e) {
        log(`module ${m.id} : démarrage impossible : ${(e as Error).message}`);
        const state = states.find((x) => x.id === m.id);
        if (state) {
          state.active = false;
          state.reason = `démarrage impossible : ${(e as Error).message}`;
        }
      }
    }
    emit("modules", states);
  };

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
      response.end(JSON.stringify(body));
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE" });
      response.end();
      return;
    }
    // EventSource n'envoie pas d'en-tête : le jeton peut aussi venir de l'URL.
    const presented = request.headers.authorization?.replace(/^Bearer /, "") ?? url.searchParams.get("token");
    if (presented !== token) return reply(401, { error: "jeton absent ou faux" });

    try {
      if (url.pathname === "/api/events" && request.method === "GET") {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" });
        response.write(`event: modules\ndata: ${JSON.stringify(states)}\n\n`);
        clients.add(response);
        request.on("close", () => clients.delete(response));
        return;
      }
      if (url.pathname === "/api/modules" && request.method === "GET") return reply(200, states);
      const toggle = /^\/api\/modules\/([a-z0-9-]+)$/.exec(url.pathname);
      if (toggle && request.method === "PUT") {
        const id = toggle[1] ?? "";
        const m = o.modules.find((x) => x.id === id);
        if (!m) throw new HttpError(404, `module inconnu : ${id}`);
        if (m.core) throw new HttpError(409, `${m.title} fait partie du socle : il ne s'éteint pas`);
        const body = (await readBody(request)) as { active?: unknown } | null;
        if (typeof body?.active !== "boolean") throw new HttpError(400, 'corps attendu : { "active": true|false }');
        const config = readConfig();
        writeConfig({ ...config, modules: { ...config.modules, [id]: body.active } });
        await mount();
        return reply(200, states);
      }
      const found = routes.find(request.method ?? "GET", url.pathname);
      if (!found) return reply(404, { error: `rien ici : ${request.method} ${url.pathname} (module éteint ?)` });
      const body = request.method === "GET" ? null : await readBody(request);
      const result = await found.handler({ params: found.params, body, url, raw: request, response });
      if (!response.writableEnded) reply(200, result ?? null);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) log(`${request.method} ${url.pathname} : ${(e as Error).stack ?? String(e)}`);
      if (!response.headersSent) reply(status, { ...(e instanceof HttpError ? e.extra : {}), error: (e as Error).message });
    }
  });

  await mount();
  await new Promise<void>((ok) => server.listen(o.port ?? 0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    token,
    states: () => states,
    async close() {
      for (const c of clients) c.end();
      for (const s of stops.reverse()) await s();
      for (const m of o.modules) await m.close?.();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}
