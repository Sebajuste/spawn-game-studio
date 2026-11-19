// Lecture des flux des agents en événements normalisés : Claude Code sur un flux réel, OpenCode sur ses formes connues.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readClaude } from "../src/agent/claude.ts";
import { summarizeTool } from "../src/agent/events.ts";
import { readOpencode } from "../src/agent/opencode.ts";

const STREAM = readFileSync(new URL("./data/claude-stream.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean);

test("Claude Code, real stream: start, tool call, result, text, usage, end", () => {
  const evs = STREAM.flatMap(readClaude);
  assert.deepEqual(evs.map((e) => e.type), ["start", "tool", "usage", "tool-result", "text", "usage", "end"]);
  const start = evs[0];
  assert.ok(start?.type === "start" && start.model === "claude-haiku-5-5" && start.session);
  const tool = evs.find((e) => e.type === "tool");
  assert.ok(tool?.type === "tool" && tool.name === "Read" && /a\.txt$/.test(tool.summary) && tool.files.length === 0, "une lecture ne touche aucun fichier");
  const result = evs.find((e) => e.type === "tool-result");
  assert.ok(result?.type === "tool-result" && result.id === (tool?.type === "tool" ? tool.id : "") && /contenu témoin/.test(result.excerpt));
  const usage = evs.find((e) => e.type === "usage");
  assert.ok(usage?.type === "usage" && usage.context === 2 + 10374 + 16977, "contexte = entrée + écriture et lecture du cache");
  const end = evs.at(-1);
  assert.ok(end?.type === "end" && end.error === null && /a\.txt/.test(end.text ?? ""));
});

test("Claude Code: subagent announced, subagent messages flagged, its usage outside the gauge", () => {
  const launched = readClaude(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Agent", input: { subagent_type: "spawnstudio:implementer", description: "Tâche 2" } }] } }));
  assert.deepEqual(launched.map((e) => e.type), ["subagent", "tool"]);
  assert.ok(launched[0]?.type === "subagent" && launched[0].agent === "spawnstudio:implementer" && launched[0].description === "Tâche 2");
  const inside = readClaude(JSON.stringify({ type: "assistant", parent_tool_use_id: "t1", message: { content: [{ type: "text", text: "je code" }], usage: { input_tokens: 999 } } }));
  assert.deepEqual(inside, [{ type: "text", text: "je code", subagent: true }]);
  assert.deepEqual(readClaude("pas du json"), []);
  assert.deepEqual(readClaude(JSON.stringify({ type: "result", subtype: "error_max_turns" })), [{ type: "end", text: null, error: "error_max_turns" }]);
});

test("OpenCode: start, text, finished tool with its result, delegation, usage, error", () => {
  assert.deepEqual(readOpencode(JSON.stringify({ type: "step_start", sessionID: "ses_1", part: { type: "step-start" } })), [{ type: "start", session: "ses_1", model: null }]);
  assert.deepEqual(readOpencode(JSON.stringify({ type: "text", part: { type: "text", text: "bonjour" } })), [{ type: "text", text: "bonjour", subagent: false }]);
  const tool = readOpencode(JSON.stringify({ type: "tool_use", part: { type: "tool", callID: "c1", tool: "edit", state: { status: "completed", input: { filePath: "core/a.gd" }, output: "ok" } } }));
  assert.deepEqual(tool.map((e) => e.type), ["tool", "tool-result"]);
  assert.ok(tool[0]?.type === "tool" && tool[0].files[0] === "core/a.gd", "une édition touche son fichier");
  assert.equal(readOpencode(JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "subagent", state: { status: "running", input: { agent: "spawn-implementer", description: "Tâche 1" } } } }))[0]?.type, "subagent");
  assert.deepEqual(readOpencode(JSON.stringify({ type: "step_finish", part: { type: "step-finish", tokens: { input: 8000, output: 30, cache: { read: 500 } } } })), [{ type: "usage", context: 8500, output: 30 }]);
  assert.equal(readOpencode(JSON.stringify({ type: "error", error: "Model unavailable" }))[0]?.type, "end");
});

test("tool summary: command, path, and only writes touch a file", () => {
  assert.deepEqual(summarizeTool("Bash", { command: "npm   test" }), { summary: "npm test", files: [] });
  assert.deepEqual(summarizeTool("Write", { file_path: "a.gd", content: "x" }), { summary: "a.gd", files: ["a.gd"] });
  assert.deepEqual(summarizeTool("Grep", { pattern: "func" }), { summary: "func", files: [] });
});
