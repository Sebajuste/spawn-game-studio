import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { encode, measure } from "../src/metrics.ts";
import { tempDir, cleanDirs, spawnProject } from "./git-helper.ts";

after(cleanDirs);

const usage = (output: number) => ({ input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: output });
const line = (o: object) => JSON.stringify(o);

test("metrics: human interventions only, tokens deduplicated per message, subagents and worktrees included", () => {
  const root = spawnProject();
  const config = tempDir("config-claude");
  const projects = join(config, "projects");
  const main = join(projects, encode(root));
  const worktree = join(projects, `${encode(root)}--claude-worktrees-morpion`);
  const neighbor = join(projects, `${encode(root)}-2`);
  mkdirSync(join(worktree, "s2", "subagents"), { recursive: true });
  mkdirSync(main, { recursive: true });
  mkdirSync(neighbor, { recursive: true });

  writeFileSync(
    join(main, "s1.jsonl"),
    [
      line({ type: "user", sessionId: "s1", timestamp: "2026-11-18T10:00:00Z", message: { content: "Fais un morpion à deux joueurs." } }),
      line({ type: "assistant", sessionId: "s1", timestamp: "2026-11-18T10:00:01Z", message: { id: "m1", model: "claude-sonnet", usage: usage(50) } }),
      // Même message écrit sur deux lignes : compté une fois.
      line({ type: "assistant", sessionId: "s1", timestamp: "2026-11-18T10:00:01Z", message: { id: "m1", model: "claude-sonnet", usage: usage(50) } }),
      line({ type: "user", sessionId: "s1", timestamp: "2026-11-18T10:00:02Z", message: { content: [{ type: "tool_result", content: "ok" }] } }),
      line({ type: "user", sessionId: "s1", timestamp: "2026-11-18T10:00:03Z", isCompactSummary: true, message: { content: "This session is being continued" } }),
      line({ type: "user", sessionId: "s1", timestamp: "2026-11-18T10:00:04Z", isMeta: true, message: { content: "<local-command-caveat>" } }),
      line({ type: "user", sessionId: "s1", timestamp: "2026-11-18T10:00:05Z", message: { content: "<command-name>/compact</command-name>" } }),
      "pas du json",
    ].join("\n"),
  );
  writeFileSync(
    join(worktree, "s2.jsonl"),
    [
      line({ type: "user", sessionId: "s2", timestamp: "2026-11-18T11:00:00Z", message: { content: [{ type: "text", text: "Spec validée, vas-y." }] } }),
      line({ type: "assistant", sessionId: "s2", timestamp: "2026-11-18T11:00:01Z", message: { id: "m2", model: "claude-opus", usage: usage(30) } }),
    ].join("\n"),
  );
  writeFileSync(
    join(worktree, "s2", "subagents", "agent-a.jsonl"),
    [
      line({ type: "user", isSidechain: true, sessionId: "s2", timestamp: "2026-11-18T11:00:02Z", message: { content: "brief de la tâche 1" } }),
      line({ type: "assistant", isSidechain: true, sessionId: "s2", timestamp: "2026-11-18T11:00:03Z", message: { id: "m3", model: "claude-sonnet", usage: usage(20) } }),
    ].join("\n"),
  );
  // Un autre projet dont le nom commence pareil : exclu.
  writeFileSync(join(neighbor, "s9.jsonl"), line({ type: "user", sessionId: "s9", timestamp: "2026-11-18T12:00:00Z", message: { content: "autre projet" } }));

  mkdirSync(join(root, ".spawn", "ledgers"), { recursive: true });
  const date = "2026-11-18T11:00:00.000Z";
  writeFileSync(
    join(root, ".spawn", "ledgers", "morpion.jsonl"),
    [
      { date, type: "round", task: 2, number: 1, detail: "a" },
      { date, type: "round", task: 2, number: 2, detail: "b" },
      { date, type: "task-parked", task: 4, detail: "y", ruling: "z" },
      // L'écart de l'essai du morpion (constat 4) : la correction de la relecture finale est un round.
      { date, type: "final-review", verdict: "changes", detail: "2 importants" },
      { date, type: "final-review", verdict: "clean" },
      { date, type: "note", text: "round 3/5 écrit en prose : pas compté" },
    ]
      .map(line)
      .join("\n") + "\n",
  );
  // Ancien ledger en prose d'un autre fil : relu en notes, rien n'y est compté.
  writeFileSync(join(root, ".spawn", "ledgers", "ancien.md"), "- x Tâche 2 : round 1/5 (a)\n- x Tâche 4 : parquée — y\n");
  mkdirSync(join(root, ".claude", "worktrees", "oublie"), { recursive: true });

  process.env.CLAUDE_CONFIG_DIR = config;
  try {
    const m = measure(root);
    assert.deepEqual(m.interventions.map((i) => i.text), ["Fais un morpion à deux joueurs.", "Spec validée, vas-y."]);
    assert.equal(m.tokens.output, 100, "50 + 30 + 20, le doublon m1 exclu");
    assert.equal(m.tokens.cache_read, 300);
    assert.equal(m.by_model["claude-sonnet"]?.output, 70);
    assert.equal(m.sessions, 2);
    assert.equal(m.transcripts, 3);
    assert.equal(m.rounds, 3, "2 rounds de tâche + 1 relecture finale à corrections");
    assert.equal(m.parked_tasks, 1);
    assert.deepEqual(m.remaining_worktrees, ["oublie"]);

    const late = measure(root, "2026-11-18T10:30:00Z");
    assert.deepEqual(late.interventions.map((i) => i.text), ["Spec validée, vas-y."], "--since filtre par date");
    assert.equal(late.tokens.output, 50);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

// Coût : `total_cost_usd` est cumulé sur la session ; un tour coupé est compté par le `result` suivant de sa session,
// sinon déclaré non mesuré ; les agents de l'enchaîneur (sessions à eux) s'ajoutent.
test("metrics: cost from the conversation turns and the runner outputs, cumulative per session, unmeasured turns named", () => {
  const root = spawnProject();
  const conv = join(root, ".spawn", "conversations", "pont");
  const run = join(root, ".spawn", "tasks", "pont", "run");
  mkdirSync(conv, { recursive: true });
  mkdirSync(run, { recursive: true });
  const init = (s: string) => line({ type: "system", subtype: "init", session_id: s });
  const result = (s: string, usd: number, models: Record<string, number>) =>
    line({ type: "result", session_id: s, total_cost_usd: usd, modelUsage: Object.fromEntries(Object.entries(models).map(([m, c]) => [m, { costUSD: c }])) });
  writeFileSync(join(conv, "turn-1.jsonl"), [init("a"), result("a", 1, { opus: 1 })].join("\n"));
  writeFileSync(join(conv, "turn-2.jsonl"), init("a"));
  writeFileSync(join(conv, "turn-10.jsonl"), [init("a"), result("a", 3, { opus: 2.5, sonnet: 0.5 })].join("\n"));
  writeFileSync(join(conv, "turn-11.jsonl"), init("b"));
  writeFileSync(join(run, "20261118T100000-01-implementer.jsonl"), [init("c"), result("c", 0.25, { sonnet: 0.25 })].join("\n"));

  const { cost } = measure(root);
  assert.equal(cost.usd, 3.25);
  assert.deepEqual(cost.by_model, { opus: 2.5, sonnet: 0.75 });
  assert.equal(cost.sessions, 2);
  assert.deepEqual(cost.unmeasured, [".spawn/conversations/pont/turn-11.jsonl"]);
});
