import assert from "node:assert/strict";
import { test } from "node:test";
import { moved } from "./reorder.ts";

test("reorder: the dragged item takes the target's place, down or up", () => {
  assert.deepEqual(moved(["a", "b", "c", "d"], "a", "c"), ["b", "c", "a", "d"]);
  assert.deepEqual(moved(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(moved(["a", "b"], "a", "a"), ["a", "b"]);
  assert.deepEqual(moved(["a", "b"], "x", "a"), ["a", "b"]);
});
