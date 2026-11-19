import assert from "node:assert/strict";
import { test } from "node:test";
import { canary } from "../src/canary.ts";

test("the canary returns its expected value", () => {
  assert.equal(canary(), "spawn");
});
