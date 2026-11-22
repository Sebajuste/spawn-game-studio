import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdoptionView, DiagnosisPoint } from "../shared/api.ts";
import { adoptionNotes, groupPoints } from "./points.ts";

const point = (group: DiagnosisPoint["group"], label: string): DiagnosisPoint => ({ status: "ok", group, label });
const adoption = (over: Partial<AdoptionView>): AdoptionView => ({
  project: { id: "p", name: "p", root: "C:\\p", engine: "node", version: "24", tag: "PAD", open_stories: 0, problem: null },
  commit: "3f2a9c1",
  baseline: null,
  gaps: [],
  leftovers: [],
  ...over,
});

test("les points se rangent dans l'ordre de l'adoption, sans groupe vide", () => {
  const groups = groupPoints([point("plugin", "plugin"), point("git", "develop"), point("files", "spawn.json"), point("git", "arbre")]);
  assert.deepEqual(
    groups.map((g) => [g.group, g.points.map((p) => p.label)]),
    [
      ["git", ["develop", "arbre"]],
      ["files", ["spawn.json"]],
      ["plugin", ["plugin"]],
    ],
  );
});

test("une suite de départ rouge est dite, avec ses échecs", () => {
  const notes = adoptionNotes(adoption({ baseline: { ok: false, total: 41, passed: 39, failed: 2, message: null } }));
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.status, "warn");
  assert.match(notes[0]?.label ?? "", /2/);
});

test("une suite qui n'a pas tourné, les manques du gabarit et les restes non commités sont dits", () => {
  const notes = adoptionNotes(adoption({ baseline: { ok: false, total: 0, passed: 0, failed: 0, message: "npm introuvable" }, gaps: [{ code: "no-spawn-url", message: "lancement sans SPAWN-URL" }], leftovers: ["coverage/"] }));
  assert.deepEqual(
    notes.map((n) => [n.status, n.detail]),
    [
      ["warn", "npm introuvable"],
      ["warn", "no-spawn-url"],
      ["warn", "coverage/"],
    ],
  );
});

test("un projet déjà Spawn, seulement inscrit, n'a rien à signaler", () => {
  assert.deepEqual(adoptionNotes(adoption({ commit: null })), []);
});
