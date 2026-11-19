// Lecteur Copilot CLI : événements JSONL réels (copilot 1.0.114, `--output-format json`) vers événements normalisés.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readCopilot } from "../src/agent/copilot.ts";

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
