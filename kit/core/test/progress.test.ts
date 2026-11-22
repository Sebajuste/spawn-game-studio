// Avancement lisible d'un fil : chaque étape suit le ledger et le plan ; une redemande rouvre le jugement ; un abandon
// ne passe rien pour fait.
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { progress, stepIndex } from "../src/progress.ts";
import { ledgerPath } from "../src/context.ts";
import { readStory, updateStory } from "../src/stories.ts";
import { createWorktree } from "../src/hooks/worktree.ts";
import { write, type LedgerEvent } from "../src/ledger.ts";
import { cleanDirs, spawnProject } from "./git-helper.ts";

after(cleanDirs);
const ENGINES = fileURLToPath(new URL("./adapters/", import.meta.url));

test("progress: understand, breakdown, tasks, proof, acceptance, merge", async () => {
  const root = spawnProject();
  const wt = await createWorktree({ cwd: root, name: "pion" }, { engines: ENGINES, log: () => {} });
  let h = Date.parse("2026-11-18T10:00:00Z");
  const ev = (e: Record<string, unknown>) => write(ledgerPath(root, "pion"), { date: new Date((h += 1000)).toISOString(), ...e } as LedgerEvent);
  let step: string | null = null;
  const view = () => {
    const story = readStory(root, "pion");
    assert.ok(story);
    return Object.fromEntries(progress(root, story, step).steps.map((e) => [e.id, e]));
  };
  const states = () => Object.values(view()).map((e) => e.state).join(" ");

  assert.equal(states(), "current pending pending pending pending pending");
  assert.equal(view().understand?.detail, null);
  updateStory(root, "pion", { status: "blocked:decision" });
  assert.equal(view().understand?.detail, "à valider");
  updateStory(root, "pion", { status: "active" });
  assert.equal(view().understand?.detail, null, "aucun libellé d'activité");
  updateStory(root, "pion", { status: "active" });
  ev({ type: "spec-approved", path: "docs/specs/s.md" });
  mkdirSync(join(wt, "docs", "plans"), { recursive: true });
  writeFileSync(join(wt, "docs", "plans", "p.md"), "## Tâche 1 : scène\n## Tâche 2 : chute\n");
  ev({ type: "plan", path: "docs/plans/p.md" });
  ev({ type: "task-started", task: 1, base: "a" });
  ev({ type: "task-done", task: 1, commits: "a..b" });
  ev({ type: "task-started", task: 2, base: "b" });
  ev({ type: "round", task: 2, number: 1, detail: "x" });
  assert.equal(states(), "done done current pending pending pending");
  assert.deepEqual(view().tasks?.tasks?.map((t) => `${t.title}:${t.state}:${t.rounds}`), ["scène:done:0", "chute:current:1"]);
  assert.equal(view().tasks?.detail, "1/2");

  ev({ type: "task-done", task: 2, commits: "b..c" });
  assert.equal(states(), "done done done current pending pending");
  ev({ type: "final-review", verdict: "clean" });
  ev({ type: "captures", paths: ["a.png"], verdict: "valid" });
  assert.equal(view().proof?.detail, "pas encore vérifiée par l'outil", "des captures déclarées ne sont pas une preuve");
  ev({ type: "proof", compilation: "ok", tests: "12/12", launch: "ok", end_to_end: "1" });
  ev({ type: "acceptance-report", summary: "f", how_to_check: "v" });
  updateStory(root, "pion", { status: "in-acceptance" });
  assert.equal(states(), "done done done done current pending");

  updateStory(root, "pion", { status: "active" });
  ev({ type: "changes-requested", message: "plus haut" });
  step = "correction demandée";
  assert.equal(view().acceptance?.detail, "redemandée : plus haut");
  assert.equal(view().acceptance?.state, "pending");

  step = null;
  ev({ type: "accepted" });
  updateStory(root, "pion", { status: "done", task: "fusion" });
  assert.equal(states(), "done done done done done current");
  ev({ type: "merged", commit: "f".repeat(40) });
  assert.equal(states(), "done done done done done done");
});

test("progress: an abandon marks nothing as done", async () => {
  const root = spawnProject();
  await createWorktree({ cwd: root, name: "son" }, { engines: ENGINES, log: () => {} });
  write(ledgerPath(root, "son"), { date: new Date().toISOString(), type: "abandoned" });
  updateStory(root, "son", { status: "done" });
  updateStory(root, "son", { status: "cleaned", worktree: null });
  const story = readStory(root, "son");
  assert.ok(story);
  assert.ok(progress(root, story, null).steps.every((e) => e.state === "pending"));
});

