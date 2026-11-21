// Service : moteurs présents, diagnostic d'un dossier, adoption refusée avec le diagnostic refait. L'adoption complète
// (plugin Claude Code compris) est vérifiée dans le kit avec un Claude Code simulé.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { cleanDirs, commit, configure, tempDir } from "../../kit/core/test/git-helper.ts";
import { gitOk } from "../../kit/core/src/git.ts";
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

async function service() {
  const s = await startService({ modules: MODULES, log: () => {} });
  services.push(s);
  return async (method: string, path: string, body?: unknown): Promise<{ status: number; body: Body }> => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as Body };
  };
}

function existing(): string {
  const repo = join(tempDir("adopt"), "boutique");
  mkdirSync(repo);
  gitOk(repo, ["init", "--quiet", "-b", "main"]);
  configure(repo);
  commit(repo, "fake.project", "projet\n", "existant");
  return repo;
}

test("adapters, diagnosis, refused adoption carries the new diagnosis", async () => {
  const api = await service();
  assert.deepEqual((await api("GET", "/api/adapters")).body, [{ engine: "fake", title: "fake" }]);

  const repo = existing();
  const d = (await api("POST", "/api/projects/diagnose", { dir: repo })).body;
  assert.equal(d.engine, "fake");
  assert.equal(d.tag, "BOU");
  assert.equal(d.ready, true);
  assert.ok(d.points.some((p: Body) => p.label === "branche develop" && p.status === "add"));
  assert.equal((await api("POST", "/api/projects/diagnose", { dir: "relatif" })).status, 400);

  writeFileSync(join(repo, "brouillon.txt"), "en cours\n");
  const refused = await api("POST", "/api/projects/adopt", { dir: repo, engine: "fake", version: "1.0", tag: "BOU" });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /modifications non commitées/);
  assert.equal(refused.body.diagnosis.ready, false);
  assert.equal((await api("POST", "/api/projects/adopt", { dir: repo })).status, 400);
});
