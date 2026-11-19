// Couche OpenCode générée depuis les sources du kit, et vocabulaire de spawn next selon l'agent.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { contextOf } from "../src/context.ts";
import { createWorktree } from "../src/hooks/worktree.ts";
import { adaptText, opencodeAgent, generateOpencode, CLAUDE_WORDS, skillOpencode } from "../src/opencode.ts";
import { nextAction } from "../src/next.ts";
import { cleanDirs, spawnProject } from "./git-helper.ts";

after(cleanDirs);
const ENGINES = fileURLToPath(new URL("./adapters/", import.meta.url));

test("generated files: plugin, 4 skills, 3 agents, no Claude Code specific word", () => {
  const files = generateOpencode("/config-opencode");
  const names = files.map((f) => f.path.split(/[\\/]/).slice(-2).join("/")).sort();
  assert.deepEqual(names, [
    "agents/spawn-implementer.md",
    "agents/spawn-scene-validator.md",
    "agents/spawn-task-reviewer.md",
    "spawn-finish-story/SKILL.md",
    "spawn-game-studio/index.ts",
    "spawn-review/SKILL.md",
    "spawn-story/SKILL.md",
    "spawn-task/SKILL.md",
  ]);
  for (const f of files) assert.doesNotMatch(f.content, CLAUDE_WORDS, f.path);
  // Ce que lit le modèle : des commandes entières (`spawn next`, la commande des lanceurs) et aucun chemin absolu.
  for (const f of files.filter((x) => x.path.endsWith(".md"))) assert.doesNotMatch(f.content, /(^|[\s"'(`])([A-Za-z]:[\\/]|\/(Users|home|tmp)\/)/m, f.path);
  assert.match(files.find((f) => f.path.includes("spawn-story"))?.content ?? "", /`spawn next`/);
  const plugin = files.find((f) => f.path.endsWith("index.ts"))?.content ?? "";
  const input = /const ENTRY = "([^"]+)"/.exec(plugin)?.[1] ?? "";
  assert.ok(existsSync(input), `le plugin appelle un point d'entrée existant : ${input}`);
  assert.match(plugin, /e\.effect = "deny"/);
});

test("skill and agent: prefixed names, the spawn command kept as is, gestures translated", () => {
  const skill = skillOpencode("---\nname: story\ndescription: d\n---\nLance `spawn next`. EnterWorktree avec ce nom. Agent `spawnstudio:implementer` (SendMessage).\n");
  assert.match(skill, /^---\nname: spawn-story\n/);
  assert.match(skill, /Lance `spawn next`. `spawn story create <nom>`/);
  assert.match(skill, /`spawn-implementer` \(en le relançant avec le brief et les findings\)/);
  const agent = opencodeAgent("---\nname: implementer\ndescription: Implémente une tâche.\ntools: Read, Bash\nmodel: sonnet\n---\nRegarde avec Read.\n");
  assert.equal(agent, "---\ndescription: Implémente une tâche.\nmode: subagent\n---\nRegarde avec l'outil de lecture de fichiers.\n");
  assert.equal(adaptText("rien de propre à un agent"), "rien de propre à un agent");
});

test("spawn next speaks the current agent's vocabulary (SPAWN_AGENT)", async () => {
  const root = spawnProject();
  const ctx = contextOf(root);
  assert.ok(ctx);
  await createWorktree({ cwd: root, name: "x" }, { engines: ENGINES, log: () => {} });
  const before = process.env.SPAWN_AGENT;
  try {
    process.env.SPAWN_AGENT = "opencode";
    const o = nextAction(ctx);
    assert.match(o.instruction, /spawn story create <nom du fil>/);
    assert.doesNotMatch(JSON.stringify(o), CLAUDE_WORDS);
    delete process.env.SPAWN_AGENT;
    assert.match(nextAction(ctx).instruction, /EnterWorktree/);
  } finally {
    if (before === undefined) delete process.env.SPAWN_AGENT;
    else process.env.SPAWN_AGENT = before;
  }
});
