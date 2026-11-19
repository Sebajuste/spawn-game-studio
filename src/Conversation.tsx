// Conversation avec l'agent d'une story, et ses vues autour : ligne d'activité, jauge de contexte, barre d'état. Chaque
// zone n'existe que si son module est actif ; la conversation se met à jour par le flux d'événements du service.
import { useCallback, useEffect, useMemo, useState } from "react";
import { label, Refusal, type Action } from "./action.ts";
import { t } from "./i18n.ts";
import type { Api, AgentEvent, AgentName, ConversationEnd, ConversationEvent, ConversationTurn, ConversationView } from "./api.ts";

interface Props {
  api: Api;
  events: EventSource | null;
  project: string;
  story: string;
  active: ReadonlySet<string>;
  branch: string | null;
  worktree: string | null;
  // Agent de la story quand la conversation n'a pas encore de tour : la jauge suit cet agent, jamais un autre par défaut.
  plannedAgent?: AgentName | null;
  // Le `useAction` de la carte : un seul pour toute la carte, pour que ses gestes se grisent ensemble.
  act: Action;
}

const agentName = (a: AgentName): string => ({ "claude-code": "Claude Code", opencode: t("conversation.agent.opencode"), copilot: "GitHub Copilot" })[a];
const AGENTS: AgentName[] = ["claude-code", "opencode", "copilot"];

