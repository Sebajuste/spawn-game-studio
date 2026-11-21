// Une story (docs/ux-parcours.md §4 à §7). Onglet Avancement par défaut : ce qui attend l'utilisateur en tête
// (question, recette), une ligne « maintenant », puis les étapes. Les autres onglets (Conversation, Fichiers, Journal,
// Technique) gardent le détail, chacun selon son module.
import { useCallback, useEffect, useState } from "react";
import type { Api, AgentEvent, ConversationEvent, StoryDetail } from "../shared/api.ts";
import { label, Refusal, useAction } from "../shared/action.ts";
import { Conversation } from "./conversation/Conversation.tsx";
import { Files } from "./files/Files.tsx";
import { Steps } from "./Steps.tsx";
import { Outcome } from "./Outcome.tsx";
import { Idle } from "./Idle.tsx";
import { ApproveSpec } from "./ApproveSpec.tsx";
import { Answer } from "./Answer.tsx";
import { Acceptance } from "./Acceptance.tsx";
import { Log } from "./Log.tsx";
import { Technical } from "./Technical.tsx";
import { StoryMenu } from "./StoryMenu.tsx";
import { since } from "../shared/time.ts";
import { AGENT_NAMES } from "../project/agents.ts";
import { subtitle } from "../project/storyText.ts";
import { t } from "../i18n/i18n.ts";
import "./story.css";

export interface StoryPageProps {
  api: Api;
  events: EventSource | null;
  project: string;
  story: string;
  active: ReadonlySet<string>;
  onLaunch: () => void;
  onError: (e: string | null) => void;
  onClosed: () => void;
}

type Tab = "progress" | "conversation" | "files" | "log" | "technical";

