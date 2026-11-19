// Faux agent des tests du service : rejoue le vrai flux de Claude (kit/core/test/data/claude-stream.jsonl).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { readClaude } from "../../kit/core/src/agent/claude.ts";
import type { AgentAdapter } from "../../kit/core/src/agent/type.ts";
import type { AgentFactory } from "../src/modules/conversation.ts";

export const STREAM = readFileSync(new URL("../../kit/core/test/data/claude-stream.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean);
// Session annoncée par le flux réel : les vrais adaptateurs rendent celle-là.
export const SESSION = (JSON.parse(STREAM[0] ?? "{}") as { session_id: string }).session_id;
export interface Call {
  dir: string;
  message: string;
  session: string | null;
}

// Faux agent : rejoue le vrai flux de Claude ligne à ligne ; s'il est `blocking`, attend le Stop.
export function fakeAgent(o: { blocking?: boolean; refusals?: string[]; during?: (dir: string) => void } = {}): { factory: AgentFactory; calls: Call[] } {
  const calls: Call[] = [];
  const agent: AgentAdapter = {
    name: "claude-code",
    async turn({ dir, message, session, output, signal }) {
      calls.push({ dir, message, session });
      o.during?.(dir);
      writeFileSync(output, "");
      for (const l of STREAM) {
        appendFileSync(output, l + "\n");
        await new Promise((ok) => setTimeout(ok, 20));
      }
      if (o.blocking && !signal?.aborted) await new Promise((ok) => signal?.addEventListener("abort", ok, { once: true }));
      return { code: signal?.aborted ? null : 0, session: session ?? SESSION };
    },
    read: readClaude,
    async maxContext() {
      return 120_000;
    },
    async check() {
      return o.refusals ?? [];
    },
    async measure() {
      return null;
    },
  };
  return { factory: () => agent, calls };
}
