import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRoute, legacyRoute, parseRoute, projectRoute, workspaceRoute } from "./route.ts";

test("les adresses de la spec font l'aller-retour", () => {
  for (const hash of ["#/p/hello-web", "#/p/hello-web/backlog", "#/p/hello-web/backlog/s/greeting", "#/w/arena", "#/w/arena/epics", "#/w/arena/epics/ARN-2", "#/w/arena/projects", "#/w/arena/p/ar-api/home/s/equipment-routes", "#/w/arena/p/ar-api", "#/pick"]) {
    const route = parseRoute(hash);
    assert.ok(route, hash);
    assert.equal(formatRoute(route), hash);
  }
});

test("un projet sans lieu ouvre l'Accueil, sans parent", () => {
  assert.deepEqual(parseRoute("#/p/x"), projectRoute("x"));
});

test("les adresses de l'ancien lieu À traiter mènent à l'Accueil", () => {
  assert.deepEqual(parseRoute("#/w/ws/p/api/inbox/s/routes"), projectRoute("api", "ws", "home", "routes"));
  assert.deepEqual(parseRoute("#/w/ws/inbox"), workspaceRoute("ws"));
});

test("une story ouverte depuis un workspace garde le workspace pour parent", () => {
  assert.deepEqual(parseRoute("#/w/ws/p/api/backlog/s/routes"), projectRoute("api", "ws", "backlog", "routes"));
});

test("un epic a sa page dans le lieu Epics", () => {
  assert.deepEqual(parseRoute("#/w/ws/epics/ARN-2"), workspaceRoute("ws", "epics", "ARN-2"));
});

test("les noms sont encodés dans l'adresse", () => {
  const route = projectRoute("mon jeu/2", null, "backlog", "a&b");
  assert.equal(formatRoute(route), "#/p/mon%20jeu%2F2/backlog/s/a%26b");
  assert.deepEqual(parseRoute(formatRoute(route)), route);
});

test("une adresse vide ou illisible ne donne rien", () => {
  for (const hash of ["", "#", "#/", "#/x", "#/p", "#/p/x/history", "#/p/x/backlog/s", "#/w/ws/inbox/ARN-2", "#/w/ws/projects/x", "#/p/%E0%A4%A"]) assert.equal(parseRoute(hash), null, hash);
});

test("l'ancien format des liens est encore lu", () => {
  assert.deepEqual(legacyRoute("#workspace=ws&project=api"), projectRoute("api", "ws"));
  assert.deepEqual(legacyRoute("#workspace=ws"), workspaceRoute("ws"));
  assert.deepEqual(legacyRoute("#project=api"), projectRoute("api"));
  assert.equal(legacyRoute("#/p/x"), null);
});
