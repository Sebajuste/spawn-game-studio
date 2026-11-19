// Jugement par l'utilisateur : accepter (fusion puis ménage), redemander (fil relancé), abandonner (branche jetée,
// trace gardée) ; rien n'est accepté hors de l'état « à juger ».
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ledgerPath } from "../src/context.ts";
import { readStory, updateStory } from "../src/stories.ts";
import { git, gitOk } from "../src/git.ts";
import { createWorktree } from "../src/hooks/worktree.ts";
import { abandon, accept, acceptanceReport, AcceptanceError, requestChanges, proposedSpec, approveSpec } from "../src/acceptance.ts";
import { write, readLedger } from "../src/ledger.ts";
import { findProject, type Project } from "../src/project.ts";
import { commit, configure, cleanDirs, spawnProject } from "./git-helper.ts";

after(cleanDirs);
const options = { engines: fileURLToPath(new URL("./adapters/", import.meta.url)), log: () => {} };

function project(): Project {
  const root = spawnProject();
  writeFileSync(join(root, ".gitignore"), ".spawn/\n.claude/worktrees/\n.fake-cache/\n");
  gitOk(root, ["checkout", "--quiet", "develop"]);
  gitOk(root, ["add", ".gitignore"]);
  gitOk(root, ["commit", "--quiet", "-m", "ignore"]);
  commit(root, "test/test_projet.fx", "PASS\n", "premier test");
  gitOk(root, ["checkout", "--quiet", "main"]);
  const p = findProject(root);
  assert.ok(p);
  return p;
}

async function storyInAcceptance(p: Project, name: string): Promise<string> {
  const wt = await createWorktree({ cwd: p.root, name: name }, options);
  configure(wt);
  commit(wt, `${name}.fx`, "CODE\n", `${name} : code`);
  write(ledgerPath(p.root, name), { date: new Date().toISOString(), type: "acceptance-report", summary: "un score par joueur", how_to_check: "gagner deux parties" });
  updateStory(p.root, name, { status: "in-acceptance" });
  return wt;
}

test("accept: merged into develop, worktree and branch removed, story cleaned, readable acceptance report", async () => {
  const p = project();
  const wt = await storyInAcceptance(p, "score");
  assert.deepEqual(
    (({ summary, how_to_check }) => ({ summary, how_to_check }))(acceptanceReport(p.root, "score") ?? { summary: "", how_to_check: "" }),
    { summary: "un score par joueur", how_to_check: "gagner deux parties" },
  );
  const r = await accept(p, "score", "Score des joueurs", options);
  assert.equal(r.decision.verdict, "merged", JSON.stringify(r.decision));
  assert.ok(r.cleaned);
  assert.match(gitOk(p.root, ["log", "-1", "--format=%s", "develop"]), /^score : Score des joueurs/);
  assert.ok(!existsSync(wt));
  assert.notEqual(git(p.root, ["rev-parse", "--verify", "--quiet", "feature/score"]).code, 0, "branche supprimée");
  assert.equal(readStory(p.root, "score")?.status, "cleaned");
  assert.deepEqual(readLedger(ledgerPath(p.root, "score")).map((e) => e.type), ["acceptance-report", "accepted", "merged"]);
});

test("request changes: story active with the message; abandon: branch dropped, trace kept; refused outside in-acceptance", async () => {
  const p = project();
  const wt = await storyInAcceptance(p, "son");
  assert.throws(() => requestChanges(p.root, "son", "  "), AcceptanceError);
  const restart = requestChanges(p.root, "son", "trop fort\nbaisser le volume");
  assert.equal(restart.status, "active");
  assert.deepEqual(readLedger(ledgerPath(p.root, "son")).at(-1), { date: readLedger(ledgerPath(p.root, "son")).at(-1)?.date, type: "changes-requested", message: "trop fort baisser le volume" });
  await assert.rejects(accept(p, "son", "Son", options), /n'est pas à juger/);
  assert.throws(() => requestChanges(p.root, "son", "encore"), /n'est pas à juger/);

  const before = gitOk(p.root, ["rev-parse", "develop"]);
  writeFileSync(join(wt, "brouillon.fx"), "non commité");
  const closed = abandon(p.root, "son", "plus utile");
  assert.equal(closed.status, "cleaned");
  assert.equal(closed.worktree, null);
  assert.ok(!existsSync(wt));
  assert.notEqual(git(p.root, ["rev-parse", "--verify", "--quiet", "feature/son"]).code, 0);
  assert.equal(gitOk(p.root, ["rev-parse", "develop"]), before, "develop intact");
  assert.deepEqual(readLedger(ledgerPath(p.root, "son")).at(-1)?.type, "abandoned");
  assert.throws(() => abandon(p.root, "son"), /déjà fermé/);
});

test("spec: proposed by the agent, approved only while waiting; approval makes the story active", async () => {
  const p = project();
  await createWorktree({ cwd: p.root, name: "son" }, options);
  assert.throws(() => approveSpec(p.root, "son"), /aucune spec à valider/);
  write(ledgerPath(p.root, "son"), { date: new Date().toISOString(), type: "spec-proposed", path: "docs/specs/son.md" });
  assert.equal(proposedSpec(p.root, "son"), null, "proposée mais le fil n'attend pas : rien à valider");
  updateStory(p.root, "son", { status: "blocked:spec-approval", task: "valider la spec" });
  assert.equal(proposedSpec(p.root, "son"), "docs/specs/son.md");
  assert.equal(approveSpec(p.root, "son").status, "active");
  assert.deepEqual(readLedger(ledgerPath(p.root, "son")).at(-1)?.type, "spec-approved");
});