export function StoryPage({ api, events, project, story, active, onLaunch, onError, onClosed }: StoryPageProps) {
  const [detail, setDetail] = useState<StoryDetail | null>(null);
  const [tab, setTab] = useState<Tab>("progress");
  const [now, setNow] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const act = useAction();
  // Durée de l'action longue : recalculée chaque seconde depuis `since`, tant qu'il y en a une.
  const [tick, setTick] = useState(0);
  const operationSince = detail?.operation?.since ?? null;
  useEffect(() => {
    if (!operationSince) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [operationSince]);
  const base = `/api/projects/${project}/backlog/${story}`;
  const conversationPath = `/api/projects/${project}/stories/${story}/conversation`;

  const load = useCallback(async () => {
    try {
      setDetail(await api.call<StoryDetail>("GET", base));
    } catch (e) {
      onError((e as Error).message);
    }
  }, [api, base, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Rechargement sur les événements du service ; la ligne « maintenant » suit le flux de l'agent.
  useEffect(() => {
    if (!events) return;
    const reload = (e: Event) => {
      const d = JSON.parse((e as MessageEvent<string>).data) as { project?: string; story?: string };
      if (d.project === project && (d.story === undefined || d.story === story)) void load();
    };
    const onStream = (e: Event) => {
      const d = JSON.parse((e as MessageEvent<string>).data) as ConversationEvent;
      if (d.project !== project || d.story !== story) return;
      for (const ev of d.events) {
        const line = nowLine(ev);
        if (line) setNow(line);
      }
    };
    const onEnd = (e: Event) => {
      setNow(null);
      reload(e);
    };
    events.addEventListener("stories", reload);
    events.addEventListener("backlog", reload);
    events.addEventListener("conversation", onStream);
    events.addEventListener("conversation-end", onEnd);
    return () => {
      events.removeEventListener("stories", reload);
      events.removeEventListener("backlog", reload);
      events.removeEventListener("conversation", onStream);
      events.removeEventListener("conversation-end", onEnd);
    };
  }, [events, project, story, load]);

  // Un geste de la carte : son attente et son refus passent par `act`, à côté du bouton cliqué.
  const action = (key: string, path: string, body?: unknown) =>
    act.run(key, async () => {
      await api.call("POST", `${base}/${path}`, body);
      onError(null);
      await load();
    });
  const conversationAction = (key: string, suffix: string) =>
    act.run(key, async () => {
      await api.call("POST", `${conversationPath}/${suffix}`);
      await load();
    });

  // F2 : renommer.
  useEffect(() => {
    const f2 = (e: KeyboardEvent) => {
      if (e.key === "F2" && detail) setRename(detail.title);
    };
    window.addEventListener("keydown", f2);
    return () => window.removeEventListener("keydown", f2);
  }, [detail]);

  if (!detail) return <div className="scroll" />;
  const closed = detail.group === "history";
  const op = detail.operation;
  const tabs: [Tab, string, boolean][] = [
    ["progress", t("story.tab.progress"), true],
    ["conversation", t("story.tab.conversation"), active.has("conversation")],
    ["files", t("story.tab.files"), active.has("files")],
    ["log", t("story.tab.log"), true],
    ["technical", t("story.tab.technical"), true],
  ];

  return (
    <>
      <div className="story-header">
        <div className="title-row">
          {rename !== null ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act
                  .run("rename", async () => {
                    await api.call("PATCH", base, { title: rename });
                    await load();
                  })
                  .then((ok) => ok && setRename(null));
              }}
            >
              <input className="rename" autoFocus value={rename} disabled={act.pending !== null} onChange={(e) => setRename(e.target.value)} onBlur={() => act.pending === null && setRename(null)} onKeyDown={(e) => e.key === "Escape" && act.pending === null && setRename(null)} />
              {act.pending === "rename" && <span className="muted small-text">{t("story.renaming")}</span>}
              <Refusal action={act} k="rename" />
            </form>
          ) : (
            <h1 onDoubleClick={() => setRename(detail.title)} title={t("story.renameHint")}>
              {detail.title}
            </h1>
          )}
          <span className="muted">
            {subtitle(detail)}
            {detail.start && t("story.startedSince", { since: since(detail.start) })}
            {detail.agent && ` · ${AGENT_NAMES[detail.agent]}`}
          </span>
          <span className="spacer" />
          {!closed && op?.kind === "turn" && (
            <button className="btn small" disabled={act.pending !== null} onClick={() => void conversationAction("pause", "stop")}>
              {label(act, "pause", t("story.pause"), t("story.pausing"))}
            </button>
          )}
          <Refusal action={act} k="pause" />
          <StoryMenu
            title={detail.title}
            closed={closed}
            onRename={() => setRename(detail.title)}
            onAbandon={async () => {
              await api.call("POST", `${base}/abandon`);
              onError(null);
              onClosed();
            }}
          />
        </div>
        {detail.request && <p className="original-request">« {detail.request} »</p>}
        <nav className="tabs">
          {tabs
            .filter(([, , visible]) => visible)
            .map(([id, title]) => (
              <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
                {title}
              </button>
            ))}
        </nav>
      </div>

      {tab === "progress" && (
        <div className="scroll">
          {/* Une action longue remplace la carte des gestes : aucun bouton Valider tant qu'elle tourne. */}
          {op ? (
            <div className="now" data-tick={tick}>
              <span className="live-dot" />
              <span>
                {op.kind === "merge" ? t("story.now.merge") : t("story.now.agent")} — {elapsed(op.since)}
                {op.kind === "turn" && now && <span className="muted"> · {now}</span>}
              </span>
            </div>
          ) : (
            <>
              <Outcome detail={detail} />
              <Idle detail={detail} act={act} onResume={() => void conversationAction("resume", "resume")} />
              {detail.group === "blocked" && detail.waiting?.reason === "spec-approval" && <ApproveSpec api={api} project={project} detail={detail} act={act} onApprove={() => action("approve", "approve-spec")} onAnswer={(m) => action("changes", "answer", { message: m })} />}
              {detail.group === "blocked" && detail.waiting?.reason !== "spec-approval" && <Answer detail={detail} act={act} onAnswer={(m) => action("answer", "answer", { message: m })} onResume={() => void conversationAction("resume", "resume")} />}
              {detail.group === "acceptance" && (
                <Acceptance api={api} project={project} story={story} detail={detail} act={act} onLaunch={onLaunch} onAccept={() => action("accept", "accept")} onRequestChanges={(m) => action("changes", "request-changes", { message: m })} onShowFiles={() => setTab("files")} />
              )}
            </>
          )}
          {detail.result === "abandoned" && <div className="banner grey">{t("story.abandonedBanner", { since: since(detail.updated) })}</div>}
          {detail.result === "accepted" && (
            <div className="banner green">
              {t("story.acceptedBanner", { since: since(detail.updated) })}{" "}
              <button className="btn small" onClick={() => setTab("files")}>
                {t("story.seeChanges")}
              </button>
            </div>
          )}
          <section className="card">
            <Steps steps={detail.progress} unknown={detail.unknownStep} />
          </section>
        </div>
      )}
      {tab === "conversation" && (
        <div className="scroll">
          <Conversation api={api} events={events} project={project} story={story} active={active} branch={detail.branch} worktree={detail.worktree} plannedAgent={detail.agent} act={act} />
        </div>
      )}
      {tab === "files" && (
        <div className="scroll">
          <Files api={api} events={events} project={project} story={story} gallery={active.has("gallery")} />
        </div>
      )}
      {tab === "log" && <Log api={api} project={project} story={story} />}
      {tab === "technical" && <Technical api={api} project={project} story={story} detail={detail} />}
    </>
  );
}

function nowLine(ev: AgentEvent): string | null {
  if (ev.type === "subagent") return `${ev.agent} : ${ev.description}`;
  if (ev.type === "tool" && !["Agent", "Task", "subagent"].includes(ev.name)) return `${ev.subagent ? t("story.subagentPrefix") : ""}${ev.name} ${ev.summary}`;
  if (ev.type === "text" && !ev.subagent) return ev.text.split("\n")[0]?.slice(0, 160) ?? null;
  return null;
}

// Durée écoulée depuis une date, pour le bandeau d'action longue.
function elapsed(from: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(from)) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}
