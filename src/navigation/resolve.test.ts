import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRoute, type Known } from "./resolve.ts";
import { projectRoute, workspaceRoute } from "./route.ts";

const known: Known = {
  projects: new Set(["api", "db", "solo"]),
  workspaces: new Map([["ws", { projects: ["api", "db"], epics: ["ARN-2"] }]]),
};

test("une adresse valide est gardée", () => {
  const route = projectRoute("api", "ws", "backlog", "routes");
  assert.deepEqual(resolveRoute(route, known), { route, gone: false });
  assert.deepEqual(resolveRoute(workspaceRoute("ws", "epics", "ARN-2"), known), { route: workspaceRoute("ws", "epics", "ARN-2"), gone: false });
});

test("un projet ou un workspace disparu ramène au sélecteur", () => {
  assert.deepEqual(resolveRoute(projectRoute("old"), known), { route: { kind: "picker" }, gone: true });
  assert.deepEqual(resolveRoute(workspaceRoute("old"), known), { route: { kind: "picker" }, gone: true });
});

test("un parent qui ne contient plus le projet est retiré", () => {
  assert.deepEqual(resolveRoute(projectRoute("solo", "ws", "backlog"), known).route, projectRoute("solo", null, "backlog"));
  assert.deepEqual(resolveRoute(projectRoute("api", "old"), known).route, projectRoute("api"));
});

test("un epic disparu ramène à la liste des epics", () => {
  assert.deepEqual(resolveRoute(workspaceRoute("ws", "epics", "ARN-9"), known).route, workspaceRoute("ws", "epics"));
});