const IDS = ["understand", "breakdown", "tasks", "proof", "acceptance", "merge"];

test("progress: une étape connue donne exactement une étape en cours à la bonne place", async () => {
  const root = spawnProject();
  await createWorktree({ cwd: root, name: "a" }, { engines: ENGINES, log: () => {} });
  const story = readStory(root, "a");
  assert.ok(story);
  const cases: [string, number][] = [
    ["spec", 0], ["spec à revoir", 0], ["spec proposée, fil à mettre en attente", 0], ["plan", 1], ["plan introuvable", 1], ["plan illisible", 1],
    ["tâche 1/2, lancer", 2], ["tâche 2/2 : correction", 2], ["correction demandée", 2], ["corrections à planifier", 2], ["plafond de la relecture finale", 3],
    ["relecture finale", 3], ["corrections de la relecture finale", 3], ["relecture finale approuvée", 3],
    ["worktree à commiter", 3], ["preuve et captures", 3], ["compte rendu à juger", 3],
    ["à juger", 4], ["fusion", 5], ["fusion refusée (failing)", 5], ["après fusion", 5],
  ];
  for (const [step, at] of cases) {
    const { steps, unknownStep } = progress(root, story, step);
    assert.equal(unknownStep, null, step);
    assert.deepEqual(steps.map((s) => s.state), IDS.map((_, i) => (i < at ? "done" : i === at ? "current" : "pending")), step);
  }
  assert.equal(stepIndex("terminé"), "finished");
  for (const s of ["en attente de l'utilisateur", "fils en cours", "aucun fil", "état absent"]) assert.equal(stepIndex(s), "none");
  assert.equal(progress(root, story, "terminé").steps.every((s) => s.state === "done"), true);
  // Sans étape (ou « none ») : la première étape que le ledger ne donne pas faite.
  assert.equal(progress(root, story, "aucun fil").steps[0]?.state, "current");
});

test("progress: contrôle négatif, le ledger de l'essai du 18/11 ne donne ni deux en cours ni un fait après un pas fait", async () => {
  const root = spawnProject();
  const wt = await createWorktree({ cwd: root, name: "essai" }, { engines: ENGINES, log: () => {} });
  let h = Date.parse("2026-11-18T10:00:00Z");
  const ev = (e: Record<string, unknown>) => write(ledgerPath(root, "essai"), { date: new Date((h += 1000)).toISOString(), ...e } as LedgerEvent);
  ev({ type: "spec-approved", path: "docs/specs/s.md" });
  mkdirSync(join(wt, "docs", "plans"), { recursive: true });
  writeFileSync(join(wt, "docs", "plans", "p.md"), "## Tâche 1 : a\n## Tâche 2 : b\n## Tâche 3 : c\n");
  ev({ type: "plan", path: "docs/plans/p.md" });
  ev({ type: "task-started", task: 1, base: "a" });
  ev({ type: "task-done", task: 1, commits: "a..b" });
  ev({ type: "final-review", verdict: "clean" });
  ev({ type: "proof", compilation: "ok", tests: "1/1", launch: "ok", end_to_end: "0" });
  ev({ type: "acceptance-report", summary: "f", how_to_check: "v" });
  ev({ type: "accepted" });
  ev({ type: "task-started", task: 2, base: "b" });
  ev({ type: "task-done", task: 2, commits: "b..c" });
  ev({ type: "final-review", verdict: "clean" });
  ev({ type: "proof", compilation: "ok", tests: "2/2", launch: "ok", end_to_end: "0" });
  const story = readStory(root, "essai");
  assert.ok(story);
  for (const step of ["fusion refusée (failing)", "tâche 3/3 : correction", null, "étape inventée"]) {
    const { steps } = progress(root, story, step);
    const states = steps.map((s) => s.state);
    assert.ok(states.filter((s) => s === "current").length <= 1, `${step} : ${states}`);
    assert.ok(!/\bpending\b.*\bdone\b/.test(states.join(" ")), `${step} : ${states}`);
  }
  assert.equal(progress(root, story, "tâche 3/3 : correction").steps[2]?.state, "current");
  assert.equal(progress(root, story, "tâche 3/3 : correction").steps[5]?.state, "pending");
});

