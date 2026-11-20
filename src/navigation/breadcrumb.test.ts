import { test } from "node:test";
import assert from "node:assert/strict";
import { crumbs, type Names } from "./breadcrumb.ts";
import { projectRoute, workspaceRoute, type Place } from "./route.ts";

const names: Names = {
  project: (id) => `P:${id}`,
  workspace: (id) => `W:${id}`,
  epic: (_w, id) => `E:${id}`,
};
const label = (p: Place) => `L:${p}`;

test("une story ouverte depuis un workspace : workspace › projet › lieu › story", () => {
  const list = crumbs(projectRoute("api", "ws", "home", "routes"), names, label);
  assert.deepEqual(
    list.map((c) => c.label),
    ["W:ws", "P:api", "L:home", "routes"],
  );
  assert.deepEqual(list[0]?.route, workspaceRoute("ws"));
  assert.deepEqual(list[1]?.route, projectRoute("api", "ws"));
  assert.deepEqual(list[2]?.route, projectRoute("api", "ws", "home"));
  assert.equal(list[3]?.route, null);
});

test("un projet hors workspace : projet › lieu, le lieu n'est pas cliquable", () => {
  const list = crumbs(projectRoute("api", null, "backlog"), names, label);
  assert.deepEqual(
    list.map((c) => [c.label, c.route]),
    [
      ["P:api", projectRoute("api")],
      ["L:backlog", null],
    ],
  );
});

test("un epic : workspace › Epics › epic", () => {
  const list = crumbs(workspaceRoute("ws", "epics", "ARN-2"), names, label);
  assert.deepEqual(
    list.map((c) => c.label),
    ["W:ws", "L:epics", "E:ARN-2"],
  );
  assert.deepEqual(list[1]?.route, workspaceRoute("ws", "epics"));
});

test("le sélecteur de portée n'a pas de fil d'Ariane", () => {
  assert.deepEqual(crumbs({ kind: "picker" }, names, label), []);
});
