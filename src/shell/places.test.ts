import { test } from "node:test";
import assert from "node:assert/strict";
import { placesOf, withPlace } from "./places.ts";
import { projectRoute, workspaceRoute } from "../navigation/route.ts";

test("les lieux suivent la portée, dans l'ordre des raccourcis", () => {
  assert.deepEqual(placesOf(projectRoute("api")), ["inbox", "backlog"]);
  assert.deepEqual(placesOf(workspaceRoute("ws")), ["inbox", "epics", "projects"]);
  assert.deepEqual(placesOf({ kind: "picker" }), []);
});

test("changer de lieu ferme l'objet ouvert et garde le parent", () => {
  assert.deepEqual(withPlace(projectRoute("api", "ws", "inbox", "routes"), "backlog"), projectRoute("api", "ws", "backlog"));
  assert.deepEqual(withPlace(workspaceRoute("ws", "epics", "ARN-2"), "projects"), workspaceRoute("ws", "projects"));
});

test("un lieu d'une autre portée ne change rien", () => {
  const route = projectRoute("api");
  assert.equal(withPlace(route, "epics"), route);
});
