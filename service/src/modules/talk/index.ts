// Module talk : la conversation de portée (docs/conversation.md), l'Accueil d'un projet ou d'un workspace. Chaque message
// lance un tour de l'agent dans le worktree `_talk` remis à develop (place.ts) ; sa sortie est poussée au fil de l'eau
// (événement « talk »), puis les blocs ```spawn de sa réponse sont exécutés par le service (actions.ts, execute.ts).
//
// Les tours vivent hors du montage des modules, comme ceux d'une story : éteindre un autre module ne coupe pas l'agent.
import type { AgentEvent } from "../../../../kit/core/src/agent/events.ts";
import { existsSync, readFileSync } from "node:fs";
import type { TalkScope, TalkTurn, TalkView } from "../../contract.ts";
import type { ServiceModule } from "../../module.ts";
import { HttpError } from "../../router.ts";
import { requestFeature } from "../backlog.ts";
import { defaultAgentFactory, Tail, type AgentFactory, type ConversationModule } from "../conversation.ts";
import { projectById } from "../projects.ts";
import { findProject } from "../../../../kit/core/src/project.ts";
import { parseActions } from "./actions.ts";
import { executeActions, reportForAgent, type CreateStory } from "./execute.ts";
import { prepareTalkWorktree } from "./place.ts";
import { talkPreamble } from "./prompt.ts";
import { resolveScope, type TalkTarget } from "./scope.ts";
import { markInterrupted, readTalk, turnFile, writeTalk, type StoredTalkTurn, type TalkState } from "./store.ts";

const TURN_TIMEOUT_MS = 30 * 60_000;
const TURNS_SHOWN = 30;

// Ce que l'agent a dit pendant le tour (sans ses sous-agents) : là où se trouvent ses blocs d'action.
function replyOf(events: readonly AgentEvent[]): string {
  return events
    .flatMap((e) => (e.type === "text" && !e.subagent ? [e.text] : e.type === "end" && e.text ? [e.text] : []))
    .join("\n\n");
}

