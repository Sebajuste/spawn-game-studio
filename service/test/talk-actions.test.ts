// Blocs d'action de la conversation de portée : ce que l'agent demande au service de créer (docs/conversation.md §3).
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseActions } from "../src/modules/talk/actions.ts";

const block = (o: unknown) => "```spawn\n" + JSON.stringify(o) + "\n```";

test("talk actions: a story in a project, the text around ignored", () => {
  const r = parseActions(`Je la crée.\n\n${block({ create: "story", request: "Corrige la date vide" })}\n`, "project");
  assert.deepEqual(r, { actions: [{ kind: "story", request: "Corrige la date vide" }], errors: [] });
});

test("talk actions: none without a block, and an ordinary code block is not one", () => {
  assert.deepEqual(parseActions("On a juste parlé.\n```ts\nconst a = 1;\n```", "project"), { actions: [], errors: [] });
});

test("talk actions: invalid blocks are refused with their reason, never guessed", () => {
  const r = parseActions(["```spawn\n{ pas du json\n```", block({ create: "story" }), block({ create: "release", request: "x" }), block({ create: "epic", title: "E", stories: [] })].join("\n"), "project");
  assert.equal(r.actions.length, 0);
  assert.equal(r.errors.length, 4);
  assert.match(r.errors[0] ?? "", /JSON/);
  assert.match(r.errors[1] ?? "", /request/);
  assert.match(r.errors[2] ?? "", /release/);
  assert.match(r.errors[3] ?? "", /workspace/);
});

test("talk actions: in a workspace a story names its project, an epic orders its stories", () => {
  const epic = { create: "epic", title: "Emplacement", acceptance: ["filtrer par emplacement"], stories: [{ project: "db", request: "colonne" }, { project: "api", request: "routes", after: [0] }] };
  const r = parseActions(`${block({ create: "story", request: "x" })}\n${block(epic)}\n${block({ create: "story", project: "api", request: "y" })}`, "workspace");
  assert.deepEqual(r.errors.length, 1);
  assert.match(r.errors[0] ?? "", /project/);
  assert.deepEqual(r.actions, [
    { kind: "epic", title: "Emplacement", acceptance: ["filtrer par emplacement"], stories: [{ project: "db", request: "colonne", after: [] }, { project: "api", request: "routes", after: [0] }] },
    { kind: "story", project: "api", request: "y" },
  ]);
});

test("talk actions: an epic story can only come after an earlier one", () => {
  const r = parseActions(block({ create: "epic", title: "E", stories: [{ project: "a", request: "x", after: [0] }] }), "workspace");
  assert.equal(r.actions.length, 0);
  assert.match(r.errors[0] ?? "", /after/);
});

test("talk actions: a block repeated in the final message counts once", () => {
  const b = block({ create: "story", request: "x" });
  assert.equal(parseActions(`${b}\n\n${b}`, "project").actions.length, 1);
});
