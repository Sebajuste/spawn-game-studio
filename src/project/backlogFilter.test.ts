import { test } from "node:test";
import assert from "node:assert/strict";
import { countByFilter, filterBacklog } from "./backlogFilter.ts";
import type { StoryView } from "../shared/api.ts";

const s = (story: string, group: StoryView["group"], result: StoryView["result"] = null, title = story) => ({ story, group, result, title, request: null }) as StoryView;
const list = [s("a", "active"), s("b", "blocked"), s("c", "history", "accepted", "Score"), s("d", "history", "abandoned"), s("e", "history", null)];

test("livrées = acceptées ; fermées = abandonnées ou closes sans recette", () => {
  assert.deepEqual(countByFilter(list), { open: 2, delivered: 1, closed: 2 });
});

test("la recherche porte sur le titre, la demande et le nom", () => {
  assert.deepEqual(
    filterBacklog(list, "delivered", "scor").map((x) => x.story),
    ["c"],
  );
  assert.deepEqual(filterBacklog(list, "closed", "zzz"), []);
});