export function talkModule(conversation: ConversationModule, factory: AgentFactory = defaultAgentFactory, options: { turnTimeoutMs?: number } = {}): ServiceModule {
  const turnTimeoutMs = options.turnTimeoutMs ?? TURN_TIMEOUT_MS;
  const running = new Map<string, AbortController>();
  const finished = new Map<string, Promise<void>>();
  let closing = false;
  let emit: (type: string, data: unknown) => void = () => {};

  const keyOf = (t: TalkTarget) => `${t.kind}:${t.id}`;

  const createStory: CreateStory = (projectId, request) => {
    const project = findProject(projectById(projectId).root);
    if (project === null) throw new Error(`le projet ${projectId} n'est plus un projet Spawn`);
    return requestFeature(conversation, projectId, project, request);
  };

  const view = (target: TalkTarget): TalkView => {
    if (!running.has(keyOf(target))) markInterrupted(target.store);
    const state = readTalk(target.store);
    const turns: TalkTurn[] = (state?.turns ?? []).slice(-TURNS_SHOWN).map((t) => {
      const path = turnFile(target.store, t.n);
      const raw = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean) : [];
      const reader = factory(t.agent, target.host.project);
      return { ...t, events: raw.flatMap((l) => reader.read(l)) };
    });
    return { agent: state?.agent ?? null, running: running.has(keyOf(target)), turns };
  };

  const launch = (target: TalkTarget, text: string): number => {
    const key = keyOf(target);
    const previous = readTalk(target.store);
    // L'agent suit les réglages du projet : s'ils changent, la session de l'ancien agent ne se reprend pas.
    const state: TalkState = previous && previous.agent === target.agent ? previous : { agent: target.agent, session: null, turns: previous?.turns ?? [] };
    const report = reportForAgent(state.turns.at(-1)?.actions ?? []);
    const n = (state.turns.at(-1)?.n ?? 0) + 1;
    const turn: StoredTalkTurn = { n, agent: state.agent, message: text, start: new Date().toISOString(), end: null, code: null, stopped: false, interrupted: false, refused: [], actions: [] };
    state.turns.push(turn);
    writeTalk(target.store, state);
    const controller = new AbortController();
    running.set(key, controller);
    const scope: { scope: TalkScope; id: string } = { scope: target.kind, id: target.id };
    emit("talk", { ...scope, turn: n, events: [] });

    const work = (async () => {
      const adapter = factory(state.agent, target.host.project);
      const tail = new Tail(turnFile(target.store, n));
      const said: AgentEvent[] = [];
      const push = () => {
        const events = tail.lines().flatMap((l) => adapter.read(l));
        said.push(...events);
        const start = events.find((e) => e.type === "start");
        if (start?.type === "start" && start.session && start.session !== state.session) {
          state.session = start.session;
          writeTalk(target.store, state);
        }
        if (events.length > 0) emit("talk", { ...scope, turn: n, events });
      };
      const timer = setInterval(push, 250);
      try {
        if (state.session === null) turn.refused = await adapter.check(target.host.project.root);
        if (turn.refused.length === 0) {
          const dir = prepareTalkWorktree(target.host.project.root, target.suffix);
          const message = [state.session === null ? talkPreamble(target, dir) : null, report, state.session === null || report ? `Message de l'utilisateur :\n${text}` : text].filter(Boolean).join("\n\n");
          const r = await adapter.turn({ dir, message, session: state.session, output: turnFile(target.store, n), timeoutMs: turnTimeoutMs, signal: controller.signal });
          turn.code = r.code;
          state.session = r.session;
        }
      } catch (e) {
        turn.refused = [`tour impossible : ${(e as Error).message}`];
      } finally {
        clearInterval(timer);
        push();
      }
      turn.interrupted = closing;
      turn.stopped = controller.signal.aborted && !closing;
      try {
        // Un tour arrêté ou refusé n'a pas fini sa pensée : ses blocs éventuels ne sont pas exécutés.
        if (!controller.signal.aborted && turn.refused.length === 0) {
          const { actions, errors } = parseActions(replyOf(said), target.kind);
          turn.actions = await executeActions(target, actions, errors, createStory, () => emit("workspaces", {}));
        }
      } catch (e) {
        turn.actions = [{ kind: "invalid", ok: false, error: `actions non exécutées : ${(e as Error).message}` }];
      } finally {
        turn.end = new Date().toISOString();
        writeTalk(target.store, state);
        running.delete(key);
        emit("talk-end", { ...scope, turn: n });
      }
    })();
    finished.set(key, work);
    void work.finally(() => {
      if (finished.get(key) === work) finished.delete(key);
    });
    return n;
  };

  const send = (target: TalkTarget, body: unknown): { turn: number } => {
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message !== "string" || !message.trim()) throw new HttpError(400, 'corps attendu : { "message": "…" }');
    if (running.has(keyOf(target))) throw new HttpError(409, "l'agent répond encore : attends la fin de son tour, ou arrête-le");
    return { turn: launch(target, message.trim()) };
  };

  const stop = (target: TalkTarget) => {
    const controller = running.get(keyOf(target));
    if (!controller) throw new HttpError(409, "aucun tour en cours dans cette conversation");
    controller.abort();
    return { stopped: true };
  };

  return {
    id: "talk",
    title: "Conversation de portée",
    description: "L'Accueil d'un projet ou d'un workspace : parler à son agent, qui crée stories et epics.",
    defaultOn: true,
    dependencies: ["backlog"],
    start(ctx) {
      emit = ctx.emit;
      for (const [kind, base] of [["project", "/api/projects/:id/talk"], ["workspace", "/api/workspaces/:id/talk"]] as const) {
        ctx.routes.add("GET", base, ({ params }) => view(resolveScope(kind, params.id ?? "")));
        ctx.routes.add("POST", base, ({ params, body }) => send(resolveScope(kind, params.id ?? ""), body));
        ctx.routes.add("POST", `${base}/stop`, ({ params }) => stop(resolveScope(kind, params.id ?? "")));
      }
      return undefined;
    },
    async close() {
      closing = true;
      for (const c of running.values()) c.abort();
      await Promise.race([Promise.all(finished.values()), new Promise((ok) => setTimeout(ok, 5000))]);
    },
  };
}
