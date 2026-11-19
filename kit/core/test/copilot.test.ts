// Lecteur Copilot CLI : événements JSONL réels (copilot 1.0.114, `--output-format json`) vers événements normalisés.
import assert from "node:assert/strict";
import { test } from "node:test";
import { measureCopilot, readCopilot } from "../src/agent/copilot.ts";

const lines = [
  { type: "session.start", data: { sessionId: "s-1" } },
  { type: "assistant.message", data: { content: "", toolRequests: [{ toolCallId: "t1", name: "powershell", arguments: { command: "echo hello" } }, { toolCallId: "t2", name: "create", arguments: { path: "a.txt" } }] } },
  { type: "tool.execution_complete", data: { toolCallId: "t1", success: true, result: { content: "hello" }, toolTelemetry: { metrics: { context_current_tokens: 27535 } } } },
  { type: "assistant.message", data: { content: "done", toolRequests: [] } },
  { type: "session.mcp_server_status_changed", data: {} },
  { type: "result", exitCode: 1, sessionId: "s-1" },
].map((l) => JSON.stringify(l));

test("copilot : session, outils, résultat, contexte, texte et fin", () => {
  const events = lines.flatMap(readCopilot);
  assert.deepEqual(events[0], { type: "start", session: "s-1", model: null });
  assert.deepEqual(events[1], { type: "tool", id: "t1", name: "powershell", summary: "echo hello", files: [], subagent: false });
  assert.deepEqual(events[2], { type: "tool", id: "t2", name: "create", summary: "a.txt", files: ["a.txt"], subagent: false });
  assert.deepEqual(events[3], { type: "tool-result", id: "t1", error: false, excerpt: "hello" });
  assert.deepEqual(events[4], { type: "usage", context: 27535, output: 0 });
  assert.deepEqual(events[5], { type: "text", text: "done", subagent: false });
  assert.deepEqual(events[6], { type: "end", text: null, error: "exit-1" });
  assert.equal(events.length, 7);
  assert.deepEqual(readCopilot("pas du json"), []);
});

const usage = (input: number, cacheRead: number, output: number) => ({
  type: "session.usage_checkpoint",
  data: { providerModelMetrics: [{ modelId: "m", metrics: { tokenDetails: { input: { tokenCount: input }, cache_read: { tokenCount: cacheRead }, cache_write: { tokenCount: 5 }, output: { tokenCount: output } } } }] },
});
const turn = (...rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n");

test("copilot : mesure = dernier point de la session (un tour repris est cumulatif), interventions sans sous-agents", () => {
  const t1 = turn({ type: "user.message", timestamp: "t1", data: { content: "intent" } }, usage(10, 100, 50), { type: "result", sessionId: "s-1", exitCode: 0 });
  const t2 = turn(
    { type: "user.message", timestamp: "t2", data: { content: "relance" } },
    { type: "user.message", timestamp: "t3", agentId: "a1", data: { content: "consigne du parent" } },
    usage(15, 250, 80),
    { type: "result", sessionId: "s-1", exitCode: 0 },
  );
  const m = measureCopilot([t1, t2]);
  assert.equal(m.sessions, 1);
  assert.deepEqual(m.tokens, { input: 15, cache_write: 5, cache_read: 250, output: 80 });
  assert.deepEqual(m.by_model.m, m.tokens);
  assert.deepEqual(
    m.interventions.map((i) => i.text),
    ["intent", "relance"],
  );
});
