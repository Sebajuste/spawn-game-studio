// Garde contre les boucles : une même commande relancée de suite par une même session est refusée au-delà du plafond ;
// un autre appel entre deux remet le compte à zéro ; chaque session a son compte.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { repetition, MAX_REPETITIONS } from "../src/guard/repetitions.ts";
import { tempDir, cleanDirs } from "./git-helper.ts";

after(cleanDirs);

test("repetitions: refusal beyond the cap, reset by another call, per session", () => {
  const root = tempDir("repetitions");
  const cmd = "ls  addons/gut";
  for (let i = 0; i < MAX_REPETITIONS; i++) assert.equal(repetition(root, "ses_a", cmd), null);
  assert.match(repetition(root, "ses_a", "ls addons/gut") ?? "", /déjà été lancée 3 fois de suite[\s\S]*BLOCKED/, "espaces normalisés");
  assert.equal(repetition(root, "ses_b", cmd), null, "une autre session a son propre compte");
  assert.equal(repetition(root, "ses_a", "Write core/grille.gd"), null);
  assert.equal(repetition(root, "ses_a", cmd), null, "un autre appel entre deux remet le compte à zéro");
});

test("repetitions: spawn next is never refused, it gives the action to take", () => {
  const root = tempDir("repetitions");
  const nextAction = String.raw`node "C:\Dev\spawn-game-studio\kit\core\src\cli.ts" next`;
  for (let i = 0; i < MAX_REPETITIONS + 3; i++) assert.equal(repetition(root, "ses_a", nextAction), null);
});
