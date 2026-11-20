// Conversation avec l'agent d'une story, et ses vues autour : ligne d'activité, jauge de contexte, barre d'état. Chaque
// zone n'existe que si son module est actif ; la conversation se met à jour par le flux d'événements du service.
import { useCallback, useEffect, useMemo, useState } from "react";
import { label, Refusal, type Action } from "../../shared/action.ts";
import { t } from "../../i18n/i18n.ts";
import type { Api, AgentName, ConversationEnd, ConversationEvent, ConversationTurn, ConversationView } from "../../shared/api.ts";
import { agentName, AGENTS } from "./agents.ts";
import { Turn } from "./Turn.tsx";
import { Activity } from "./Activity.tsx";
import { Gauge } from "./Gauge.tsx";
import { AgentStatus } from "./AgentStatus.tsx";

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
      {active.has("status-bar") && <AgentStatus agent={view?.agent ?? null} events={allEvents} branch={branch} worktree={worktree} />}
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
