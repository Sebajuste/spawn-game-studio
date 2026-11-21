// Service : moteurs présents, diagnostic d'un dossier, adoption refusée avec le diagnostic refait. L'adoption complète
// (plugin Claude Code compris) est vérifiée dans le kit avec un Claude Code simulé.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { cleanDirs, commit, configure, tempDir } from "../../kit/core/test/git-helper.ts";
import { gitOk } from "../../kit/core/src/git.ts";
import { ENGINES_DIR } from "../../kit/core/src/project.ts";
import { MODULES } from "../src/modules/index.ts";
import { startService, type Service } from "../src/server.ts";

const FAKE_ENGINES = fileURLToPath(new URL("../../kit/core/test/adapters/", import.meta.url));
process.env.SPAWN_ENGINES = FAKE_ENGINES;
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
  assert.deepEqual((await api("GET", "/api/adapters")).body, [{ engine: "fake", title: "fake", product: "jeu", active: true, projects: 0 }]);
  assert.equal((await api("PUT", "/api/adapters/fake", { active: false })).status, 409, "le dernier moteur coché le reste");
  assert.equal((await api("PUT", "/api/adapters/absent", { active: false })).status, 404);

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

test("engines unchecked on this machine: listed as such, no longer offered to create, diagnose or adopt", async () => {
  const api = await service();
  process.env.SPAWN_ENGINES = ENGINES_DIR;
  try {
    const after = (await api("PUT", "/api/adapters/godot", { active: false })).body as Body[];
    assert.equal(after.find((a) => a.engine === "godot")?.active, false);
    assert.equal((await api("GET", "/api/adapters")).body.find((a: Body) => a.engine === "node").active, true);
    const repo = existing();
    const refused = await api("POST", "/api/projects/diagnose", { dir: repo, engine: "godot" });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /décoché/);
    assert.equal((await api("POST", "/api/projects/adopt", { dir: repo, engine: "godot", version: "4.4", tag: "BOU" })).status, 400);
    assert.match((await api("POST", "/api/projects/new", { name: "x", parent: tempDir("new"), engine: "godot", version: "4.4" })).body.error, /décoché/);
    assert.equal((await api("PUT", "/api/adapters/godot", { active: true })).body.find((a: Body) => a.engine === "godot").active, true);
  } finally {
    process.env.SPAWN_ENGINES = FAKE_ENGINES;
  }
});