export function Conversation({ api, events, project, story, active, branch, worktree, plannedAgent = null, act }: Props) {
  const [view, setView] = useState<ConversationView | null>(null);
  const [message, setMessage] = useState("");
  const [agent, setAgent] = useState<AgentName>("claude-code");
  const [error, setError] = useState<string | null>(null);
  const [contextMax, setContextMax] = useState<number | null | undefined>(undefined);
  const path = `/api/projects/${project}/stories/${story}/conversation`;

  const load = useCallback(async () => {
    try {
      setView(await api.call<ConversationView>("GET", path));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, path]);

  useEffect(() => {
    setView(null);
    setError(null);
    void load();
  }, [load]);

  // Les événements d'un tour en cours s'ajoutent au tour ; sa fin recharge la vue depuis le disque.
  useEffect(() => {
    if (!events) return;
    const forMe = (d: { project: string; story: string }) => d.project === project && d.story === story;
    const onEvents = (e: Event) => {
      const d = JSON.parse((e as MessageEvent<string>).data) as ConversationEvent;
      if (!forMe(d)) return;
      setView((v) => {
        if (!v) return v;
        const turns = v.turns.some((t) => t.n === d.turn) ? v.turns : [...v.turns, emptyTurn(d.turn, v.agent ?? "claude-code")];
        return { ...v, running: true, turns: turns.map((t) => (t.n === d.turn ? { ...t, events: [...t.events, ...d.events] } : t)) };
      });
    };
    const onEnd = (e: Event) => {
      if (forMe(JSON.parse((e as MessageEvent<string>).data) as ConversationEnd)) void load();
    };
    events.addEventListener("conversation", onEvents);
    events.addEventListener("conversation-end", onEnd);
    return () => {
      events.removeEventListener("conversation", onEvents);
      events.removeEventListener("conversation-end", onEnd);
    };
  }, [events, project, story, load]);

  const currentAgent = view?.agent ?? plannedAgent;
  useEffect(() => {
    if (!active.has("context") || currentAgent === null) return;
    api
      .call<{ max: number | null }>("GET", `/api/projects/${project}/context/${currentAgent}`)
      .then((r) => setContextMax(r.max))
      .catch(() => setContextMax(null));
  }, [api, project, currentAgent, active]);

  const send = async () => {
    const text = message.trim();
    if (!text) return;
    const ok = await act.run("send", async () => {
      await api.call("POST", path, { message: text, ...(view?.agent ? {} : { agent }) });
      await load();
    });
    if (ok) {
      setMessage("");
      setError(null);
    }
  };
  const action = (key: string, suffix: string) =>
    act.run(key, async () => {
      await api.call("POST", `${path}/${suffix}`);
      await load();
    });

  const unqueue = (id: string) =>
    act.run(`unqueue-${id}`, async () => {
      await api.call("DELETE", `${path}/queue/${id}`);
      await load();
    });

  const allEvents = useMemo(() => (view?.turns ?? []).flatMap((t) => t.events), [view]);
  const last = view?.turns[view.turns.length - 1];

  return (
    <section className="conversation">
      {active.has("status-bar") && <StatusBar agent={view?.agent ?? null} events={allEvents} branch={branch} worktree={worktree} />}
      {active.has("context") && <Gauge events={allEvents} max={contextMax} />}

      <div className="turns">
        {view && view.turns.length === 0 && <p className="muted">{t("conversation.empty")}</p>}
        {view?.turns.map((t) => <Turn key={t.n} turn={t} />)}
        {view?.queued.map((q) => (
          <div key={q.id} className="queued">
            <div className="bubble-me queued-bubble">{q.message}</div>
            <div className="muted">
              {t("conversation.queued")}{" "}
              <button type="button" disabled={act.pending !== null} onClick={() => void unqueue(q.id)}>
                {label(act, `unqueue-${q.id}`, t("conversation.unqueue"), t("conversation.unqueuing"))}
              </button>
              <Refusal action={act} k={`unqueue-${q.id}`} />
            </div>
          </div>
        ))}
      </div>

      {last?.interrupted && !view?.running && (
        <div className="waiting-banner">
          {t("conversation.interrupted")}{" "}
          <button disabled={act.pending !== null} onClick={() => void action("resume", "resume")}>{label(act, "resume", t("conversation.resume"), t("conversation.resuming"))}</button>
          <Refusal action={act} k="resume" />
        </div>
      )}
      {view?.running && active.has("activity") && <Activity turn={last} />}
      {error && <div className="error-banner" onClick={() => setError(null)}>{error}</div>}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {!view?.agent && (
          <select value={agent} disabled={act.pending !== null} onChange={(e) => setAgent(e.target.value as AgentName)} title={t("conversation.agentTitle")}>
            {AGENTS.map((a) => (
              <option key={a} value={a}>
                {agentName(a)}
              </option>
            ))}
          </select>
        )}
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={view?.running ? t("conversation.placeholderRunning") : t("conversation.placeholderIdle")}
          rows={3}
        />
        <button type="submit" disabled={!message.trim() || act.pending !== null}>
          {label(act, "send", view?.running ? t("conversation.queue") : t("conversation.send"), t("conversation.sending"))}
        </button>
        {view?.running && (
          <button type="button" className="stop" disabled={act.pending !== null} onClick={() => void action("stop", "stop")}>
            {label(act, "stop", t("conversation.stop"), t("conversation.stopping"))}
          </button>
        )}
        <Refusal action={act} k="send" />
        <Refusal action={act} k="stop" />
      </form>
    </section>
  );
}

function emptyTurn(n: number, agent: AgentName): ConversationTurn {
  return { n, agent, message: "", start: new Date().toISOString(), end: null, code: null, stopped: false, interrupted: false, refused: [], events: [] };
}

function Turn({ turn }: { turn: ConversationTurn }) {
  const results = new Map(turn.events.flatMap((e) => (e.type === "tool-result" ? [[e.id, e] as const] : [])));
  return (
    <div className="turn">
      {turn.message && <div className="bubble-me">{turn.message}</div>}
      {turn.refused.map((r, i) => (
        <div key={i} className="error-banner">
          {t("conversation.turnRefused", { reason: r })}
        </div>
      ))}
      {turn.events.map((e, i) => {
        if (e.type === "text") return <div key={i} className={`bubble-agent ${e.subagent ? "subagent" : ""}`}>{e.text}</div>;
        if (e.type === "subagent") return <div key={i} className="tool-line">{t("conversation.subagent")} <strong>{e.agent}</strong> : {e.description}</div>;
        if (e.type === "tool" && e.name !== "Agent" && e.name !== "Task" && e.name !== "subagent") {
          const r = results.get(e.id);
          return (
            <div key={i} className={`tool-line ${e.subagent ? "subagent" : ""} ${r?.error ? "error" : ""}`} title={r?.excerpt}>
              {r?.error ? "✗" : "▸"} {e.name} <span className="muted">{e.summary}</span>
            </div>
          );
        }
        if (e.type === "end" && e.error) return <div key={i} className="error-banner">{t("conversation.endError", { error: e.error })}</div>;
        return null;
      })}
      {turn.stopped && <div className="muted">{t("conversation.stopped")}</div>}
      {turn.interrupted && <div className="muted">{t("conversation.cut")}</div>}
    </div>
  );
}

// Ce que l'agent fait maintenant : les outils sans résultat, les sous-agents en cours.
function Activity({ turn }: { turn: ConversationTurn | undefined }) {
  const evs = turn?.events ?? [];
  const done = new Set(evs.flatMap((e) => (e.type === "tool-result" ? [e.id] : [])));
  const subagents = evs.filter((e): e is Extract<AgentEvent, { type: "subagent" }> => e.type === "subagent" && !done.has(e.id));
  const tool = [...evs].reverse().find((e): e is Extract<AgentEvent, { type: "tool" }> => e.type === "tool" && !done.has(e.id) && e.name !== "Agent" && e.name !== "Task" && e.name !== "subagent");
  return (
    <div className="activity">
      <span className="live-dot" />
      {tool ? (
        <span>
          {tool.name} <span className="muted">{tool.summary}</span>
        </span>
      ) : (
        <span className="muted">{t("conversation.thinking")}</span>
      )}
      {subagents.length > 0 && <span className="muted"> · {t("conversation.subagents", { count: subagents.length })} : {subagents.map((s) => s.agent).join(", ")}</span>}
    </div>
  );
}

// Place prise dans le contexte de la session principale, rapportée au seuil de compactage.
function Gauge({ events, max }: { events: AgentEvent[]; max: number | null | undefined }) {
  const usage = [...events].reverse().find((e) => e.type === "usage");
  const used = usage?.type === "usage" ? usage.context : 0;
  const share = max ? Math.min(1, used / max) : 0;
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  return (
    <div className="gauge" title={max ? t("conversation.gaugeTitle") : t("conversation.gaugeUnknownTitle")}>
      <span className="muted">{t("conversation.context")}</span>
      <div className="gauge-bar">
        <div className={`gauge-fill ${share > 0.85 ? "high" : ""}`} style={{ width: `${share * 100}%` }} />
      </div>
      <span className="muted">{max ? `${k(used)} / ${k(max)}` : max === null ? `${k(used)} / ${t("conversation.unknown")}` : "…"}</span>
    </div>
  );
}

function StatusBar({ agent, events, branch, worktree }: { agent: AgentName | null; events: AgentEvent[]; branch: string | null; worktree: string | null }) {
  const start = [...events].reverse().find((e) => e.type === "start" && e.model);
  return (
    <div className="status-bar">
      <span>{agent ? agentName(agent) : t("conversation.agentToChoose")}</span>
      {start?.type === "start" && start.model && <span>{start.model}</span>}
      {branch && <span>⎇ {branch}</span>}
      {worktree && <span title={worktree}>{worktree}</span>}
    </div>
  );
}
