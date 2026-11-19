import assert from "node:assert/strict";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { createStory, storiesDir, readStory, listStories, updateStory, transitionAllowed, type Status } from "../src/stories.ts";
import { tempDir, cleanDirs } from "./git-helper.ts";

after(cleanDirs);
const BASE = "a".repeat(40);
const created = (story: string) => ({ story, branch: `feature/${story}`, worktree: `.claude/worktrees/${story}`, base: BASE });

test("allowed and forbidden transitions", () => {
  const allowedSet: [Status, Status][] = [
    ["active", "compacting"],
    ["compacting", "active"],
    ["active", "handoff-pending"],
    ["handoff-pending", "active"],
    ["active", "blocked:decision"],
    ["blocked:decision", "active"],
    ["active", "done"],
    ["done", "active"],
    ["done", "cleaned"],
    ["active", "active"],
  ];
  const forbidden: [Status, Status][] = [
    ["active", "cleaned"],
    ["compacting", "done"],
    ["blocked:decision", "done"],
    ["handoff-pending", "cleaned"],
    ["cleaned", "active"],
    ["cleaned", "cleaned"],
  ];
  for (const [from, to] of allowedSet) assert.ok(transitionAllowed(from, to), `${from} → ${to} devrait être permise`);
  for (const [from, to] of forbidden) assert.ok(!transitionAllowed(from, to), `${from} → ${to} devrait être refusée`);
});

test("creation, update and read back", () => {
  const root = tempDir("stories");
  const t0 = new Date("2026-11-17T10:00:00Z");
  const story = createStory(root, created("caserne"), t0);
  assert.equal(story.status, "active");
  assert.equal(story.updated, t0.toISOString());
  updateStory(root, "caserne", { status: "compacting", task: "Task 4" });
  const reread = readStory(root, "caserne");
  assert.equal(reread?.status, "compacting");
  assert.equal(reread?.task, "Task 4");
  assert.deepEqual(listStories(root).map((f) => f.story), ["caserne"]);
  assert.deepEqual(readdirSync(storiesDir(root)), ["caserne.json"], "aucun fichier temporaire ne doit rester");
});

test("refusals: forbidden transition, live story recreated, invalid name, invalid field", () => {
  const root = tempDir("stories");
  createStory(root, created("vol"));
  assert.throws(() => updateStory(root, "vol", { status: "cleaned" }), /transition refusée.*active → cleaned/);
  assert.equal(readStory(root, "vol")?.status, "active", "un refus ne modifie pas le fichier");
  assert.throws(() => createStory(root, created("vol")), /existe déjà/);
  assert.throws(() => createStory(root, created("Vol Libre")), /nom de fil invalide/);
  assert.throws(() => createStory(root, { ...created("mer"), base: "court" }), /invalide/);
  assert.throws(() => updateStory(root, "vol", { status: "blocked:Decision Humaine" as Status }), /invalide/);
  assert.throws(() => updateStory(root, "absent", { task: "x" }), /introuvable/);
});

test("a cleaned story is final, but its name can be reused", () => {
  const root = tempDir("stories");
  createStory(root, created("mer"));
  updateStory(root, "mer", { status: "done" });
  updateStory(root, "mer", { status: "cleaned", worktree: null });
  assert.throws(() => updateStory(root, "mer", { task: "x" }), /transition refusée/);
  assert.equal(createStory(root, created("mer")).status, "active");
});

test("a corrupt story file is reported, not ignored", () => {
  const root = tempDir("stories");
  createStory(root, created("terrain"));
  writeFileSync(join(storiesDir(root), "terrain.json"), JSON.stringify({ story: "terrain", status: "perdu" }));
  assert.throws(() => readStory(root, "terrain"), /invalide/);
});
