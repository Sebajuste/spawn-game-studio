// File de fusion v1 : fusion, refus (rouge, conflit, branche cassée par une fusion intermédiaire),
// deux traiteurs en même temps, traiteur tué en pleine fusion, branche déjà fusionnée.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readStory, updateStory } from "../src/stories.ts";
import { mergeStory, enqueue, readDecisions, readQueue, processQueue } from "../src/merge.ts";
import { git, gitOk } from "../src/git.ts";
import { createWorktree } from "../src/hooks/worktree.ts";
import { findProject, type Project } from "../src/project.ts";
import { commit, configure, tempDir, cleanDirs, spawnProject } from "./git-helper.ts";

after(cleanDirs);
const ENGINES = fileURLToPath(new URL("./adapters/", import.meta.url));
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const options = { engines: ENGINES, log: () => {} };

async function projectWithRemote(): Promise<{ project: Project; remote: string }> {
  const root = spawnProject();
  writeFileSync(join(root, ".gitignore"), ".spawn/\n.claude/worktrees/\n.fake-cache/\n");
  gitOk(root, ["checkout", "--quiet", "develop"]);
  gitOk(root, ["add", ".gitignore"]);
  gitOk(root, ["commit", "--quiet", "-m", "ignore le cache factice"]);
  // Comme un projet créé par nouveau-jeu : un premier test vert sur develop.
  commit(root, "test/test_projet.fx", "PASS\n", "premier test");
  gitOk(root, ["checkout", "--quiet", "main"]);
  const remote = tempDir("remote");
  gitOk(remote, ["init", "--quiet", "--bare"]);
  gitOk(root, ["remote", "add", "origin", remote]);
  gitOk(root, ["push", "--quiet", "origin", "main", "develop"]);
  const project = findProject(root);
  assert.ok(project);
  return { project, remote };
}

async function story(project: Project, name: string, files: Record<string, string>): Promise<string> {
  const wt = await createWorktree({ cwd: project.root, name: name }, options);
  configure(wt);
  for (const [f, content] of Object.entries(files)) commit(wt, f, content, `${name} : ${f}`);
  return wt;
}

const develop = (project: Project) => gitOk(project.root, ["rev-parse", "develop"]);

test("merge: squash onto develop with Story-Head, pushed to origin, integration worktree cleaned", async () => {
  const { project, remote } = await projectWithRemote();
  const before = develop(project);
  const wt = await story(project, "grille", { "grille.fx": "GRILLE\n", "test/test_grille.fx": "PASS\n" });
  const head = gitOk(wt, ["rev-parse", "HEAD"]);

  const d = await mergeStory(project, "grille", wt, "grille de jeu", options);
  assert.equal(d.verdict, "merged", JSON.stringify(d));
  assert.equal(develop(project), d.commit);
  assert.equal(gitOk(project.root, ["rev-parse", "develop~1"]), before, "un seul commit de squash");
  const message = gitOk(project.root, ["log", "-1", "--format=%B", "develop"]);
  assert.match(message, /^grille : grille de jeu/);
  assert.match(message, new RegExp(`Story-Head: ${head}`));
  assert.equal(gitOk(remote, ["rev-parse", "develop"]), d.commit, "origin/develop à jour");
  assert.equal(readQueue(project.root).length, 0);
  assert.ok(!existsSync(join(project.root, ".spawn", "merge", "integration")));
  assert.equal(gitOk(project.root, ["worktree", "list"]).split(/\r?\n/).length, 2, "racine + worktree du fil");
  assert.equal(readStory(project.root, "grille")?.status, "done");
});

test("failing refusal: develop intact, story made active with the cause and the first step", async () => {
  const { project, remote } = await projectWithRemote();
  const before = develop(project);
  const wt = await story(project, "tour", { "test/test_tour.fx": "PASS\nFAIL\n" });
  const d = await mergeStory(project, "tour", wt, "", options);
  assert.equal(d.verdict, "refused");
  assert.equal(d.cause, "failing");
  assert.equal(develop(project), before);
  assert.equal(gitOk(remote, ["rev-parse", "develop"]), before);
  const state = readStory(project.root, "tour");
  assert.equal(state?.status, "active");
  assert.match(state?.first_step ?? "", /corriger : .*test_tour\.fx.*puis spawn merge/);
  // Le journal cité survit à l'effacement du dossier d'intégration, et son chemin n'est pas tronqué.
  const journal = /\(journal : ([^)]+)\) ; puis spawn merge$/.exec(state?.first_step ?? "")?.[1] ?? "";
  assert.ok(!existsSync(join(project.root, ".spawn", "merge", "integration")));
  assert.ok(journal.startsWith(join(project.root, ".spawn", "merge", "logs")), journal);
  assert.match(readFileSync(journal, "utf8"), /test_tour\.fx/);
  assert.ok(d.detail?.includes(journal), "le verdict cite le journal gardé");
});

