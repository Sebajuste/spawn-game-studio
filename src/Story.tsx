// Une story (docs/ux-parcours.md §4 à §7). Onglet Avancement par défaut : ce qui attend l'utilisateur en tête
// (question, recette), une ligne « maintenant », puis les étapes. Les autres onglets (Conversation, Fichiers, Journal,
// Technique) gardent le détail, chacun selon son module.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Api, AgentEvent, ConversationEvent, ProgressStep, StoryDetail, StoryFiles, StoryStateDetail } from "./api.ts";
import { label, Refusal, useAction, type Action } from "./action.ts";
import { Conversation } from "./Conversation.tsx";
import { Files } from "./Files.tsx";
import { since, AGENT_NAMES, subtitle } from "./Game.tsx";

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
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
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
    ["progress", "Avancement", true],
    ["conversation", "Conversation", active.has("conversation")],
    ["files", "Fichiers", active.has("files")],
    ["log", "Journal", true],
    ["technical", "Technique", true],
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
              {act.pending === "rename" && <span className="muted small-text"> Renommage…</span>}
              <Refusal action={act} k="rename" />
            </form>
          ) : (
            <h1 onDoubleClick={() => setRename(detail.title)} title="Double-clic ou F2 pour renommer">
              {detail.title}
            </h1>
          )}
          <span className="muted">
            {subtitle(detail)}
            {detail.start && ` · commencée ${since(detail.start)}`}
            {detail.agent && ` · ${AGENT_NAMES[detail.agent]}`}
          </span>
          <span className="spacer" />
          {!closed && op?.kind === "turn" && (
            <button className="btn small" disabled={act.pending !== null} onClick={() => void conversationAction("pause", "stop")}>
              {label(act, "pause", "Pause", "Pause…")}
            </button>
          )}
          <Refusal action={act} k="pause" />
          {!closed &&
            (confirm ? (
              <>
                <span className="muted small-text">Jeter la branche et le travail de cette story ?</span>
                <button className="btn small danger" disabled={act.pending !== null} onClick={() => void action("abandon", "abandon").then((ok) => ok && onClosed())}>
                  {label(act, "abandon", "Abandonner", "Abandon…")}
                </button>
                <button className="btn small" disabled={act.pending !== null} onClick={() => setConfirm(false)}>
                  Non
                </button>
                <Refusal action={act} k="abandon" />
              </>
            ) : (
              <button className="btn small" disabled={act.pending !== null} onClick={() => setConfirm(true)}>
                Abandonner
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
                {op.kind === "merge" ? "Fusion en cours : intégration à develop, suite complète des tests" : "L'agent travaille…"} — {elapsed(op.since)}
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
          {detail.result === "abandoned" && <div className="banner grey">Story abandonnée {since(detail.updated)}.</div>}
          {detail.result === "accepted" && (
            <div className="banner green">
              Validée et livrée dans develop {since(detail.updated)}.{" "}
              <button className="btn small" onClick={() => setTab("files")}>
                Voir ce qui a changé
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
  if (ev.type === "tool" && !["Agent", "Task", "subagent"].includes(ev.name)) return `${ev.subagent ? "sous-agent · " : ""}${ev.name} ${ev.summary}`;
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
            <strong>Étape non reconnue : {unknown}</strong>
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
                {e.tasks.map((t) => (
                  <li key={t.number} className={t.state}>
                    {t.state === "done" ? "✓" : t.state === "parked" ? "⏸" : t.state === "current" ? "●" : "○"} {t.title}
                    {t.rounds > 0 && <span className="muted"> · {t.rounds} correction{t.rounds > 1 ? "s" : ""}</span>}
                    {t.state === "parked" && <span className="muted"> · mise de côté</span>}
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
  return parts.at(-1)?.slice(0, 200) ?? "l'agent n'a rien dit";
}

// Issue de la dernière fusion. Une fusion refusée n'est plus d'actualité une fois la story revenue en recette (l'agent
// a corrigé) ; une erreur reste dite tant qu'une nouvelle fusion ne l'efface pas.
function Outcome({ detail }: { detail: StoryDetail }) {
  const m = detail.lastMerge;
  if (!m) return null;
  if (m.verdict === "merged") return detail.group === "history" ? <div className="banner green">Livrée dans develop{m.commit ? ` (${m.commit.slice(0, 7)})` : ""}</div> : null;
  if (m.verdict === "refused") return detail.group === "acceptance" || detail.group === "history" ? null : <div className="banner orange">Fusion refusée : {m.cause ?? "cause inconnue"}. L'agent corrige, puis réinscrit ; rien à faire pour toi.</div>;
  return detail.group === "history" ? null : <div className="banner orange">Fusion en erreur : {m.cause ?? "cause inconnue"}</div>;
}

// Sans tour en cours, jamais de libellé d'activité : ce qui attend l'utilisateur, ou l'état de repos.
function Idle({ detail, act, onResume }: { detail: StoryDetail; act: Action; onResume: () => void }) {
  const w = detail.waiting;
  if (!w) return null;
  if (w.reason === "paused" || w.reason === "stopped") {
    return (
      <div className="banner grey">
        <span>{w.reason === "paused" ? "en pause" : `arrêtée : ${lastSentence(w.text)}`}</span>
        <button className="btn small primary" disabled={act.pending !== null} onClick={onResume}>
          {label(act, "resume", "Reprendre", "Reprise…")}
        </button>
        <Refusal action={act} k="resume" />
      </div>
    );
  }
  const what = w.reason === "spec-approval" ? "valider le cadrage" : w.reason === "interrupted" ? "reprendre après la coupure" : (w.text ?? "ta décision").split("\n")[0]?.slice(0, 160);
  return <div className="banner blue">à toi : {what}</div>;
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
      .catch((e: Error) => setSpec(`(cadrage illisible : ${e.message})`));
  }, [api, project, path]);
  return (
    <section className="card waiting">
      <h2>Valide le cadrage</h2>
      <p className="muted small-text">C'est la seule question de la story : ensuite, l'agent travaille seul jusqu'à la recette.</p>
      <div className="agent-text">{spec ?? "…"}</div>
      <div className="actions">
        <button className="btn green" disabled={act.pending !== null} onClick={() => void onApprove()}>
          {act.pending === "approve" ? "Validation…" : "✓ Valider le cadrage"}
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
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ou ce qu'il faut changer…" />
        <button type="submit" className="btn" disabled={!text.trim() || act.pending !== null}>
          {label(act, "changes", "Demander des changements", "Envoi…")}
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
        <h2>Coupée par un arrêt du PC ou de l'app</h2>
        <p>Le travail déjà fait est intact. La reprise automatique n'a pas abouti.</p>
        <button className="btn primary" disabled={act.pending !== null} onClick={onResume}>
          {label(act, "resume", "Reprendre", "Reprise…")}
        </button>
        <Refusal action={act} k="resume" />
      </section>
    );
  }
  return (
    <section className="card waiting">
      <h2>{w?.reason === "question" ? "Bloquée : ta décision" : "L'agent s'est arrêté"}</h2>
      {w?.text ? <div className="agent-text">{w.text}</div> : <p className="muted">Il n'a rien dit de plus : regarde l'onglet Conversation, ou dis-lui de continuer.</p>}
      <form
        className="reply"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void onAnswer(text.trim()).then((ok) => ok && setText(""));
        }}
      >
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={w?.reason === "question" ? "Ta réponse…" : "Ce qu'il doit faire, ou « continue »…"} autoFocus />
        <button type="submit" className="btn primary" disabled={!text.trim() || act.pending !== null}>
          {label(act, "answer", "Répondre", "Envoi…")}
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
    { name: "Compilation et scènes", state: p ? "verified" : "none", detail: p ? p.compilation : "non vérifié" },
    { name: "Tests", state: p ? "verified" : "none", detail: p ? `${p.tests} réussis` : "non vérifié" },
    { name: "Smoke test (le jeu se lance)", state: p ? "verified" : "none", detail: p ? p.launch : "non vérifié" },
    { name: "Test de bout en bout", state: p ? "verified" : "none", detail: p ? `${p.end_to_end} test(s) chargent la scène principale` : "non vérifié" },
    { name: "Relecture", state: detail.reviewed ? "agent" : "none", detail: detail.reviewed ? "approuvée par l'agent relecteur" : "pas de relecture approuvée" },
    { name: "Captures", state: "none", detail: media.length > 0 ? "non vérifiées : regarde-les toi-même" : "aucune capture" },
  ];
  return (
    <section className="card acceptance">
      {!p && <div className="banner orange">La vérification n'a pas été faite par l'outil : rien de ce qui suit n'est prouvé.</div>}
      <h2>Definition of Done</h2>
      <table className="table proof">
        <tbody>
          {points.map((x) => (
            <tr key={x.name}>
              <td className={`mark-${x.state}`}>{x.state === "verified" ? "✓" : x.state === "agent" ? "✓" : "?"}</td>
              <td>{x.name}</td>
              <td className="muted">
                {x.detail}
                {x.state === "verified" && p && <> · vérifié par l'outil {since(p.date)}</>}
                {x.state === "agent" && " · par un agent, pas par l'outil"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Compte rendu de l'agent</h2>
      <p className="muted small-text">Ce que l'agent dit avoir fait : une déclaration, pas une preuve.</p>
      <p>{report?.summary ?? "L'agent n'a pas laissé de compte rendu."}</p>
      {report?.how_to_check && (
        <>
          <h2>Comment le vérifier toi-même</h2>
          <p>{report.how_to_check}</p>
        </>
      )}
      {media.length > 0 && <h2>Captures (non vérifiées)</h2>}
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
          {files.files.length} fichier{files.files.length > 1 ? "s" : ""} touché{files.files.length > 1 ? "s" : ""} ·{" "}
          <button className="link" onClick={onShowFiles}>
            voir
          </button>
        </p>
      )}
      <div className="actions">
        <button className="btn" disabled={act.pending !== null} onClick={onLaunch}>
          ▶ Lancer cette version
        </button>
        <span className="spacer" />
        <Refusal action={act} k="accept" />
        <button className="btn green" disabled={act.pending !== null} onClick={() => void onAccept()}>
          {act.pending === "accept" ? "Validation…" : "✓ Valider"}
        </button>
      </div>
      <form
        className="reply"
        onSubmit={(e) => {
          e.preventDefault();
          if (message.trim()) void onRequestChanges(message.trim()).then((ok) => ok && setMessage(""));
        }}
      >
        <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ce qui ne va pas…" />
        <button type="submit" className="btn" disabled={!message.trim() || act.pending !== null}>
          {label(act, "changes", "Demander des changements", "Envoi…")}
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
          <h2>Refus du périmètre ({detail.refusals.length})</h2>
          {detail.refusals.map((r, i) => (
            <p key={i} className="small-text">
              <code>{r.target}</code> : {r.reason}
            </p>
          ))}
        </section>
      )}
      <section className="card">
        <h2>Journal ({detail.ledger.length})</h2>
        {detail.ledger.length === 0 ? <p className="muted">Aucun événement.</p> : <ol className="ledger">{detail.ledger.map((l, i) => <li key={i}>{l}</li>)}</ol>}
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
              <th>Fil</th>
              <td>
                {detail.story} · statut {detail.status}
              </td>
            </tr>
            <tr>
              <th>Branche</th>
              <td>{detail.branch}</td>
            </tr>
            <tr>
              <th>Worktree</th>
              <td>{detail.worktree ?? "supprimé"}</td>
            </tr>
            <tr>
              <th>Agent</th>
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
