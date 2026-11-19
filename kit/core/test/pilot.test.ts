// Pilote d'essai et adaptateurs d'agent (Claude Code, OpenCode), avec de faux agents et de faux processus.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { claudeAdapter } from "../src/agent/claude.ts";
import { opencodeAdapter, checkGuard, childSessions } from "../src/agent/opencode.ts";
import type { Launcher } from "../src/agent/process.ts";
import type { AgentAdapter } from "../src/agent/type.ts";
import { ledgerPath } from "../src/context.ts";
import { readStory, updateStory } from "../src/stories.ts";
import { gitOk } from "../src/git.ts";
import { write } from "../src/ledger.ts";
import { pilot } from "../src/pilot.ts";
import { commit, configure, tempDir, cleanDirs, spawnProject } from "./git-helper.ts";

after(cleanDirs);
process.env.SPAWN_ENGINES = fileURLToPath(new URL("./adapters/", import.meta.url));
const EXPORTS = JSON.parse(readFileSync(new URL("./data/opencode-export-subagent.json", import.meta.url), "utf8")) as { info: { id: string } }[];
const silence = { log: () => {} };

// Faux agent : chaque tour applique `effet(n)` à l'état du projet, comme le ferait une vraie session.
function fakeAgent(effect: (n: number) => void): { agent: AgentAdapter; messages: (string | null)[][] } {
  const messages: (string | null)[][] = [];
  let n = 0;
  const agent: AgentAdapter = {
    name: "claude-code",
    async turn({ message, session }) {
      messages.push([session, message]);
      effect(++n);
      return { code: 0, session: "s1" };
    },
    read: () => [],
    async maxContext() {
      return null;
    },
    async check() {
      return [];
    },
    async measure() {
      return { sessions: 1, interventions: [], tokens: { input: 1, cache_write: 0, cache_read: 0, output: 2 }, by_model: {} };
    },
  };
  return { agent, messages };
}

test("pilot: intent, approval when the story waits for it, merge; session resumed; report written", async () => {
  const root = spawnProject();
  const ev = (o: Record<string, unknown>) => write(ledgerPath(root, "morpion"), { date: new Date().toISOString(), ...o } as never);
  const { agent, messages } = fakeAgent((n) => {
    if (n === 1) updateStory(root, "morpion", { status: "blocked:decision", task: "validation de la spec" });
    if (n === 2) {
      updateStory(root, "morpion", { status: "active" });
      ev({ type: "round", task: 1, number: 1, detail: "x" });
      ev({ type: "merged", commit: "f".repeat(40) });
    }
  });
  const report = await pilot({ root, story: "morpion", intent: "Un morpion à deux joueurs.", agent, ...silence });
  assert.equal(report.verdict, "merged");
  assert.deepEqual(report.interventions.map((i) => i.type), ["intent", "validation"]);
  assert.match(report.interventions[0]?.text ?? "", /^Un morpion à deux joueurs\.[\s\S]*next/);
  assert.deepEqual(messages.map((m) => m[0]), [null, "s1"], "la session est reprise au tour suivant");
  assert.equal(report.rounds, 1);
  assert.equal(report.metrics?.tokens.output, 2);
  assert.ok(readFileSync(`${root}/.spawn/pilot/morpion/report.json`, "utf8").includes("merged"));
});

test("pilot: the story in acceptance is accepted by the pilot, then merged and cleaned up without the agent", async () => {
  const root = spawnProject();
  writeFileSync(`${root}/.gitignore`, ".spawn/\n.claude/worktrees/\n.fake-cache/\n");
  gitOk(root, ["checkout", "--quiet", "develop"]);
  gitOk(root, ["add", ".gitignore"]);
  gitOk(root, ["commit", "--quiet", "-m", "ignore"]);
  commit(root, "test/test_projet.fx", "PASS\n", "premier test");
  gitOk(root, ["checkout", "--quiet", "main"]);
  const wt = `${root}/.claude/worktrees/morpion`;
  const { agent, messages } = fakeAgent((n) => {
    if (n !== 1) return;
    configure(wt);
    commit(wt, "grille.fx", "GRILLE\n", "grille");
    write(ledgerPath(root, "morpion"), { date: new Date().toISOString(), type: "acceptance-report", summary: "une grille", how_to_check: "cliquer" });
    updateStory(root, "morpion", { status: "in-acceptance" });
  });
  const report = await pilot({ root, story: "morpion", intent: "Un morpion.", agent, ...silence });
  assert.equal(report.verdict, "merged", report.reason);
  assert.deepEqual(report.interventions.map((i) => i.type), ["intent", "acceptance"]);
  assert.match(messages[0]?.[1] ?? "", /à juger/);
  assert.equal(messages.length, 1, "la fusion se fait sans rappeler l'agent");
  assert.equal(readStory(root, "morpion")?.status, "cleaned");
  assert.match(gitOk(root, ["log", "-1", "--format=%s", "develop"]), /^morpion : /);
});

