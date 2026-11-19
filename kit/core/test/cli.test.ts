// Outil `spawn`, compactage guidé, ménage et prérequis.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ledgerPath } from "../src/context.ts";
import { readStory, updateStory } from "../src/stories.ts";
import { gitOk } from "../src/git.ts";
import { compactionInstructions, resumeContext } from "../src/hooks/compaction.ts";
import { readLedger, write } from "../src/ledger.ts";
import { createWorktree } from "../src/hooks/worktree.ts";
import { applyCleanup, inventory } from "../src/cleanup.ts";
import { PLUGIN, installPlan, checkPrerequisites, type Runner } from "../src/prerequisites.ts";
import { commit, configure, cleanDirs, spawnProject } from "./git-helper.ts";

after(cleanDirs);
const ENGINES = fileURLToPath(new URL("./adapters/", import.meta.url));
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const silence = { engines: ENGINES, log: () => {} };

function spawnCli(cwd: string, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, SPAWN_ENGINES: ENGINES };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

async function projectWithStory(name = "pont") {
  const root = spawnProject();
  const worktree = await createWorktree({ cwd: root, name: name }, silence);
  return { root, worktree };
}

test("spawn story: state of the current worktree", async () => {
  const { root, worktree } = await projectWithStory();
  assert.equal(JSON.parse(spawnCli(worktree, "story").stdout).story, "pont");
  assert.equal(spawnCli(worktree, "story", "update", "--task", "Tâche 2", "--first-step", "dispatch implementer tâche 2").code, 0);
  assert.equal(readStory(root, "pont")?.first_step, "dispatch implementer tâche 2");
  assert.equal(spawnCli(worktree, "story", "update", "--status", "cleaned").code, 1, "transition interdite refusée");
  assert.equal(spawnCli(root, "story").code, 2, "hors worktree de fil : usage");
  assert.equal(spawnCli(root, "inconnue").code, 2);
});

