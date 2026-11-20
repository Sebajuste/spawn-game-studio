// Une story (docs/ux-parcours.md §4 à §7). Onglet Avancement par défaut : ce qui attend l'utilisateur en tête
// (question, recette), une ligne « maintenant », puis les étapes. Les autres onglets (Conversation, Fichiers, Journal,
// Technique) gardent le détail, chacun selon son module.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Api, AgentEvent, ConversationEvent, ProgressStep, StoryDetail, StoryFiles, StoryStateDetail } from "../shared/api.ts";
import { label, Refusal, useAction, type Action } from "../shared/action.ts";
import { Conversation } from "./conversation/Conversation.tsx";
import { Files } from "./files/Files.tsx";
import { since } from "../shared/time.ts";
import { AGENT_NAMES } from "../project/agents.ts";
import { subtitle } from "../project/storyText.ts";
import { t } from "../i18n/i18n.ts";

interface Props {
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

export function Story({ api, events, project, story, active, onLaunch, onError, onClosed }: Props) {
  const [detail, setDetail] = useState<StoryDetail | null>(null);
  const [tab, setTab] = useState<Tab>("progress");
  const [now, setNow] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
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
          {!closed &&
            (confirm ? (
              <>
                <span className="muted small-text">{t("story.abandonConfirm")}</span>
                <button className="btn small danger" disabled={act.pending !== null} onClick={() => void action("abandon", "abandon").then((ok) => ok && onClosed())}>
                  {label(act, "abandon", t("story.abandon"), t("story.abandoning"))}
                </button>
                <button className="btn small" disabled={act.pending !== null} onClick={() => setConfirm(false)}>
                  {t("story.no")}
                </button>
                <Refusal action={act} k="abandon" />
              </>
            ) : (
              <button className="btn small" disabled={act.pending !== null} onClick={() => setConfirm(true)}>
                {t("story.abandon")}
              </button>
            ))}
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

const ICONS: Record<ProgressStep["state"], string> = { done: "✓", current: "…", pending: "" };

// Étape rendue par l'outil que l'app ne connaît pas : dite telle quelle, à la place de l'étape en cours (après la
// dernière étape faite) ; l'app ne devine jamais une étape.
function Steps({ steps, unknown }: { steps: ProgressStep[]; unknown: string | null }) {
  const firstPending = steps.findIndex((e) => e.state !== "done");
  const at = firstPending === -1 ? steps.length : firstPending;
  const rows: (ProgressStep | "unknown")[] = unknown ? [...steps.slice(0, at), "unknown", ...steps.slice(at)] : steps;
  return (
    <ol className="steps">
      {rows.map((e) =>
        e === "unknown" ? (
          <li key="unknown" className="current">
            <span className="icon current">…</span>
            <strong>{t("story.unknownStep", { step: unknown ?? "" })}</strong>
            <span />
          </li>
        ) : (
        <li key={e.id} className={e.state}>
          <span className={`icon ${e.state}`}>{e.id === "tasks" && e.state === "current" && e.detail ? e.detail.split("/")[0] : ICONS[e.state]}</span>
          <span>
            <strong>{e.title}</strong>
            {e.detail && <span className="muted"> · {e.detail}</span>}
            {e.tasks && e.tasks.length > 0 && (
              <ul className="tasks">
                {e.tasks.map((task) => (
                  <li key={task.number} className={task.state}>
                    {task.state === "done" ? "✓" : task.state === "parked" ? "⏸" : task.state === "current" ? "●" : "○"} {task.title}
                    {task.rounds > 0 && <span className="muted">{t(task.rounds > 1 ? "story.corrections.other" : "story.corrections.one", { count: task.rounds })}</span>}
                    {task.state === "parked" && <span className="muted">{t("story.parked")}</span>}
                  </li>
                ))}
              </ul>
            )}
          </span>
          <span className="muted small-text">{duration(e.start, e.end)}</span>
        </li>
        ),
      )}
    </ol>
  );
}

// Durée écoulée depuis une date, pour le bandeau d'action longue.
function elapsed(from: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(from)) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}

// Dernière phrase du dernier message de l'agent : ce qu'il a dit avant de s'arrêter.
function lastSentence(text: string | null): string {
  const parts = (text ?? "").trim().split(/(?<=[.!?…])\s+|\n+/).filter(Boolean);
  return parts.at(-1)?.slice(0, 200) ?? t("story.noSaid");
}

// Issue de la dernière fusion. Une fusion refusée n'est plus d'actualité une fois la story revenue en recette (l'agent
// a corrigé) ; une erreur reste dite tant qu'une nouvelle fusion ne l'efface pas.
function Outcome({ detail }: { detail: StoryDetail }) {
  const m = detail.lastMerge;
  if (!m) return null;
  if (m.verdict === "merged") return detail.group === "history" ? <div className="banner green">{t("story.delivered")}{m.commit ? ` (${m.commit.slice(0, 7)})` : ""}</div> : null;
  if (m.verdict === "refused") return detail.group === "acceptance" || detail.group === "history" ? null : <div className="banner orange">{t("story.mergeRefused", { cause: m.cause ?? t("story.unknownCause") })}</div>;
  return detail.group === "history" ? null : <div className="banner orange">{t("story.mergeError", { cause: m.cause ?? t("story.unknownCause") })}</div>;
}

// Sans tour en cours, jamais de libellé d'activité : ce qui attend l'utilisateur, ou l'état de repos.
function Idle({ detail, act, onResume }: { detail: StoryDetail; act: Action; onResume: () => void }) {
  const w = detail.waiting;
  if (!w) return null;
  if (w.reason === "paused" || w.reason === "stopped") {
    return (
      <div className="banner grey">
        <span>{w.reason === "paused" ? t("story.idle.paused") : t("story.idle.stopped", { text: lastSentence(w.text) })}</span>
        <button className="btn small primary" disabled={act.pending !== null} onClick={onResume}>
          {label(act, "resume", t("story.resume"), t("story.resuming"))}
        </button>
        <Refusal action={act} k="resume" />
      </div>
    );
  }
  const what = w.reason === "spec-approval" ? t("story.idle.specApproval") : w.reason === "interrupted" ? t("story.idle.interrupted") : (w.text ?? t("story.idle.decision")).split("\n")[0]?.slice(0, 160) ?? "";
  return <div className="banner blue">{t("story.idle.yourTurn", { what })}</div>;
}

function duration(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  const s = (Date.parse(end) - Date.parse(start)) / 1000;
  if (s < 60) return `${Math.max(1, Math.round(s))} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

// La seule question de la story : la spec proposée, à valider telle quelle ou à faire corriger.
function ApproveSpec({ api, project, detail, act, onApprove, onAnswer }: { api: Api; project: string; detail: StoryDetail; act: Action; onApprove: () => Promise<boolean>; onAnswer: (m: string) => Promise<boolean> }) {
  const [spec, setSpec] = useState<string | null>(null);
  const [text, setText] = useState("");
  const path = detail.waiting?.spec ?? null;
  useEffect(() => {
    if (!path) return;
    api
      .text(project, path)
      .then(setSpec)
      .catch((e: Error) => setSpec(t("story.spec.unreadable", { message: e.message })));
  }, [api, project, path]);
  return (
    <section className="card waiting">
      <h2>{t("story.spec.title")}</h2>
      <p className="muted small-text">{t("story.spec.only")}</p>
      <div className="agent-text">{spec ?? "…"}</div>
      <div className="actions">
        <button className="btn green" disabled={act.pending !== null} onClick={() => void onApprove()}>
          {act.pending === "approve" ? t("story.approving") : t("story.spec.approve")}
        </button>
        <Refusal action={act} k="approve" />
      </div>
      <form
        className="reply"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void onAnswer(text.trim()).then((ok) => ok && setText(""));
        }}
      >
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("story.spec.placeholder")} />
        <button type="submit" className="btn" disabled={!text.trim() || act.pending !== null}>
          {label(act, "changes", t("story.requestChanges"), t("story.sending"))}
        </button>
        <Refusal action={act} k="changes" />
      </form>
    </section>
  );
}

function Answer({ detail, act, onAnswer, onResume }: { detail: StoryDetail; act: Action; onAnswer: (m: string) => Promise<boolean>; onResume: () => void }) {
  const [text, setText] = useState("");
  const w = detail.waiting;
  if (w?.reason === "interrupted") {
    return (
      <section className="card waiting">
        <h2>{t("story.interrupted.title")}</h2>
        <p>{t("story.interrupted.body")}</p>
        <button className="btn primary" disabled={act.pending !== null} onClick={onResume}>
          {label(act, "resume", t("story.resume"), t("story.resuming"))}
        </button>
        <Refusal action={act} k="resume" />
      </section>
    );
  }
  return (
    <section className="card waiting">
      <h2>{w?.reason === "question" ? t("story.blocked.question") : t("story.blocked.stopped")}</h2>
      {w?.text ? <div className="agent-text">{w.text}</div> : <p className="muted">{t("story.blocked.nothing")}</p>}
      <form
        className="reply"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void onAnswer(text.trim()).then((ok) => ok && setText(""));
        }}
      >
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={w?.reason === "question" ? t("story.answer.question") : t("story.answer.other")} autoFocus />
        <button type="submit" className="btn primary" disabled={!text.trim() || act.pending !== null}>
          {label(act, "answer", t("story.answer"), t("story.sending"))}
        </button>
        <Refusal action={act} k="answer" />
      </form>
    </section>
  );
}

function Acceptance({
  api,
  project,
  story,
  detail,
  act,
  onLaunch,
  onAccept,
  onRequestChanges,
  onShowFiles,
}: {
  api: Api;
  project: string;
  story: string;
  detail: StoryDetail;
  act: Action;
  onLaunch: () => void;
  onAccept: () => Promise<boolean>;
  onRequestChanges: (m: string) => Promise<boolean>;
  onShowFiles: () => void;
}) {
  const [files, setFiles] = useState<StoryFiles | null>(null);
  const [message, setMessage] = useState("");
  const [large, setLarge] = useState<string | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    api
      .call<StoryFiles>("GET", `/api/projects/${project}/stories/${story}/files`)
      .then(setFiles)
      .catch(() => setFiles(null));
  }, [api, project, story]);
  const report = detail.acceptanceReport;
  const media = files?.captures ?? [];
  const p = detail.proof;
  // Definition of Done : chaque point avec sa source. Seul ce que l'outil a fait est « vérifié » (§0) ; la relecture
  // est le verdict d'un agent relecteur exigé par l'outil ; les captures ne sont regardées par personne avant toi.
  const points: { name: string; state: "verified" | "agent" | "none"; detail: string }[] = [
    { name: t("story.dod.compilation"), state: p ? "verified" : "none", detail: p ? p.compilation : t("story.dod.unverified") },
    { name: t("story.dod.tests"), state: p ? "verified" : "none", detail: p ? t("story.dod.passed", { tests: p.tests }) : t("story.dod.unverified") },
    { name: t("story.dod.smoke"), state: p ? "verified" : "none", detail: p ? p.launch : t("story.dod.unverified") },
    { name: t("story.dod.e2e"), state: p ? "verified" : "none", detail: p ? t("story.dod.e2eDetail", { count: p.end_to_end }) : t("story.dod.unverified") },
    { name: t("story.dod.review"), state: detail.reviewed ? "agent" : "none", detail: detail.reviewed ? t("story.dod.reviewApproved") : t("story.dod.reviewNone") },
    { name: t("story.dod.captures"), state: "none", detail: media.length > 0 ? t("story.dod.capturesUnverified") : t("story.dod.capturesNone") },
  ];
  return (
    <section className="card acceptance">
      {!p && <div className="banner orange">{t("story.dod.notDone")}</div>}
      <h2>{t("story.dod.title")}</h2>
      <table className="table proof">
        <tbody>
          {points.map((x) => (
            <tr key={x.name}>
              <td className={`mark-${x.state}`}>{x.state === "verified" ? "✓" : x.state === "agent" ? "✓" : "?"}</td>
              <td>{x.name}</td>
              <td className="muted">
                {x.detail}
                {x.state === "verified" && p && t("story.dod.verifiedBy", { since: since(p.date) })}
                {x.state === "agent" && t("story.dod.byAgent")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{t("story.report.title")}</h2>
      <p className="muted small-text">{t("story.report.note")}</p>
      <p>{report?.summary ?? t("story.report.none")}</p>
      {report?.how_to_check && (
        <>
          <h2>{t("story.howToCheck")}</h2>
          <p>{report.how_to_check}</p>
        </>
      )}
      {media.length > 0 && <h2>{t("story.capturesTitle")}</h2>}
      {media.length > 0 && (
        <div className="media-grid">
          {media.map((m) => (
            <button key={m.access} className="media" onClick={() => setLarge(large === m.access ? null : m.access)} title={m.name}>
              {m.preview === "image" ? <img src={api.fileUrl(project, m.access)} alt={m.name} /> : <video src={api.fileUrl(project, m.access)} controls muted />}
            </button>
          ))}
        </div>
      )}
      {large && (
        <div className="media-large" onClick={() => setLarge(null)}>
          <img src={api.fileUrl(project, large)} alt="" />
        </div>
      )}
      {files && (
        <p className="muted small-text">
          {t(files.files.length > 1 ? "story.files.other" : "story.files.one", { count: files.files.length })}
          <button className="link" onClick={onShowFiles}>
            {t("story.view")}
          </button>
        </p>
      )}
      <div className="actions">
        <button className="btn" disabled={act.pending !== null} onClick={onLaunch}>
          {t("story.launch")}
        </button>
        <span className="spacer" />
        <Refusal action={act} k="accept" />
        <button className="btn green" disabled={act.pending !== null} onClick={() => void onAccept()}>
          {act.pending === "accept" ? t("story.accepting") : t("story.accept")}
        </button>
      </div>
      <form
        className="reply"
        onSubmit={(e) => {
          e.preventDefault();
          if (message.trim()) void onRequestChanges(message.trim()).then((ok) => ok && setMessage(""));
        }}
      >
        <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("story.changes.placeholder")} />
        <button type="submit" className="btn" disabled={!message.trim() || act.pending !== null}>
          {label(act, "changes", t("story.requestChanges"), t("story.sending"))}
        </button>
        <Refusal action={act} k="changes" />
      </form>
    </section>
  );
}

function Log({ api, project, story }: { api: Api; project: string; story: string }) {
  const [detail, setDetail] = useState<StoryStateDetail | null>(null);
  useEffect(() => {
    api
      .call<StoryStateDetail>("GET", `/api/projects/${project}/stories/${story}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [api, project, story]);
  if (!detail) return <div className="scroll" />;
  return (
    <div className="scroll">
      {detail.refusals.length > 0 && (
        <section className="card">
          <h2>{t("story.refusals", { count: detail.refusals.length })}</h2>
          {detail.refusals.map((r, i) => (
            <p key={i} className="small-text">
              <code>{r.target}</code> : {r.reason}
            </p>
          ))}
        </section>
      )}
      <section className="card">
        <h2>{t("story.log", { count: detail.ledger.length })}</h2>
        {detail.ledger.length === 0 ? <p className="muted">{t("story.noEvents")}</p> : <ol className="ledger">{detail.ledger.map((l, i) => <li key={i}>{l}</li>)}</ol>}
      </section>
    </div>
  );
}

function Technical({ api, project, story, detail }: { api: Api; project: string; story: string; detail: StoryDetail }) {
  const [next, setNext] = useState<StoryStateDetail["next"]>(null);
  useEffect(() => {
    api
      .call<StoryStateDetail>("GET", `/api/projects/${project}/stories/${story}`)
      .then((d) => setNext(d.next))
      .catch(() => setNext(null));
  }, [api, project, story]);
  return (
    <div className="scroll">
      <section className="card">
        <table className="table">
          <tbody>
            <tr>
              <th>{t("story.tech.thread")}</th>
              <td>{t("story.tech.status", { story: detail.story, status: detail.status })}</td>
            </tr>
            <tr>
              <th>{t("story.tech.branch")}</th>
              <td>{detail.branch}</td>
            </tr>
            <tr>
              <th>Worktree</th>
              <td>{detail.worktree ?? t("story.tech.deleted")}</td>
            </tr>
            <tr>
              <th>{t("story.tech.agent")}</th>
              <td>{detail.agent ? AGENT_NAMES[detail.agent] : "—"}</td>
            </tr>
            {next && (
              <tr>
                <th>spawn next</th>
                <td>
                  <strong>{next.step}</strong> : {next.instruction}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
