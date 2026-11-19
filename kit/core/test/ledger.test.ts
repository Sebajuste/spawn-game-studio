// Ledger typé : écriture, relecture, refus des formes invalides, rendu lisible, ancien format en lecture seule.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { legacyPath, write, LedgerError, readLedger, render, RESERVED, fromOptions, TYPES, type LedgerEvent } from "../src/ledger.ts";
import { tempDir, cleanDirs } from "./git-helper.ts";

after(cleanDirs);

const DATE = "2026-11-17T16:53:00.000Z";
const opts = (o: Record<string, string | string[]>) => new Map(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v : [v]]));

const EXAMPLES: Record<LedgerEvent["type"], Record<string, string | string[]>> = {
  "spec-proposed": { path: "docs/specs/2026-11-17-morpion.md" },
  "spec-approved": { path: "docs/specs/2026-11-17-morpion.md" },
  plan: { path: "docs/plans/2026-11-17-morpion.md" },
  "task-started": { task: "1", base: "abc1234" },
  "task-done": { task: "1", commits: "abc1234..def5678" },
  round: { task: "2", number: "3", detail: "2 importants ; commits a..b" },
  "task-parked": { task: "4", detail: "flou du rendu", ruling: "parquer — hors spec — dette visible" },
  minor: { task: "2", detail: "nom de variable" },
  ruling: { decision: "grille 3x3 fixe", reason: "spec", cost: "refaire la grille" },
  "final-review": { verdict: "changes", detail: "2 importants ; commits c..d" },
  captures: { paths: ["a.png", "b.png"], verdict: "valid" },
  proof: { compilation: "ok", tests: "35/35", launch: "ok", end_to_end: "2" },
  "acceptance-report": { summary: "un score par joueur", how_to_check: "gagner deux parties" },
  "changes-requested": { message: "le score est trop petit" },
  accepted: {},
  abandoned: { reason: "plus utile" },
  merged: { commit: "7c534fe" },
  note: { text: "Godot débloqué" },
};

test("ledger: every type is written then read back identically, one JSON line per event", () => {
  const path = join(tempDir("ledger"), ".spawn", "ledgers", "morpion.jsonl");
  const writtenFiles = TYPES.map((type) => fromOptions(type, opts(EXAMPLES[type]), 5, DATE));
  for (const ev of writtenFiles) write(path, ev);
  assert.deepEqual(readLedger(path), writtenFiles);
  const lines = readFileSync(path, "utf8").trim().split("\n");
  assert.equal(lines.length, TYPES.length);
  assert.deepEqual(JSON.parse(lines[5] ?? ""), { date: DATE, type: "round", task: 2, number: 3, detail: "2 importants ; commits a..b" });
});

test("ledger: invalid shapes refused with the expected shape", () => {
  const refusal = (type: string, o: Record<string, string | string[]>, pattern: RegExp) =>
    assert.throws(() => fromOptions(type, opts(o), 5, DATE), (e: unknown) => e instanceof LedgerError && pattern.test(e.message));
  refusal("ajouter", { text: "x" }, /type d'événement inconnu.*\n.*spawn ledger spec-proposed --path/s);
  refusal("round", { task: "2", detail: "x" }, /--number manquant ; forme attendue : spawn ledger round --task <n> --number <1\.\.5> --detail/);
  refusal("round", { task: "2", number: "6", detail: "x" }, /--number : entier attendu de 1 à 5, reçu « 6 »/);
  refusal("round", { task: "2", number: "0", detail: "x" }, /de 1 à 5/);
  refusal("round", { task: "2", number: "2.5", detail: "x" }, /entier attendu/);
  refusal("task-started", { task: "Tâche 3", base: "abc" }, /--task : entier attendu à partir de 1/);
  refusal("task-done", { task: "1", commits: "" }, /--commits : texte vide/);
  refusal("note", { text: "x", detail: "y" }, /option inconnue --detail/);
  refusal("ruling", { decision: ["a", "b"], reason: "r", cost: "c" }, /donné plusieurs fois/);
  refusal("final-review", { verdict: "correction" }, /clean ou changes attendu/);
  refusal("final-review", { verdict: "changes" }, /--detail requis avec le verdict changes/);
  refusal("captures", { paths: "a.png", verdict: "ok" }, /valid ou invalid ou undecidable attendu/);
  assert.equal(fromOptions("round", opts({ task: "2", number: "7", detail: "x" }), 8, DATE).type, "round", "le plafond vient de l'appelant");
  assert.equal(fromOptions("final-review", opts({ verdict: "clean" }), 5, DATE).type, "final-review", "detail facultatif si propre");
});

test("ledger: readable rendering; user decisions are reserved to the app", () => {
  const ev = (type: LedgerEvent["type"], o: Record<string, string | string[]>) => fromOptions(type, opts(o), 5, DATE);
  assert.equal(render(ev("round", EXAMPLES.round)), "2026-11-17 16:53 tâche 2 round 3 : 2 importants ; commits a..b");
  assert.equal(render(ev("task-parked", EXAMPLES["task-parked"])), "2026-11-17 16:53 tâche 4 parquée : flou du rendu — Ruling: parquer — hors spec — dette visible");
  assert.equal(render(ev("captures", EXAMPLES.captures)), "2026-11-17 16:53 captures valide : a.png, b.png");
  assert.equal(render(ev("final-review", { verdict: "clean" })), "2026-11-17 16:53 relecture finale propre");

  assert.equal(render(ev("spec-proposed", EXAMPLES["spec-proposed"])), "2026-11-17 16:53 spec proposée : docs/specs/2026-11-17-morpion.md");
  assert.deepEqual(Object.keys(RESERVED).sort(), ["abandoned", "accepted", "changes-requested", "merged", "proof", "spec-approved"]);
  assert.match(RESERVED["spec-approved"] ?? "", /spec-proposed[\s\S]*blocked:spec-approval/);
});

test("ledger: the legacy .md is read as notes, before typed events, and never written", () => {
  const path = join(tempDir("ledger"), "morpion.jsonl");
  const legacy = "# Ledger du fil morpion\n\n- 2026-11-17T16:51:00.000Z Spec validée : docs/specs/x.md\n- 2026-11-17T16:53:00.000Z Tâche 1 : round 1/5 (a)\n";
  writeFileSync(legacyPath(path), legacy);
  write(path, fromOptions("merged", opts({ commit: "7c534fe" }), 5, DATE));
  writeFileSync(path, readFileSync(path, "utf8") + "pas du json\n");
  const evs = readLedger(path);
  assert.deepEqual(evs.slice(0, 2), [
    { date: "2026-11-17T16:51:00.000Z", type: "note", text: "Spec validée : docs/specs/x.md" },
    { date: "2026-11-17T16:53:00.000Z", type: "note", text: "Tâche 1 : round 1/5 (a)" },
  ]);
  assert.equal(evs[2]?.type, "merged");
  assert.match(evs[3]?.type === "note" ? evs[3].text : "", /ligne 2 illisible.*pas du json/, "une ligne abîmée reste visible");
  assert.equal(readFileSync(legacyPath(path), "utf8"), legacy);
});
