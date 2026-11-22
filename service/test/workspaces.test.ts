// Service : gestion d'un workspace (renommer, retirer un projet, epic renommé ou supprimé) ; un projet qui quitte
// Spawn sort aussi de ses workspaces.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { cleanDirs, spawnProject } from "../../kit/core/test/git-helper.ts";
import { MODULES } from "../src/modules/index.ts";
import { startService, type Service } from "../src/server.ts";

process.env.SPAWN_ENGINES = fileURLToPath(new URL("../../kit/core/test/adapters/", import.meta.url));
const services: Service[] = [];
after(async () => {
  for (const s of services) await s.close();
  cleanDirs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- réponses JSON lues champ par champ dans les assertions
type Body = Record<string, any>;

test("rename, remove a project, rename and delete an epic, forget a project", async () => {
  const s = await startService({ modules: MODULES, log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: Body }> => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as Body };
  };
  const a = (await api("POST", "/api/projects", { dir: spawnProject() })).body.id as string;
  const b = (await api("POST", "/api/projects", { dir: spawnProject() })).body.id as string;
  const w = (await api("POST", "/api/workspaces", { name: "Boutique", projects: [a, b] })).body;

  assert.equal((await api("PATCH", `/api/workspaces/${w.id}`, { name: "Boutique en ligne" })).body.name, "Boutique en ligne");
  const epic = (await api("POST", `/api/workspaces/${w.id}/epics`, { title: "Paiement" })).body;
  await api("POST", `/api/workspaces/${w.id}/epics/${epic.id}/stories`, { project: a, story: "panier" });
  const refused = await api("DELETE", `/api/workspaces/${w.id}/projects/${a}`);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /porte des stories/);
  assert.deepEqual((await api("DELETE", `/api/workspaces/${w.id}/projects/${b}`)).body.projects, [a]);
  assert.equal((await api("PATCH", `/api/workspaces/${w.id}/epics/${epic.id}`, { title: "Paiement 1" })).body.title, "Paiement 1");

  await api("DELETE", `/api/projects/${a}`);
  const after = (await api("GET", "/api/workspaces")).body.find((x: Body) => x.id === w.id);
  assert.deepEqual(after.projects, []);
  assert.deepEqual(after.epics[0].stories, []);
  assert.equal((await api("DELETE", `/api/workspaces/${w.id}/epics/${epic.id}`)).status, 200);
  assert.equal((await api("DELETE", `/api/workspaces/${w.id}/epics/${epic.id}`)).status, 404);
});