test("intermediate merge breaking a branch proven green alone: refused, not admitted", async () => {
  const { project } = await projectWithRemote();
  const a = await story(project, "ajout", { "a.fx": "A\n" });
  const b = await story(project, "garde", { "test/test_garde.fx": "ABSENT a.fx\n" });
  assert.equal((await mergeStory(project, "ajout", a, "", options)).verdict, "merged");
  const before = develop(project);
  const d = await mergeStory(project, "garde", b, "", options);
  assert.equal(d.verdict, "refused");
  assert.equal(d.cause, "failing");
  assert.match(d.detail ?? "", /a\.fx existe/);
  assert.equal(develop(project), before);
});

test("conflict refusal and head moved after enqueueing", async () => {
  const { project } = await projectWithRemote();
  const a = await story(project, "un", { "jeu.fx": "BONJOUR\nUN\n" });
  const b = await story(project, "deux", { "jeu.fx": "BONJOUR\nDEUX\n" });
  assert.equal((await mergeStory(project, "un", a, "", options)).verdict, "merged");
  const conflict = await mergeStory(project, "deux", b, "", options);
  assert.equal(conflict.cause, "conflict");
  assert.match(conflict.detail ?? "", /jeu\.fx/);

  const c = await story(project, "trois", { "trois.fx": "T\n" });
  enqueue(project, "trois", c, "");
  commit(c, "trois.fx", "T2\n");
  await processQueue(project, options);
  assert.equal(readDecisions(project.root).pop()?.cause, "head-changed");
});

function runMergeWorker(root: string, env: Record<string, string> = {}): Promise<number | null> {
  return new Promise((settle) => {
    const e: NodeJS.ProcessEnv = { ...process.env, SPAWN_ENGINES: ENGINES, ...env };
    delete e.NODE_TEST_CONTEXT;
    spawn(process.execPath, [CLI, "merge", "process"], { cwd: root, env: e, stdio: "ignore" }).on("close", settle);
  });
}

test("two merge workers started at once: each branch merged once, queue empty, lock released", async () => {
  const { project } = await projectWithRemote();
  const before = develop(project);
  const a = await story(project, "alpha", { "alpha.fx": "A\n" });
  const b = await story(project, "beta", { "beta.fx": "B\n" });
  enqueue(project, "alpha", a, "");
  enqueue(project, "beta", b, "");
  await Promise.all([runMergeWorker(project.root), runMergeWorker(project.root)]);
  const merges = readDecisions(project.root).filter((d) => d.verdict === "merged");
  assert.deepEqual(merges.map((d) => d.story).sort(), ["alpha", "beta"]);
  assert.equal(gitOk(project.root, ["rev-list", "--count", `${before}..develop`]), "2");
  assert.equal(readQueue(project.root).length, 0);
  assert.ok(!existsSync(join(project.root, ".git", "spawn", "merge", "lock.json")));
});

test("merge worker killed mid-merge: develop intact, the next one takes the lock over and merges", async () => {
  const { project, remote } = await projectWithRemote();
  const before = develop(project);
  const wt = await story(project, "panne", { "panne.fx": "P\n" });
  enqueue(project, "panne", wt, "");
  assert.equal(await runMergeWorker(project.root, { SPAWN_MERGE_FAULT: "before-develop" }), 9);
  assert.equal(develop(project), before, "develop local intact");
  assert.equal(gitOk(remote, ["rev-parse", "develop"]), before, "origin/develop intact");
  assert.ok(existsSync(join(project.root, ".git", "spawn", "merge", "lock.json")), "verrou abandonné");

  assert.equal(await processQueue(project, options), "processed");
  assert.equal(readDecisions(project.root).pop()?.verdict, "merged");
  assert.equal(gitOk(project.root, ["rev-list", "--count", `${before}..develop`]), "1");
});

test("branch already in develop (squash with Story-Head): merged without a new commit", async () => {
  const { project } = await projectWithRemote();
  const wt = await story(project, "deja", { "deja.fx": "D\n" });
  const head = gitOk(wt, ["rev-parse", "HEAD"]);
  gitOk(project.root, ["checkout", "--quiet", "develop"]);
  gitOk(project.root, ["merge", "--quiet", "--squash", "feature/deja"]);
  gitOk(project.root, ["commit", "--quiet", "-m", `deja\n\nStory-Head: ${head}`]);
  gitOk(project.root, ["push", "--quiet", "origin", "develop"]);
  const before = develop(project);
  updateStory(project.root, "deja", { status: "done" });
  const d = await mergeStory(project, "deja", wt, "", options);
  assert.equal(d.verdict, "merged");
  assert.equal(develop(project), before);
  assert.equal(git(project.root, ["status", "--porcelain"]).stdout, "", "checkout principal propre");
  assert.ok(readFileSync(join(project.root, "deja.fx"), "utf8").startsWith("D"));
});
