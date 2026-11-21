import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "spawn-ws-"));
process.env.SPAWN_CONFIG = dir;
const root = (n: string) => join(dir, n);
for (const n of ["db", "api"]) mkdirSync(root(n), { recursive: true });
writeFileSync(join(dir, "projects.json"), JSON.stringify({ projects: ["db", "api"].map((n) => ({ id: n, name: n, root: root(n) })) }));

const ws = await import("../src/workspaces.ts");
const { readRegistry } = await import("../src/registry.ts");

test("workspace, epic et dépendances", () => {
  assert.equal(readRegistry().length, 2);
  const w = ws.createWorkspace("Arena Hub", ["db", "api"]);
  assert.equal(w.id, "arena-hub");
  assert.throws(() => ws.createWorkspace("Arena Hub", []), /existe déjà/);
  assert.throws(() => ws.createWorkspace("X", ["nope"]), /inconnus/);
  const e = ws.createEpic(w.id, "Intégration", ["ça marche"]);
  ws.addEpicStory(w.id, e.id, { project: "db", story: "schema" });
  assert.throws(() => ws.addEpicStory(w.id, e.id, { project: "api", story: "routes" }, [{ project: "db", story: "absent" }]), /inconnue/);
  const out = ws.addEpicStory(w.id, e.id, { project: "api", story: "routes" }, [{ project: "db", story: "schema" }]);
  const view = ws.epicStories(out);
  assert.deepEqual(view[1]?.waiting_for, [{ project: "db", story: "schema" }]);
  assert.equal(view[0]?.state, "not-started");
  assert.deepEqual(ws.unmetDependencies(root("api"), "routes"), [{ project: "db", story: "schema" }]);
  assert.deepEqual(ws.unmetDependencies(root("db"), "schema"), []);
  assert.equal(view[0]?.metrics, null);
  mkdirSync(join(root("db"), ".spawn", "pilot", "schema"), { recursive: true });
  writeFileSync(
    join(root("db"), ".spawn", "pilot", "schema", "report.json"),
    JSON.stringify({ verdict: "merged", duration_min: 9, interventions: [{}, {}], metrics: { tokens: { cache_read: 2100000 } } }),
  );
  assert.deepEqual(ws.epicStories(out)[0]?.metrics, { verdict: "merged", duration_min: 9, interventions: 2, cache_read: 2100000 });
});

test("renommer, retirer un projet, epic renommé ou supprimé, projet oublié", () => {
  const w = ws.createWorkspace("Atelier", ["db", "api"]);
  assert.equal(ws.renameWorkspace(w.id, "  Atelier 2 ").name, "Atelier 2");
  assert.equal(ws.readWorkspaces().find((x) => x.id === "atelier")?.name, "Atelier 2", "l'identifiant ne change pas");
  const e = ws.createEpic(w.id, "Lot", []);
  ws.addEpicStory(w.id, e.id, { project: "db", story: "index" });
  ws.addEpicStory(w.id, e.id, { project: "api", story: "cache" }, [{ project: "db", story: "index" }]);
  assert.throws(() => ws.removeProject(w.id, "db"), /porte des stories de ATEL-1/);
  assert.equal(ws.renameEpic(w.id, e.id, "Lot 1").title, "Lot 1");

  ws.forgetProject("db");
  const after = ws.readWorkspaces().find((x) => x.id === w.id);
  assert.deepEqual(after?.projects, ["api"]);
  assert.deepEqual(after?.epics[0]?.stories, [{ project: "api", story: "cache", blocked_by: [] }]);

  assert.equal(ws.removeEpic(w.id, e.id), true);
  assert.equal(ws.removeEpic(w.id, e.id), false);
  assert.deepEqual(ws.removeProject(w.id, "api").projects, []);
});