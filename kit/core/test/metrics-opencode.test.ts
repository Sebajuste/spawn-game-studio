import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { measureOpencode } from "../src/metrics-opencode.ts";

// Exports réels (réduits) d'un run OpenCode v2.2.6 : la session principale délègue à un sous-agent `general`.
const exports = JSON.parse(readFileSync(new URL("data/opencode-export-subagent.json", import.meta.url), "utf8")) as unknown[];

test("OpenCode metrics: main and child session, subagent instruction excluded, title counted", () => {
  const m = measureOpencode(exports);
  assert.equal(m.sessions, 2);
  assert.deepEqual(
    m.interventions.map((i) => [i.session, i.date]),
    [["ses_e15340d3effefJvar03DiGFfsI", new Date(1794940598223).toISOString()]],
  );
  assert.match(m.interventions[0]?.text ?? "", /^Ne lance aucune commande/);
  // info.tokens : principale 18364 / 218 + 288 de raisonnement, enfant 15752 / 78 + 84.
  const expected = { input: 18364 + 15752, cache_write: 0, cache_read: 0, output: 218 + 288 + 78 + 84 };
  assert.deepEqual(m.tokens, expected);
  assert.deepEqual(m.by_model, { "lmstudio/qwen/qwen3.5-9b": expected });
});

test("OpenCode metrics: repeated or unreadable export ignored", () => {
  const m = measureOpencode([...exports, exports[0], null, { info: {} }, "text"]);
  assert.equal(m.sessions, 2);
  assert.equal(m.tokens.input, 18364 + 15752);
});

test("OpenCode metrics: model per message, the rest of the session to the session model", () => {
  const m = measureOpencode([
    {
      info: { id: "s", model: { providerID: "p", id: "a" }, tokens: { input: 100, output: 10, cache: { read: 5, write: 0 } } },
      messages: [
        { type: "user", text: "vas-y", time: { created: 0 } },
        { type: "assistant", model: { providerID: "p", id: "b" }, tokens: { input: 60, output: 4, cache: { read: 5, write: 0 } } },
      ],
    },
  ]);
  assert.deepEqual(m.by_model, {
    "p/b": { input: 60, cache_write: 0, cache_read: 5, output: 4 },
    "p/a": { input: 40, cache_write: 0, cache_read: 0, output: 6 },
  });
  assert.deepEqual(m.tokens, { input: 100, cache_write: 0, cache_read: 5, output: 10 });
  assert.deepEqual(m.interventions, [{ session: "s", date: "1970-01-01T00:00:00.000Z", text: "vas-y" }]);
});
