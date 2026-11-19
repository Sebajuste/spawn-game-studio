// spawn next : la prochaine action se déduit de l'état du fil, du ledger, du plan et des fichiers de travail.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ledgerPath, contextOf, type Context } from "../src/context.ts";
import { updateStory } from "../src/stories.ts";
import { gitOk } from "../src/git.ts";
import { createWorktree } from "../src/hooks/worktree.ts";
import { write, type LedgerEvent } from "../src/ledger.ts";
import { needsChanges, nextAction as stepOf, planTasks, type Action } from "../src/next.ts";

// Règle vérifiée à chaque étape de ces tests : aucun chemin absolu dans ce que lit l'agent (il le recopie dans ses plans
// et ses docs ; essai du 19/11, nom de compte de la machine dans un plan commité).
function nextAction(c: Context): Action {
  const a = stepOf(c);
  const read = [a.instruction, ...a.commands, a.proof ?? "", ...(a.run ?? []).map((s) => (s.kind === "agent" ? s.prompt : ""))];
  for (const t of read) assert.doesNotMatch(t, /(^|[\s"'«(])([A-Za-z]:[\\/]|\/(Users|home|tmp)\/)/, `chemin absolu dans « ${t.slice(0, 200)} »`);
  return a;
}
import { cleanDirs, spawnProject } from "./git-helper.ts";

after(cleanDirs);
const ENGINES = fileURLToPath(new URL("./adapters/", import.meta.url));
// Le domaine (mots « jeu », « scène principale ») vient de l'adaptateur du projet : celui des tests.
process.env.SPAWN_ENGINES = ENGINES;

// Horloge des événements : part de l'heure réelle, car les fichiers (rapport, relecture) portent la date réelle ;
// une heure fixe rendait le test faux passé cette heure-là.
let clock = Date.now();
function event(root: string, ev: Record<string, unknown>): void {
  clock += 1000;
  write(ledgerPath(root, "saut"), { date: new Date(clock).toISOString(), ...ev } as LedgerEvent);
}

function ctx(dir: string): Context {
  const c = contextOf(dir);
  assert.ok(c);
  return c;
}

test("plan tasks: « ## Tâche N : titre » headings, in order", () => {
  assert.deepEqual(planTasks("# Plan\n## Tâche 2 : saut\ntexte\n## Tache 1 - grille\n### Tâche 10 : fin\n## Autre"), [
    { number: 1, title: "grille" },
    { number: 2, title: "saut" },
    { number: 10, title: "fin" },
  ]);
});

test("review verdict: an Important finding outweighs « APPROUVÉ »; « non critique » is not a finding", () => {
  // Textes de l'essai du 19/11 : tâche 1 approuvée avec « 3. [Important] », findings sur une seule ligne.
  assert.equal(needsChanges("VERDICT : APPROUVÉ\n1. [Mineur] centrage. 2. [Mineur] ancres. 3. [Important] aucun contrôle pour MOR-01. 4. [Mineur] nul."), true);
  assert.equal(needsChanges("VERDICT : APPROUVÉ\n1. Important : grille décalée"), true);
  assert.equal(needsChanges("VERDICT : APPROUVÉ\n- **Critique** la scène ne charge pas"), true);
  assert.equal(needsChanges("VERDICT : APPROUVÉ\n1. test_project.gd:157 - board[i] incorrect. Non critique : comportement réel correct."), false);
  assert.equal(needsChanges("VERDICT : APPROUVÉ\n1. Mineur : nom"), false);
  assert.equal(needsChanges("VERDICT : À CORRIGER\n1. Mineur : nom"), true);
});

test("story cycle: spec, waiting, plan, tasks, rounds, review, captures, merge", async () => {
  const root = spawnProject();
  assert.equal(nextAction(ctx(root)).step, "aucun fil");
  const wt = await createWorktree({ cwd: root, name: "saut" }, { engines: ENGINES, log: () => {} });
  assert.equal(nextAction(ctx(root)).step, "fils en cours");

  const step = () => nextAction(ctx(wt)).step;
  assert.equal(step(), "spec");
  assert.match(nextAction(ctx(wt)).instruction, /Projet de jeu fake 1.0 : tout se fait avec ce moteur/, "le cadre technique est rappelé");
  // Proposée puis rendue active sans validation (l'utilisateur a répondu autre chose) : la spec est à revoir.
  // Proposée, fil pas encore en attente : rien n'a été répondu, il reste à le mettre en attente (essai du 19/11).
  clock = Date.now();
  event(root, { type: "spec-proposed", path: "docs/specs/s.md" });
  const proposed = nextAction(ctx(wt));
  assert.equal(proposed.step, "spec proposée, fil à mettre en attente");
  assert.deepEqual(proposed.commands.map((c) => c.replace(/^node "[^"]+" /, "")), ['story update --status blocked:spec-approval --task "valider la spec"']);
  updateStory(root, "saut", { status: "blocked:decision", task: "validation de la spec" }, new Date((clock += 1000)));
  assert.equal(step(), "en attente de l'utilisateur");
  updateStory(root, "saut", { status: "active" }, new Date((clock += 1000)));
  assert.equal(step(), "spec à revoir", "remise active après la proposition : l'utilisateur a répondu sans valider");
  event(root, { type: "spec-approved", path: "docs/specs/s.md" });
  assert.equal(step(), "plan");

  mkdirSync(join(wt, "docs", "plans"), { recursive: true });
  writeFileSync(join(wt, "docs", "plans", "p.md"), "# Plan\nTâches : grille puis saut.\n");
  event(root, { type: "plan", path: "docs/plans/p.md" });
  assert.equal(step(), "plan illisible", "un plan sans titres de tâche est signalé, pas deviné");
  writeFileSync(join(wt, "docs", "plans", "p.md"), "## Tâche 1 : grille\n## Tâche 2 : saut\n");
  assert.equal(step(), "tâche 1/2 : grille, lancer");

  event(root, { type: "task-started", task: 1, base: "a".repeat(40) });
  assert.equal(step(), "tâche 1/2 : grille, implémenteur à lancer");
  assert.match(nextAction(ctx(wt)).instruction, /Le brief .*1-brief\.md n'existe pas : écris-le d'abord/, "noter « lancée » sans brief : le brief d'abord");
  mkdirSync(join(root, ".spawn", "tasks", "saut"), { recursive: true });
  writeFileSync(join(root, ".spawn", "tasks", "saut", "1-brief.md"), "brief");
  assert.match(nextAction(ctx(wt)).instruction, /N'attends pas : lance UN agent spawnstudio:implementer, modèle sonnet, par l'outil Agent[\s\S]*« Tâche 1 du fil saut. Le jeu est dans le dossier courant \(le worktree du fil\) : tous ses fichiers s'écrivent là[^»]*Lis d'abord \.\.[\\/]\.\.[\\/]\.\.[\\/]\.spawn[\\/]tasks[\\/]saut[\\/]1-brief\.md/);
  writeFileSync(join(root, ".spawn", "tasks", "saut", "1-report.md"), "DONE");
  assert.equal(step(), "tâche 1/2 : grille, relecture");
  assert.match(nextAction(ctx(wt)).instruction, /lance UN agent spawnstudio:task-reviewer[\s\S]*Écris ton verdict dans .*1-review\.md/);
  // L'outil lit le verdict et ne donne qu'une action : approuvé, terminer ; à corriger, noter le round puis corriger.
  writeFileSync(join(root, ".spawn", "tasks", "saut", "1-review.md"), "VERDICT : APPROUVÉ\n1. Mineur : nom");
  assert.equal(step(), "tâche 1/2 : grille, terminer");
  writeFileSync(join(root, ".spawn", "tasks", "saut", "1-review.md"), "VERDICT : À CORRIGER\n1. Important : grille décalée");
  assert.equal(step(), "tâche 1/2 : grille, round 1/5");
  assert.equal(nextAction(ctx(wt)).commands.length, 1, "une seule commande : noter le round");
  for (let r = 1; r <= 4; r++) event(root, { type: "round", task: 1, number: r, detail: "x" });
  const escalation = nextAction(ctx(wt));
  assert.equal(escalation.step, "tâche 1/2 : grille, correction du round 4");
  assert.match(escalation.instruction, /lance UN agent spawnstudio:implementer, modèle opus[\s\S]*« Round 4 de la tâche 1 du fil saut\. .*1-review\.md\. Corrige/);
  event(root, { type: "round", task: 1, number: 5, detail: "x" });
  assert.equal(step(), "tâche 1/2 : grille, plafond de rounds atteint");
  event(root, { type: "task-parked", task: 1, detail: "x", ruling: "y" });
  event(root, { type: "task-started", task: 2, base: "b".repeat(40) });
  writeFileSync(join(root, ".spawn", "tasks", "saut", "2-report.md"), "DONE");
  event(root, { type: "task-done", task: 2, commits: "b..c" });
  assert.equal(step(), "relecture finale");

  event(root, { type: "final-review", verdict: "clean" });
  assert.equal(step(), "preuve et captures");
  event(root, { type: "captures", paths: ["a.png"], verdict: "valid" });
  assert.equal(step(), "worktree à commiter", "rien ne se juge avec des fichiers non commités (le plan)");
  gitOk(wt, ["add", "-A"]);
  gitOk(wt, ["-c", "user.name=E", "-c", "user.email=e@x.invalid", "commit", "-q", "-m", "plan"]);
  assert.equal(step(), "compte rendu à juger", "jamais de fusion avant le jugement de l'utilisateur");
  event(root, { type: "acceptance-report", summary: "le héros saute", how_to_check: "appuyer sur espace" });
  assert.equal(step(), "à juger");
  updateStory(root, "saut", { status: "in-acceptance" });
  assert.equal(nextAction(ctx(wt)).commands.length, 0, "à juger : l'agent ne summary rien");

  // Redemander : le fil repart, une tâche de correction est ajoutée au plan, puis relecture, captures, nouveau jugement.
  updateStory(root, "saut", { status: "active" });
  event(root, { type: "changes-requested", message: "le saut est trop bas" });
  const correction = nextAction(ctx(wt));
  assert.equal(correction.step, "correction demandée");
  assert.match(correction.instruction, /« le saut est trop bas ».*## Tâche 3 :/);
  writeFileSync(join(wt, "docs", "plans", "p.md"), "## Tâche 1 : grille\n## Tâche 2 : saut\n## Tâche 3 : correction\n");
  assert.equal(step(), "tâche 3/3 : correction, lancer");
  event(root, { type: "task-started", task: 3, base: "c".repeat(40) });
  writeFileSync(join(root, ".spawn", "tasks", "saut", "3-report.md"), "DONE");
  event(root, { type: "task-done", task: 3, commits: "c..d" });
  assert.equal(step(), "relecture finale");
  event(root, { type: "final-review", verdict: "clean" });
  assert.equal(step(), "preuve et captures");
  // Preuve refusée par l'outil (noté par `ledger captures`) : la suite est une tâche de correction, pas les mêmes
  // captures (essai du 19/11 : une heure de captures refusées en boucle).
  event(root, { type: "captures", paths: ["a.png"], verdict: "invalid", detail: "smoke-test : la scène principale ne porte aucun script" });
  const refused = nextAction(ctx(wt));
  assert.equal(refused.step, "correction de la preuve");
  assert.match(refused.instruction, /aucun script.*## Tâche 4 : correction de la preuve/);
  writeFileSync(join(wt, "docs", "plans", "p.md"), "## Tâche 1 : grille\n## Tâche 2 : saut\n## Tâche 3 : correction\n## Tâche 4 : correction de la preuve\n");
  assert.equal(step(), "tâche 4/4 : correction de la preuve, lancer");
  event(root, { type: "task-started", task: 4, base: "d".repeat(40) });
  writeFileSync(join(root, ".spawn", "tasks", "saut", "4-report.md"), "DONE");
  event(root, { type: "task-done", task: 4, commits: "d..e" });
  assert.equal(step(), "relecture finale");
  event(root, { type: "final-review", verdict: "clean" });
  assert.equal(step(), "preuve et captures", "après la correction, la preuve se refait");
  event(root, { type: "captures", paths: ["a.png"], verdict: "valid" });
  gitOk(wt, ["add", "-A"]);
  gitOk(wt, ["-c", "user.name=E", "-c", "user.email=e@x.invalid", "commit", "-q", "-m", "correction"]);
  assert.equal(step(), "compte rendu à juger", "le jugement précédent ne vaut plus après une correction");
  event(root, { type: "acceptance-report", summary: "le héros saute plus haut", how_to_check: "appuyer sur espace" });
  event(root, { type: "accepted" });
  assert.equal(step(), "fusion");

  // Un refus de fusion plus récent que les captures prime.
  mkdirSync(join(root, ".git", "spawn", "merge"), { recursive: true });
  writeFileSync(
    join(root, ".git", "spawn", "merge", "log.jsonl"),
    JSON.stringify({ date: new Date(clock + 5000).toISOString(), story: "saut", branch: "feature/saut", head: "x", verdict: "refused", cause: "conflict", detail: "conflit avec develop sur jeu.fx" }) + "\n",
  );
  const refusal = nextAction(ctx(wt));
  assert.equal(refusal.step, "fusion refusée (conflict)");
  // Intégrer develop est une commande de l'orchestrateur, pas une tâche (essai du 18/11).
  const strip = (a: { commands: string[] }) => a.commands.map((c) => c.replace(/^node ".*?" /, ""));
  assert.deepEqual(strip(refusal).slice(0, 2), ["git merge develop", "engine test"]);
  assert.match(strip(refusal).at(-1) ?? "", /^merge --summary/);
  // Rouge une fois : intégrer develop, suite, réinscrire ; rouge deux fois : s'arrêter et le dire.
  const decision = (offset: number) =>
    JSON.stringify({ date: new Date(clock + offset).toISOString(), story: "saut", branch: "feature/saut", head: "x", verdict: "refused", cause: "failing", detail: "test rouge (journal : j.log)" }) + "\n";
  writeFileSync(join(root, ".git", "spawn", "merge", "log.jsonl"), decision(6000));
  assert.deepEqual(strip(nextAction(ctx(wt))).slice(0, 2), ["git merge develop", "engine test"]);
  assert.match(nextAction(ctx(wt)).instruction, /Verte : la cause est hors de la branche[^.]*, réinscris une fois/);
  writeFileSync(join(root, ".git", "spawn", "merge", "log.jsonl"), decision(6000) + decision(7000));
  const twice = nextAction(ctx(wt));
  assert.match(twice.instruction, /Deuxième refus rouge : ne réinscris plus/);
  assert.deepEqual(strip(twice), ['story update --status blocked:decision --task "fusion refusée deux fois"']);

  event(root, { type: "merged", commit: "f".repeat(40) });
  assert.equal(step(), "après fusion");
  updateStory(root, "saut", { status: "done" });
  updateStory(root, "saut", { status: "cleaned" });
  assert.equal(step(), "terminé");
});

test("rendered commands run as is: real tool path, no plugin variable", async () => {
  const root = spawnProject();
  const wt = await createWorktree({ cwd: root, name: "saut" }, { engines: ENGINES, log: () => {} });
  const a = nextAction(ctx(wt));
  assert.ok(a.commands.length > 0);
  for (const c of a.commands) assert.doesNotMatch(c, /CLAUDE_PLUGIN_ROOT/);
  assert.match(a.commands.join("\n"), /node ".*cli\.ts" ledger spec-proposed --path docs\/specs\/\d{4}-\d\d-\d\d-saut\.md/);
});

// Essai Spawn sur Spawn du 18/11 : une story d'une ligne a eu deux relectures, une preuve faite deux fois et une capture
// à deviner (« --scene <scène> » pour une app sans scènes).
test("single-task story: its approved review stands as the final review; captures: exact command, proof left to the tool", async () => {
  const root = spawnProject();
  const wt = await createWorktree({ cwd: root, name: "saut" }, { engines: ENGINES, log: () => {} });
  const step = () => nextAction(ctx(wt));
  event(root, { type: "spec-approved", path: "docs/specs/s.md" });
  mkdirSync(join(wt, "docs", "plans"), { recursive: true });
  writeFileSync(join(wt, "docs", "plans", "p.md"), "## Tâche 1 : renommer\n");
  event(root, { type: "plan", path: "docs/plans/p.md" });
  event(root, { type: "task-started", task: 1, base: "a".repeat(40) });
  const tasks = join(root, ".spawn", "tasks", "saut");
  mkdirSync(tasks, { recursive: true });
  writeFileSync(join(tasks, "1-report.md"), "DONE");
  writeFileSync(join(tasks, "1-review.md"), "VERDICT : APPROUVÉ");
  event(root, { type: "task-done", task: 1, commits: "a..b" });

  const final = step();
  assert.equal(final.step, "relecture finale");
  assert.doesNotMatch(final.instruction, /task-reviewer/, "pas de seconde relecture pour une seule tâche");
  assert.match(final.instruction, /1-review\.md\) : cette relecture tient lieu de relecture finale/);
  assert.deepEqual(final.commands.map((c) => c.replace(/^node ".*?" /, "")), ["ledger final-review --verdict clean"]);
  // Contrôle négatif : une relecture de tâche qui demande des corrections ne tient lieu de rien.
  writeFileSync(join(tasks, "1-review.md"), "VERDICT : À CORRIGER\n1. Important : x");
  assert.match(step().instruction, /Lance UN agent spawnstudio:task-reviewer/);
  writeFileSync(join(tasks, "1-review.md"), "VERDICT : APPROUVÉ");

  event(root, { type: "final-review", verdict: "clean" });
  const proof = step();
  assert.equal(proof.step, "preuve et captures");
  const commands = proof.commands.map((c) => c.replace(/^node ".*?" /, ""));
  assert.ok(!commands.some((c) => /^engine (compile|test|smoke-test)$/.test(c)), `preuve laissée à l'outil : ${commands.join(" | ")}`);
  assert.ok(!commands.some((c) => c.includes("prepare-worktree")), "la capture prépare le worktree elle-même");
  assert.match(proof.instruction, /Ne lance ni compilation, ni suite, ni smoke test/);
  assert.match(commands[0] ?? "", /^engine capture --scene <scène> --output ".*capture-1\.png"$/, "un moteur à scènes choisit sa scène");
  assert.match(commands[1] ?? "", /^ledger captures --paths ".*capture-1\.png" --verdict valid$/);

  // Exigences « Preuve : capture » : une capture par identifiant, toutes notées ensemble.
  mkdirSync(join(wt, "docs", "specs"), { recursive: true });
  writeFileSync(join(wt, "docs", "specs", "s.md"), ["- **SAU-01** Le héros saute. Preuve : test.", "- **SAU-02** Le titre dit Saut. Preuve : capture.", "- **SAU-03** Le fond est bleu. Preuve : capture.", ""].join("\n"));
  const named = step().commands.map((c) => c.replace(/^node ".*?" /, ""));
  assert.match(named[0] ?? "", /--output ".*SAU-02\.png"$/);
  assert.match(named[1] ?? "", /--output ".*SAU-03\.png"$/);
  assert.match(named[2] ?? "", /^ledger captures --paths ".*SAU-02\.png" ".*SAU-03\.png" --verdict valid$/);
  assert.match(step().instruction, /\(SAU-02, SAU-03\), nommée par son identifiant/);
  rmSync(join(wt, "docs", "specs"), { recursive: true });

  // Moteur sans scènes (Node) : la commande est complète, rien à deviner.
  const sceneless = mkdtempSync(join(tmpdir(), "spawn-engines-"));
  cpSync(join(ENGINES, "fake"), join(sceneless, "fake"), { recursive: true });
  const descriptor = join(sceneless, "fake", "adapter.json");
  writeFileSync(descriptor, JSON.stringify({ ...JSON.parse(readFileSync(descriptor, "utf8")), not_applicable: ["invalid-scene", "empty-main-scene"] }));
  process.env.SPAWN_ENGINES = sceneless;
  try {
    const capture = step().commands.map((c) => c.replace(/^node ".*?" /, ""))[0] ?? "";
    assert.match(capture, /^engine capture --output ".*capture-1\.png"$/);
  } finally {
    process.env.SPAWN_ENGINES = ENGINES;
    rmSync(sceneless, { recursive: true, force: true });
  }
});
