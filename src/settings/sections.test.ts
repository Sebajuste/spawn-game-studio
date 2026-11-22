import { test } from "node:test";
import assert from "node:assert/strict";
import { openingSection, sectionsOf, settingsScope } from "./sections.ts";
import { projectRoute, workspaceRoute } from "../navigation/route.ts";

test("les sections suivent la portée : un projet dans un workspace a les trois", () => {
  assert.deepEqual(sectionsOf(settingsScope({ kind: "picker" })), ["app"]);
  assert.deepEqual(sectionsOf(settingsScope(workspaceRoute("ws", "epics"))), ["app", "workspace"]);
  assert.deepEqual(sectionsOf(settingsScope(projectRoute("api"))), ["app", "project"]);
  assert.deepEqual(sectionsOf(settingsScope(projectRoute("api", "ws"))), ["app", "workspace", "project"]);
});

test("une section absente de la portée ouvre l'Application", () => {
  assert.equal(openingSection("project", settingsScope(workspaceRoute("ws"))), "app");
  assert.equal(openingSection("workspace", settingsScope(projectRoute("api", "ws"))), "workspace");
});
