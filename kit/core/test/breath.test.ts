// Recul de l'agent sur ses tests : série des rouges du même test, recul au 2ᵉ, arrêt au 3ᵉ, fin propre à 45 min.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, test } from "node:test";
import { AGENT_STARTED_ENV, breathe, failureKeys, nextStreak, STEP_BACK, STOP, WRAP_UP } from "../src/breath.ts";
import { tempDir, cleanDirs } from "./git-helper.ts";

after(cleanDirs);

const red = (file: string) => ({ ok: false, errors: [{ code: "test-failed", message: "assertion", file }] });
const green = { ok: true, errors: [] };

test("breath: same test red twice → step back, three times → stop; a green or another test resets", () => {
  const path = join(tempDir("breath"), "reds.json");
  const env = { [AGENT_STARTED_ENV]: "2026-11-23T10:00:00.000Z" };
  const at = Date.parse("2026-11-23T10:10:00.000Z");
  assert.equal(breathe(path, red("test/a.fx"), env, at), null, "un premier rouge est normal (TDD)");
  assert.equal(breathe(path, red("test/a.fx"), env, at), STEP_BACK);
  assert.equal(breathe(path, red("test/a.fx"), env, at), STOP);
  assert.equal(breathe(path, green, env, at), null);
  assert.equal(breathe(path, red("test/a.fx"), env, at), null, "le vert remet à zéro");
  assert.equal(breathe(path, red("test/b.fx"), env, at), null, "un autre test n'est pas le même entêtement");
  assert.equal(breathe(path, red("test/b.fx"), { [AGENT_STARTED_ENV]: "2026-11-23T10:05:00.000Z" }, at), null, "un autre agent repart de zéro");
});

test("breath: wrap-up asked once after 45 min, the stop still wins", () => {
  const path = join(tempDir("breath"), "reds.json");
  const env = { [AGENT_STARTED_ENV]: "2026-11-23T10:00:00.000Z" };
  assert.equal(breathe(path, green, env, Date.parse("2026-11-23T10:44:00.000Z")), null);
  assert.equal(breathe(path, green, env, Date.parse("2026-11-23T10:46:00.000Z")), WRAP_UP);
  assert.equal(breathe(path, green, env, Date.parse("2026-11-23T10:50:00.000Z")), null, "une seule fois");
  assert.equal(breathe(path, green, {}, Date.parse("2026-11-23T23:00:00.000Z")), null, "sans heure de départ (console), pas de limite");
  const late = Date.parse("2026-11-23T11:00:00.000Z");
  const other = join(tempDir("breath"), "reds.json");
  breathe(other, red("t"), env, late);
  breathe(other, red("t"), env, late);
  assert.equal(breathe(other, red("t"), env, late), STOP);
});

test("breath: failure identity is the file, else the start of the message", () => {
  assert.deepEqual(failureKeys([{ code: "x", message: "m", file: "a" }, { code: "x", message: "n", file: "a" }, { code: "no-tests", message: "aucun test lancé" }]), ["a", "no-tests: aucun test lancé"]);
  assert.equal(nextStreak({ agent: null, streak: 1, failing: ["a"] }, null, false, ["b", "a"]).streak, 2, "le même test parmi d'autres prolonge la série");
});
