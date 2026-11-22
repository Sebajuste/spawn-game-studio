import assert from "node:assert/strict";
import { test } from "node:test";
import { setLang } from "../i18n/i18n.ts";
import { stateLabel } from "./epicState.ts";

test("SGS-55: a blocked story says so, an unlabelled state shows as is, a known state keeps its label", () => {
  assert.equal(stateLabel("blocked:decision"), "blocked: your decision");
  assert.equal(stateLabel("blocked:spec-approval"), "blocked: your decision");
  assert.equal(stateLabel("compacting"), "compacting");
  assert.equal(stateLabel("active"), "in progress", "contrôle négatif");

  // setLang écrit la langue sur le document, absent sous Node.
  Object.defineProperty(globalThis, "document", { value: { documentElement: {} }, configurable: true });
  setLang("fr");
  assert.equal(stateLabel("blocked:decision"), "bloquée : ta décision");
  assert.equal(stateLabel("active"), "en cours", "contrôle négatif");
});