test("pilot: idle session, stop after 3 turns without progress", async () => {
  const root = spawnProject();
  const report = await pilot({ root, story: "inerte", intent: "x", agent: fakeAgent(() => {}).agent, ...silence });
  assert.equal(report.verdict, "abandoned");
  assert.match(report.reason, /3 tours sans aucun changement/);
  assert.deepEqual(report.interventions.map((i) => i.type), ["intent", "restart", "restart"]);
});

test("pilot: session progressing without merging, stop at the restart cap", async () => {
  const root = spawnProject();
  const { agent } = fakeAgent((n) => write(ledgerPath(root, "lent"), { date: new Date().toISOString(), type: "note", text: `tour ${n}` }));
  const report = await pilot({ root, story: "lent", intent: "x", agent, restarts: 2, ...silence });
  assert.match(report.reason, /2 relances sans fusion/);
  assert.equal(report.turns, 3);
});

// Faux processus : note les appels, écrit une sortie.
function fakeLauncher(writeOutput: (program: string, args: readonly string[]) => string): { run: Launcher; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run: async (program, args, o) => {
      calls.push([program, ...args]);
      writeFileSync(o.output, writeOutput(program, args));
      return 0;
    },
  };
}

test("Claude Code adapter: claude -p with JSON stream, bypass, resume with --resume, session read from the init event", async () => {
  const { run, calls } = fakeLauncher(() => JSON.stringify({ type: "system", subtype: "init", session_id: "abc" }) + "\n");
  const agent = claudeAdapter({ run });
  const dir = tempDir("claude");
  const t1 = await agent.turn({ dir, message: "bonjour", session: null, output: `${dir}/t1.jsonl`, timeoutMs: 1000 });
  assert.equal(t1.session, "abc");
  await agent.turn({ dir, message: "continue", session: "abc", output: `${dir}/t2.jsonl`, timeoutMs: 1000 });
  assert.deepEqual(calls[0]?.slice(0, 8), ["claude", "-p", "bonjour", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"]);
  assert.deepEqual(calls[1]?.slice(-2), ["--resume", "abc"]);
});

test("OpenCode adapter: run --auto, resume with --session, child sessions exported for metrics", async () => {
  const { run, calls } = fakeLauncher((_p, args) => {
    if (args[0] === "session") return JSON.stringify(EXPORTS.find((e) => e.info.id === args[2]) ?? {});
    return JSON.stringify({ type: "step_start", sessionID: EXPORTS[0]?.info.id }) + "\n";
  });
  const agent = opencodeAdapter({ model: "lmstudio/qwen/qwen3.5-9b", run });
  const dir = tempDir("opencode");
  const t = await agent.turn({ dir, message: "bonjour", session: null, output: `${dir}/t.jsonl`, timeoutMs: 1000 });
  assert.equal(t.session, EXPORTS[0]?.info.id);
  assert.ok(calls[0]?.includes("--auto") && calls[0].includes("--standalone"));
  const m = await agent.measure({ root: dir, session: t.session, since: "", exportsDir: dir });
  assert.equal(m?.sessions, 2, "la session du sous-agent est exportée aussi");
  assert.deepEqual(childSessions(EXPORTS[0]), [EXPORTS[1]?.info.id]);
});

test("OpenCode guard check: an active plugin leaves a refusal in the log; without plugin, the trial is cancelled", async () => {
  const input = fileURLToPath(new URL("../src/hooks/pre-tool-use.ts", import.meta.url));
  const withPlugin: Launcher = async (_p, args, o) => {
    const command = /"([^"]+)"$/.exec(args[args.length - 1] ?? "")?.[1] ?? "";
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    spawnSync(process.execPath, [input], { input: JSON.stringify({ cwd: o.cwd, tool_name: "Bash", tool_input: { command: command } }), env });
    return 0;
  };
  assert.equal(await checkGuard("m", withPlugin), null);
  assert.match((await checkGuard("m", async () => 0)) ?? "", /essai annulé/);
});

test("launch on Windows: the .exe from PATH, or the one the npm shim (.cmd) calls, never the shim", async () => {
  const { executable } = await import("../src/agent/process.ts");
  const { mkdirSync, writeFileSync: writeFileAt } = await import("node:fs");
  const { join } = await import("node:path");
  const npm = tempDir("npm");
  mkdirSync(join(npm, "node_modules", "@outil", "bin"), { recursive: true });
  writeFileAt(join(npm, "node_modules", "@outil", "bin", "outil.exe"), "");
  writeFileAt(join(npm, "outil.cmd"), String.raw`@ECHO off
"%dp0%\node_modules\@outil\bin\outil.exe"   %*
`);
  const native = tempDir("natif");
  writeFileAt(join(native, "natif.exe"), "");
  const env = { PATH: [native, npm].join(";") };
  assert.equal(executable("outil", env, "win32"), join(npm, "node_modules", "@outil", "bin", "outil.exe"));
  assert.equal(executable("natif", env, "win32"), join(native, "natif.exe"));
  assert.equal(executable("absent", env, "win32"), "absent");
  assert.equal(executable("outil", env, "linux"), "outil", "hors Windows : le nom tel quel");
});