test("spawn ledger: typed event written by the tool, plan checked, next = spawn next, guided refusals, readable output", async () => {
  const { root, worktree } = await projectWithStory();
  const planPath = join(worktree, "docs", "plans", "2026-11-17-pont.md");
  mkdirSync(join(worktree, "docs", "plans"), { recursive: true });
  assert.match(spawnCli(worktree, "ledger", "plan", "--path", "docs/plans/2026-11-17-pont.md").stderr, /introuvable/);
  writeFileSync(planPath, "### 1. Page\n`index.html`\n");
  const refused = spawnCli(worktree, "ledger", "plan", "--path", "docs/plans/2026-11-17-pont.md");
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /plan refusé[\s\S]*## Tâche N : <titre>[\s\S]*\.html/);
  writeFileSync(planPath, "## Tâche 1 : tablier\n## Tâche 2 : piles\n");
  // Un plan non commité n'est ni relu ni fusionné : refusé, fichier nommé (essai du 19/11).
  const uncommitted = spawnCli(worktree, "ledger", "plan", "--path", "docs/plans/2026-11-17-pont.md");
  assert.equal(uncommitted.code, 2);
  assert.match(uncommitted.stderr, /plan : fichiers non commités .*\(\?\? docs\/plans\/2026-11-17-pont\.md\)[\s\S]*git commit/);
  gitOk(worktree, ["add", "docs/plans"]);
  gitOk(worktree, ["-c", "user.name=E", "-c", "user.email=e@x.invalid", "commit", "-q", "-m", "plan"]);
  const plan = spawnCli(worktree, "ledger", "plan", "--path", "docs/plans/2026-11-17-pont.md");
  assert.equal(plan.code, 0, plan.stderr);
  // La base d'une tâche est la tête du worktree : une autre est refusée avec la bonne.
  const head = gitOk(worktree, ["rev-parse", "HEAD"]);
  const bad = spawnCli(worktree, "ledger", "task-started", "--task", "9", "--base", "0000000");
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, new RegExp(`n'est pas la tête du worktree[\\s\\S]*--base ${head}`));
  // Une tâche ne se ferme pas sans relecture plus récente que le rapport, ni en touchant la spec validée.
  const tasks = join(root, ".spawn", "tasks", "pont");
  mkdirSync(tasks, { recursive: true });
  writeFileSync(join(tasks, "1-report.md"), "DONE");
  assert.match(spawnCli(worktree, "ledger", "task-done", "--task", "1", "--commits", "a..b").stderr, /aucune relecture de la tâche 1[\s\S]*task-reviewer/);
  writeFileSync(join(tasks, "1-review.md"), "spec OK, Approved");
  const base = gitOk(worktree, ["rev-parse", "HEAD"]);
  write(ledgerPath(root, "pont"), { date: new Date().toISOString(), type: "spec-approved", path: "docs/specs/pont.md" });
  write(ledgerPath(root, "pont"), { date: new Date().toISOString(), type: "task-started", task: 1, base });
  mkdirSync(join(worktree, "docs", "specs"), { recursive: true });
  writeFileSync(join(worktree, "docs", "specs", "pont.md"), "spec retouchée");
  gitOk(worktree, ["add", "."]);
  gitOk(worktree, ["-c", "user.name=E", "-c", "user.email=e@x.invalid", "commit", "-q", "-m", "retouche"]);
  assert.match(spawnCli(worktree, "ledger", "task-done", "--task", "1", "--commits", "a..b").stderr, /modifie la spec validée docs\/specs\/pont\.md/);
  gitOk(worktree, ["rm", "-q", "docs/specs/pont.md"]);
  gitOk(worktree, ["-c", "user.name=E", "-c", "user.email=e@x.invalid", "commit", "-q", "-m", "retouche annulée"]);
  // Attribution IA dans un commit de la tâche : refusée, avec la commande exacte qui la retire (essai du 18/11).
  writeFileSync(join(worktree, "tablier.fx"), "tablier");
  gitOk(worktree, ["add", "."]);
  gitOk(worktree, ["-c", "user.name=E", "-c", "user.email=e@x.invalid", "commit", "-q", "-m", "tablier", "-m", "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"]);
  const tainted = spawnCli(worktree, "ledger", "task-done", "--task", "1");
  assert.equal(tainted.code, 2);
  assert.match(tainted.stderr, /attribution IA dans [0-9a-f]{10}/);
  const fix = /relance : (git .+)$/m.exec(tainted.stderr)?.[1] ?? "";
  const rewritten = spawnSync(fix, { cwd: worktree, shell: true, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "E", GIT_AUTHOR_EMAIL: "e@x.invalid", GIT_COMMITTER_NAME: "E", GIT_COMMITTER_EMAIL: "e@x.invalid" } });
  assert.equal(rewritten.status, 0, rewritten.stderr);
  assert.equal(gitOk(worktree, ["log", "-1", "--format=%B"]).trim(), "tablier", "le message garde tout sauf l'attribution");
  // Compilation rouge (lint compris) : la tâche ne se ferme pas, la suivante en hériterait (essai du 18/11).
  writeFileSync(join(worktree, "tablier.fx"), "tablier\nERROR\n");
  gitOk(worktree, ["-c", "user.name=E", "-c", "user.email=e@x.invalid", "commit", "-q", "-am", "tablier cassé"]);
  const red = spawnCli(worktree, "ledger", "task-done", "--task", "1");
  assert.equal(red.code, 2);
  assert.match(red.stderr, /task-done : la compilation est rouge \(tablier\.fx:2 instruction ERROR\)/);
  assert.match(red.stderr, /Ce n'est pas à toi de corriger : relance l'implémenteur de cette tâche/, "l'orchestrateur ne corrige pas lui-même (essai du 19/11)");
  writeFileSync(join(worktree, "tablier.fx"), "tablier");
  gitOk(worktree, ["-c", "user.name=E", "-c", "user.email=e@x.invalid", "commit", "-q", "-am", "tablier réparé"]);
  // Un fichier non commité : la tâche ne se ferme pas dessus, il ne serait ni relu ni fusionné (essai du 19/11).
  writeFileSync(join(worktree, "brouillon.fx"), "x");
  const dirty = spawnCli(worktree, "ledger", "task-done", "--task", "1");
  assert.equal(dirty.code, 2);
  assert.match(dirty.stderr, /task-done : fichiers non commités .*\(\?\? brouillon\.fx\)/);
  rmSync(join(worktree, "brouillon.fx"));
  // Les commits viennent toujours de git (base de la tâche..tête du worktree), même si une plage est recopiée.
  const finished = spawnCli(worktree, "ledger", "task-done", "--task", "1", "--commits", "a..b");
  assert.equal(finished.code, 0, finished.stderr);
  const final = gitOk(worktree, ["rev-parse", "HEAD"]).slice(0, 10);
  // L'action suivante est affichée tout de suite : pas de `spawn next` à relancer.
  assert.match(finished.stdout, new RegExp(`tâche 1 terminée \\(commits ${base.slice(0, 10)}\\.\\.${final}\\)\\n\\naction suivante, à faire sans relancer next :\\nétape : `));
  // Une seule tâche, approuvée : sa relecture tient lieu de relecture finale, sans fichier final-review.md.
  const finalClean = spawnCli(worktree, "ledger", "final-review", "--verdict", "clean");
  assert.equal(finalClean.code, 0, finalClean.stderr);
  // Déjà notée propre, rien de neuf depuis : refusée (essai du 19/11 : deux « clean » d'affilée).
  const twice = spawnCli(worktree, "ledger", "final-review", "--verdict", "clean");
  assert.equal(twice.code, 2);
  assert.match(twice.stderr, /final-review : la relecture finale est déjà notée propre/);
  const noBase = spawnCli(worktree, "ledger", "task-started", "--task", "2");
  assert.equal(noBase.code, 0, noBase.stderr);
  assert.match(noBase.stdout, new RegExp(`tâche 2 lancée \\(base ${final}`), "sans --base, l'outil note la tête du worktree");
  // Une tâche ouverte ne se relance pas : sa base bougerait (essai du 19/11 : tâche 2 relancée après le round 1).
  const again = spawnCli(worktree, "ledger", "task-started", "--task", "2");
  assert.equal(again.code, 2);
  assert.match(again.stderr, new RegExp(`task-started : la tâche 2 est déjà lancée \\(base ${final}[\\s\\S]*c'est un round`));
  // Le brief est écrit par l'outil : la section de la tâche dans le plan, et les tâches closes.
  const brief = join(root, ".spawn", "tasks", "pont", "2-brief.md");
  assert.match(noBase.stdout, /brief écrit : .*2-brief\.md/);
  assert.match(readFileSync(brief, "utf8"), /# Brief de la tâche 2[\s\S]*## Tâche 2 : piles[\s\S]*- tâche 1 : commits /);
  assert.doesNotMatch(readFileSync(brief, "utf8"), /Tâche 1 : tablier/, "seule la section de la tâche");
  const last = spawnCli(worktree, "ledger", "round", "--task", "2", "--number", "5", "--detail", "findings 1-2 ; commits c..d");
  assert.equal(last.code, 0, last.stderr);
  const validate = spawnCli(worktree, "ledger", "spec-approved", "--path", "docs/specs/s.md");
  assert.equal(validate.code, 2, "la validation de la spec n'est pas à l'agent");
  assert.match(validate.stderr, /spec-proposed[\s\S]*blocked:spec-approval/);
  const invented = spawnCli(worktree, "leader", "task");
  assert.equal(invented.code, 2);
  assert.match(invented.stderr, /commande inconnue : leader\. N'invente pas de commande : lance .* next/);

  const outOfBounds = spawnCli(worktree, "ledger", "round", "--task", "2", "--number", "6", "--detail", "x");
  assert.equal(outOfBounds.code, 2);
  assert.match(outOfBounds.stderr, /--number : entier attendu de 1 à 5.*forme attendue : spawn ledger round --task <n> --number <1\.\.5> --detail/);
  const legacy = spawnCli(worktree, "ledger", "ajouter", "Tâche 1 : terminée");
  assert.equal(legacy.code, 2);
  assert.match(legacy.stderr, /type d'événement inconnu : « ajouter »/);
  assert.match(spawnCli(worktree, "ledger", "note", "--text", "deux", "mots").stderr, /texte hors option : « mots »/);

  const path = ledgerPath(root, "pont");
  assert.equal(readFileSync(path, "utf8").trim().split("\n").length, 7, "plan, spec, lancée, terminée, relecture finale, lancée, round : les refus n'écrivent rien");
  const reading = spawnCli(worktree, "ledger");
  assert.equal(reading.code, 0);
  const lines = reading.stdout.trim().split(/\r?\n/);
  assert.match(lines[0] ?? "", /^\d{4}-\d\d-\d\d \d\d:\d\d plan : docs\/plans\/2026-11-17-pont\.md$/);
  assert.match(lines[6] ?? "", /tâche 2 round 5 : findings 1-2 ; commits c\.\.d$/);
  assert.equal(lines[7], path);
});

test("spawn engine: project adapter on the current worktree, verdict as exit code", async () => {
  const { worktree } = await projectWithStory();
  const healthy = spawnCli(worktree, "engine", "compile");
  assert.equal(healthy.code, 0, healthy.stderr);
  assert.equal(JSON.parse(healthy.stdout).ok, true);
  configure(worktree);
  commit(worktree, "casse.fx", "ERROR\n");
  const broken = spawnCli(worktree, "engine", "compile");
  assert.equal(broken.code, 1);
  assert.equal(JSON.parse(broken.stdout).errors[0].file, "casse.fx");
  assert.match(JSON.parse(broken.stdout).next, /^corriger casse\.fx:1 \(code-error : .*\) ; puis node ".*cli\.ts" engine compile/);
  assert.equal(JSON.parse(healthy.stdout).next, undefined, "rien à faire quand tout est vert");
});

test("compaction: handoff-format instructions, status active → compacting → active, state reinjected", async () => {
  const { root, worktree } = await projectWithStory();
  updateStory(root, "pont", { first_step: "relancer la tâche 3" });
  for (let n = 1; n <= 16; n++) write(ledgerPath(root, "pont"), { date: "2026-11-17T16:00:00.000Z", type: "note", text: `note ${n}` });
  const instructions = compactionInstructions(worktree) ?? "";
  for (const section of ["## Fil", "## État", "## Décisions", "## Rouges et doutes", "## Premier geste"]) assert.ok(instructions.includes(section), section);
  assert.equal(readStory(root, "pont")?.status, "compacting");
  const resumed = resumeContext(worktree, "compact") ?? "";
  assert.match(resumed, /Reprise après compactage/);
  assert.match(resumed, /relancer la tâche 3/);
  assert.match(resumed, /15 derniers événements :\n2026-11-17 16:00 note : note 2\n[^]*note : note 16$/, "rendu lisible des 15 derniers");
  assert.equal(readStory(root, "pont")?.status, "active");
  assert.equal(compactionInstructions(join(root, "..")), null, "hors projet : rien");
});

test("cleanup: removes worktrees without work, keeps work and the current session", async () => {
  const root = spawnProject();
  const empty = await createWorktree({ cwd: root, name: "vide" }, silence);
  const work = await createWorktree({ cwd: root, name: "travail" }, silence);
  const dirty = await createWorktree({ cwd: root, name: "sale" }, silence);
  const current = await createWorktree({ cwd: root, name: "courant" }, silence);
  configure(work);
  commit(work, "t.fx", "T\n");
  writeFileSync(join(dirty, "brouillon.fx"), "B\n");

  const { candidates, kept } = inventory(root, current);
  assert.deepEqual(candidates.map((c) => c.name), ["vide"]);
  assert.deepEqual(kept.map((g) => g.name).sort(), ["courant", "sale", "travail"]);
  applyCleanup(root, candidates);
  assert.ok(!existsSync(empty));
  assert.equal(readStory(root, "vide")?.status, "cleaned");
  assert.ok(!gitOk(root, ["branch", "--list", "feature/vide"]));
  assert.ok(existsSync(work) && existsSync(dirty) && existsSync(current));
});

test("prerequisites: unversioned settings reported, then recognized once committed (real git)", async () => {
  const root = spawnProject();
  const realGitFakeClaude: Runner = (program, args, cwd) =>
    program === "git" ? { code: spawnSync("git", args, { cwd }).status ?? -1, stdout: "", stderr: "" } : { code: 1, stdout: "", stderr: "absent" };
  process.env.SPAWN_ENGINES = ENGINES;
  mkdirSync(join(root, ".claude"));
  writeFileSync(join(root, ".claude", "settings.json"), "{}\n");
  const before = await checkPrerequisites(root, realGitFakeClaude);
  assert.equal(before.find((c) => c.name === "réglages versionnés")?.ok, false);
  gitOk(root, ["add", ".claude/settings.json"]);
  gitOk(root, ["commit", "--quiet", "-m", "reglages"]);
  const afterRun = await checkPrerequisites(root, realGitFakeClaude);
  assert.equal(afterRun.find((c) => c.name === "réglages versionnés")?.ok, true);
});

test("prerequisites: plugin inactive in the project reported; per-project install, never global", async () => {
  const root = spawnProject();
  const commands: string[] = [];
  const fake: Runner = (program, args) => {
    commands.push(`${program} ${args.join(" ")}`);
    if (args[0] === "plugin" && args[1] === "list") return { code: 0, stdout: JSON.stringify([{ id: PLUGIN, enabled: false }]), stderr: "" };
    if (args[0] === "plugin" && args[1] === "marketplace") return { code: 0, stdout: "[]", stderr: "" };
    return { code: 0, stdout: "x 1.0\n", stderr: "" };
  };
  process.env.SPAWN_ENGINES = ENGINES;
  const checks = await checkPrerequisites(root, fake);
  const plugin = checks.find((c) => c.name === "plugin");
  assert.equal(plugin?.ok, false);
  assert.match(plugin?.detail ?? "", /inactif dans ce projet/);
  assert.equal(checks.find((c) => c.name === "compacting")?.ok, false);
  assert.equal(checks.find((c) => c.name === "réglages versionnés")?.ok, true, "le faux exécuteur répond 0 à git ls-files");

  const actions = installPlan(root, fake);
  const startedTasks = actions.flatMap((a) => (a.command ? [a.command.args.join(" ")] : []));
  assert.ok(startedTasks.some((c) => c.startsWith("plugin marketplace add")));
  assert.ok(!startedTasks.includes(`plugin install ${PLUGIN} --scope project`), "déjà installé : pas de réinstallation");
  assert.ok(startedTasks.includes(`plugin enable ${PLUGIN} --scope project`), "installé ne veut pas dire actif (defaultEnabled: false)");
  const absent: Runner = (program, args, cwd) => (args[0] === "plugin" && args[1] === "list" ? { code: 0, stdout: "[]", stderr: "" } : fake(program, args, cwd));
  const fresh = installPlan(root, absent).flatMap((a) => (a.command ? [a.command.args.join(" ")] : []));
  assert.ok(fresh.includes(`plugin install ${PLUGIN} --scope project`) && fresh.includes(`plugin enable ${PLUGIN} --scope project`));
  assert.ok(!startedTasks.some((c) => c.includes("--scope user")), "jamais d'activation globale");
  assert.match(actions.find((a) => a.file)?.file?.after ?? "", /"CLAUDE_CODE_AUTO_COMPACT_WINDOW": "260000"/);
  assert.ok(!existsSync(join(root, ".claude", "settings.json")), "le plan n'écrit rien");
});

test("spawn ledger: the spec fixes each requirement's proof, the plan writes no test the approved spec does not plan", async () => {
  const { root, worktree } = await projectWithStory("menu");
  mkdirSync(join(worktree, "docs", "specs"), { recursive: true });
  mkdirSync(join(worktree, "docs", "plans"), { recursive: true });
  const spec = join(worktree, "docs", "specs", "menu.md");
  writeFileSync(spec, "- **PNT-01** Le menu s'intitule « Projet ». Contrôle négatif : le test échoue sur l'ancien titre.\n");
  const refused = spawnCli(worktree, "ledger", "spec-proposed", "--path", "docs/specs/menu.md");
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /spec refusée[\s\S]*PNT-01 : preuve absente/);
  writeFileSync(spec, "- **PNT-01** Le menu s'intitule « Projet ». Preuve : capture.\n");
  const proposed = spawnCli(worktree, "ledger", "spec-proposed", "--path", "docs/specs/menu.md");
  assert.equal(proposed.code, 0, proposed.stderr);
  // La validation est le geste de l'utilisateur (l'app) : écrite ici directement.
  write(ledgerPath(root, "menu"), { date: new Date().toISOString(), type: "spec-approved", path: "docs/specs/menu.md" });
  const plan = join(worktree, "docs", "plans", "menu.md");
  writeFileSync(plan, "## Tâche 1 : pilote\n- Fichiers : `test/app-driver.test.fx`.\n- Exigences : PNT-01.\n");
  const testRefused = spawnCli(worktree, "ledger", "plan", "--path", "docs/plans/menu.md");
  assert.equal(testRefused.code, 2);
  assert.match(testRefused.stderr, /plan refusé[\s\S]*tâche 1 : elle écrit un test[\s\S]*PNT-01 \(preuve : capture\)/);
  writeFileSync(plan, "## Tâche 1 : renommer\n- Fichiers : `src/menus.fx`.\n- Exigences : PNT-01.\n");
  gitOk(worktree, ["add", "-A"]);
  gitOk(worktree, ["-c", "user.name=E", "-c", "user.email=e@x.invalid", "commit", "-q", "-m", "spec et plan"]);
  const accepted = spawnCli(worktree, "ledger", "plan", "--path", "docs/plans/menu.md");
  assert.equal(accepted.code, 0, accepted.stderr);
  // Captures : une par exigence « Preuve : capture », nommée par son identifiant (essai du 18/11, SGS-32).
  const shots = join(root, ".spawn", "captures", "menu");
  mkdirSync(shots, { recursive: true });
  writeFileSync(join(shots, "capture-1.png"), "png");
  const unnamed = spawnCli(worktree, "ledger", "captures", "--paths", join(shots, "capture-1.png"), "--verdict", "valid");
  assert.equal(unnamed.code, 2);
  assert.match(unnamed.stderr, /aucune capture pour PNT-01 \(preuve « capture »/);
  writeFileSync(join(shots, "PNT-01.png"), "png");
  // Chemin relatif au worktree, comme les consignes le donnent : le ledger le garde absolu (lu depuis l'app).
  const named = spawnCli(worktree, "ledger", "captures", "--paths", relative(worktree, join(shots, "PNT-01.png")), "--verdict", "valid");
  assert.doesNotMatch(named.stderr, /aucune capture pour/, "la capture nommée suffit à ce contrôle");
  // Preuve refusée (ici : aucun test) : le refus est noté au ledger, d'où `next` tire la tâche de correction (essai du
  // 19/11 : sans trace, une heure de captures refusées en boucle).
  assert.equal(named.code, 2);
  assert.match(named.stderr, /la preuve n.est pas faite \(test : aucun test lancé\)\. Refus noté au ledger/);
  const noted = readLedger(ledgerPath(root, "menu")).at(-1);
  assert.ok(noted?.type === "captures" && noted.verdict === "invalid" && noted.detail?.includes("aucun test lancé"), JSON.stringify(noted));
  assert.deepEqual(noted.paths, [join(shots, "PNT-01.png")]);
});
