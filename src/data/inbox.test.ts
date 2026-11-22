import { test } from "node:test";
import assert from "node:assert/strict";
import { inProgress, waitingFor, working } from "./inbox.ts";
import type { StoryView } from "../shared/api.ts";

const story = (id: string, group: StoryView["group"], running = false) => ({ story: id, group, running }) as StoryView;

const backlogs = new Map<string, StoryView[] | null>([
  ["api", [story("a1", "acceptance"), story("a2", "blocked"), story("a3", "active", true)]],
  ["db", [story("d1", "blocked"), story("d2", "history")]],
  ["site", null],
]);

test("À juger : les décisions de tous les projets, puis les recettes", () => {
  assert.deepEqual(
    waitingFor(backlogs, ["api", "db", "site"]).map((i) => `${i.project}/${i.story.story}`),
    ["api/a2", "db/d1", "api/a1"],
  );
});

test("seuls les projets de la portée comptent", () => {
  assert.deepEqual(
    waitingFor(backlogs, ["db"]).map((i) => i.story.story),
    ["d1"],
  );
});

test("en cours et au travail", () => {
  assert.deepEqual(
    inProgress(backlogs, ["api", "db"]).map((i) => i.story.story),
    ["a3"],
  );
  assert.deepEqual(
    working(backlogs, ["api", "db", "site"]).map((i) => i.story.story),
    ["a3"],
  );
});
