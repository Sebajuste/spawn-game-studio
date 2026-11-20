import { test } from "node:test";
import assert from "node:assert/strict";
import { goToEntries, matchEntries } from "./goto.ts";
import { formatRoute } from "./route.ts";
import type { EpicView, StoryView } from "../shared/api.ts";

const story = (story: string, group: StoryView["group"]) => ({ story, group, title: story.toUpperCase(), request: null }) as StoryView;
const backlogs = new Map([
  ["api", [story("login", "blocked"), story("health", "active")]],
  ["web", null],
]);

test("une story qui attend l'utilisateur s'ouvre dans À traiter, les autres dans le Backlog", () => {
  const entries = goToEntries(["api", "web"], backlogs, null, (p) => p, () => "");
  assert.deepEqual(
    entries.map((e) => formatRoute(e.route)),
    ["#/p/api/inbox/s/login", "#/p/api/backlog/s/health"],
  );
});

test("dans un workspace, les epics d'abord et chaque story garde le workspace pour parent", () => {
  const ws = { id: "ar", epics: [{ id: "eq", title: "Équipements" } as EpicView] };
  const entries = goToEntries(["api"], backlogs, ws, (p) => p.toUpperCase(), () => "x");
  const [epic, story] = entries;
  assert.ok(epic && story);
  assert.equal(formatRoute(epic.route), "#/w/ar/epics/eq");
  assert.equal(formatRoute(story.route), "#/w/ar/p/api/inbox/s/login");
  assert.equal(story.detail, "API · x");
  assert.deepEqual(
    matchEntries(entries, "équip").map((e) => e.key),
    ["e:eq"],
  );
});