test("progress: une étape inconnue n'a aucune étape en cours et est rendue telle quelle", async () => {
  const root = spawnProject();
  await createWorktree({ cwd: root, name: "inc" }, { engines: ENGINES, log: () => {} });
  const story = readStory(root, "inc");
  assert.ok(story);
  const r = progress(root, story, "étape inventée");
  assert.equal(r.unknownStep, "étape inventée");
  assert.equal(stepIndex("étape inventée"), null);
  assert.equal(r.steps.some((s) => s.state === "current"), false);
  assert.equal(progress(root, story, "spec").unknownStep, null, "une étape connue ne produit pas ce libellé");
  assert.equal(progress(root, story, null).unknownStep, null);
});

test("progress: aucun détail ne décrit une activité", async () => {
  const root = spawnProject();
  await createWorktree({ cwd: root, name: "act" }, { engines: ENGINES, log: () => {} });
  const story = readStory(root, "act");
  assert.ok(story);
  for (const step of [null, "spec", "plan", "étape inventée"]) {
    for (const s of progress(root, story, step).steps) assert.ok(!/en cours d'écriture/.test(s.detail ?? ""), `${step} ${s.id}`);
  }
});

test("progress: l'étape où la story revient dit pourquoi, et seulement après un retour en arrière", async () => {
  const root = spawnProject();
  const wt = await createWorktree({ cwd: root, name: "retour" }, { engines: ENGINES, log: () => {} });
  let h = Date.parse("2026-11-18T10:00:00Z");
  const ev = (e: Record<string, unknown>) => write(ledgerPath(root, "retour"), { date: new Date((h += 1000)).toISOString(), ...e } as LedgerEvent);
  const decide = (d: Record<string, unknown>) => {
    const dir = join(root, ".git", "spawn", "merge");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "log.jsonl"), JSON.stringify({ date: new Date((h += 1000)).toISOString(), story: "retour", branch: "b", head: "h", ...d }) + "\n");
  };
  const story = () => {
    const s = readStory(root, "retour");
    assert.ok(s);
    return s;
  };
  const motifs = (step: string | null) => progress(root, story(), step).steps.map((s) => s.detail ?? "").filter((d) => /^(reprise|fusion refusée)/.test(d));
  const plan = join(wt, "docs", "plans", "p.md");
  ev({ type: "spec-approved", path: "docs/specs/s.md" });
  mkdirSync(join(wt, "docs", "plans"), { recursive: true });
  writeFileSync(plan, "## Tâche 1 : a\n## Tâche 2 : b\n");
  ev({ type: "plan", path: "docs/plans/p.md" });
  for (const n of [1, 2]) {
    ev({ type: "task-started", task: n, base: "a" });
    ev({ type: "task-done", task: n, commits: "a..b" });
  }
  ev({ type: "proof", compilation: "ok", tests: "1/1", launch: "ok", end_to_end: "0" });
  ev({ type: "acceptance-report", summary: "f", how_to_check: "v" });

  // Contrôle négatif : menée sans retour en arrière, aucune étape n'a de motif.
  for (const step of ["à juger", "preuve et captures", null]) assert.deepEqual(motifs(step), [], String(step));

  ev({ type: "changes-requested", message: "plus gros" });
  const redo = progress(root, story(), "correction demandée").steps;
  assert.equal(redo[2]?.state, "current");
  assert.equal(redo[2]?.detail, "reprise après recette : plus gros");
  assert.deepEqual(motifs("correction demandée"), ["reprise après recette : plus gros"]);

  ev({ type: "accepted" });
  assert.deepEqual(motifs("fusion"), [], "accepté depuis : la reprise est close");

  decide({ verdict: "queued" });
  decide({ verdict: "refused", cause: "failing" });
  const refused = progress(root, story(), "fusion refusée (failing)").steps;
  assert.equal(refused[5]?.state, "current");
  assert.equal(refused[5]?.detail, "fusion refusée : failing");

  writeFileSync(plan, "## Tâche 1 : a\n## Tâche 2 : b\n## Tâche 3 : correction\n");
  const fix = progress(root, story(), "tâche 3/3 : correction").steps;
  assert.equal(fix[2]?.state, "current");
  assert.equal(fix[2]?.tasks?.length, 3);
  assert.equal(fix[2]?.tasks?.[2]?.title, "correction");
  assert.equal(fix[2]?.detail, "fusion refusée : failing");

  decide({ verdict: "merged", commit: "f".repeat(40) });
  assert.deepEqual(motifs("fusion"), [], "une fusion réussie efface le motif");
});
