import { test } from "node:test";
import assert from "node:assert/strict";
import { pickerRows } from "./pickerRows.ts";
import { formatRoute } from "../navigation/route.ts";

const projects = [
  { id: "ar-api", name: "ar-api", open_stories: 1 },
  { id: "ar-db", name: "ar-db", open_stories: 0 },
  { id: "hello", name: "hello-web", open_stories: 2 },
];
const workspaces = [{ id: "ar", name: "Arena", projects: ["ar-api", "ar-db"] }];

test("un projet de workspace s'ouvre avec le workspace pour parent ; les autres sont hors workspace", () => {
  const rows = pickerRows(projects, workspaces, "");
  assert.deepEqual(
    rows.workspaces.map((r) => formatRoute(r.route)),
    ["#/w/ar", "#/w/ar/p/ar-api", "#/w/ar/p/ar-db"],
  );
  assert.deepEqual(
    rows.standalone.map((r) => r.label),
    ["hello-web"],
  );
});

test("la recherche garde le workspace d'un projet trouvé, avec ce projet seulement", () => {
  const rows = pickerRows(projects, workspaces, "db");
  assert.deepEqual(
    rows.workspaces.map((r) => r.key),
    ["w:ar", "w:ar/ar-db"],
  );
  assert.deepEqual(rows.standalone, []);
});
