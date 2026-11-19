// Le jeu ouvert (docs/ux-parcours.md §3 à §7) : en-tête avec « Lancer le jeu », « Que veux-tu ? » toujours en haut,
// barre latérale triée par ce qui concerne l'utilisateur (décision attendue, en recette, en cours, historique), et au
// centre le tableau du jeu, une story ou l'historique. Tout se recharge sur les événements du service.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DialogKind } from "./App.tsx";
import { label, Refusal, useAction } from "./action.ts";
import { Dialog } from "./Home.tsx";
import type { Api, AgentName, ProjectSettings, ProjectView, StoryGroup, StoryView } from "./api.ts";
import { Story } from "./Story.tsx";
import { getLang, t, type Key } from "./i18n.ts";

interface Props {
  api: Api;
  events: EventSource | null;
  project: ProjectView;
  active: ReadonlySet<string>;
  signal: { action: string; n: number };
  dialog: DialogKind;
  closeDialog: () => void;
  onError: (e: string | null) => void;
}

type Screen = { screen: "board" } | { screen: "story"; story: string } | { screen: "history" };

// Les valeurs sont lues à l'affichage (accesseurs) : le texte suit la langue sans changer la signature exportée.
export const AGENT_NAMES: Record<AgentName, string> = {
  "claude-code": "Claude Code",
  get opencode() {
    return t("project.agent.opencode");
  },
  copilot: "GitHub Copilot",
};

const GROUPS: { id: StoryGroup; title: () => string; dot: string }[] = [
  { id: "blocked", title: () => t("project.group.blocked"), dot: "orange" },
  { id: "acceptance", title: () => t("project.group.acceptance"), dot: "blue" },
  { id: "active", title: () => t("project.group.active"), dot: "green" },
];

// Étapes de `spawn next` (texte du kit, en français) → clé de message.
const STEP_KEYS: Record<string, Key> = {
  spec: "project.step.spec",
  "en attente de l'utilisateur": "project.step.waitingUser",
  plan: "project.step.plan",
  "plan illisible": "project.step.plan",
  "plan introuvable": "project.step.plan",
  "relecture finale": "project.step.finalReview",
  "preuve et captures": "project.step.proof",
  "compte rendu à juger": "project.step.reportToJudge",
  "à juger": "project.step.toJudge",
  "worktree à commiter": "project.step.toCommit",
  "relecture finale approuvée": "project.step.finalReviewApproved",
  "corrections de la relecture finale": "project.step.finalReviewFixes",
  "correction demandée": "project.step.fixRequested",
  fusion: "project.step.merge",
  "fusion en cours": "project.step.merge",
  "après fusion": "project.step.afterMerge",
};

// L'étape de `spawn next` dite en mots d'utilisateur, sans le vocabulaire du kit.
export function readableStep(step: string | null): string | null {
  if (step === null) return null;
  const task = /^tâche (\d+\/\d+) : (.+?), [^,]+$/.exec(step);
  if (task) return t("project.step.task", { progress: task[1], name: task[2] });
  if (step.startsWith("fusion refusée")) return t("project.step.mergeRefused");
  const key = STEP_KEYS[step];
  return key ? t(key) : step;
}

export function subtitle(f: StoryView): string {
  if (f.group === "history") return t(f.result === "accepted" ? "project.sub.delivered" : f.result === "abandoned" ? "project.sub.abandoned" : "project.sub.closed", { since: since(f.updated) });
  if (f.group === "acceptance") return t("project.sub.acceptance", { since: since(f.updated) });
  if (f.waiting?.reason === "spec-approval") return t("project.sub.specApproval");
  if (f.waiting?.reason === "question") return t("project.sub.question");
  if (f.waiting?.reason === "interrupted") return t("project.sub.interrupted");
  if (f.waiting?.reason === "paused") return t("project.sub.paused");
  if (f.waiting?.reason === "stopped") return t("project.sub.stopped");
  return readableStep(f.step) ?? t(f.running ? "project.sub.running" : "project.sub.waiting");
}

export function since(date: string | null): string {
  if (!date) return "";
  const s = Math.max(0, (Date.now() - Date.parse(date)) / 1000);
  if (s < 60) return t("project.since.now");
  if (s < 3600) return t("project.since.min", { n: Math.round(s / 60) });
  if (s < 86400) return t("project.since.hours", { n: Math.round(s / 3600) });
  return t("project.since.on", { date: new Date(date).toLocaleDateString(getLang() === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "short" }) });
}

export function Project({ api, events, project, active, signal, dialog, closeDialog, onError }: Props) {
  const [stories, setStories] = useState<StoryView[] | null>(null);
  const [view, setView] = useState<Screen>({ screen: "board" });
  const [request, setRequest] = useState("");
  const act = useAction();
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [oneOffAgent, setOneOffAgent] = useState<AgentName | "">("");
  const [info, setInfo] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const base = `/api/projects/${project.id}`;
  const available = active.has("backlog");

  const load = useCallback(async () => {
    if (!available) return;
    try {
      setStories(await api.call<StoryView[]>("GET", `${base}/backlog`));
    } catch (e) {
      onError((e as Error).message);
    }
  }, [api, base, available, onError]);

  useEffect(() => {
    void load();
    if (available) void api.call<ProjectSettings>("GET", `${base}/settings`).then(setSettings).catch(() => setSettings(null));
  }, [load, api, base, available]);

  useEffect(() => {
    if (!events) return;
    const forMe = (e: Event) => {
      const d = JSON.parse((e as MessageEvent<string>).data) as { project?: string };
      if (d.project === project.id) void load();
    };
    for (const t of ["stories", "conversation-end", "backlog"]) events.addEventListener(t, forMe);
    return () => {
      for (const t of ["stories", "conversation-end", "backlog"]) events.removeEventListener(t, forMe);
    };
  }, [events, project.id, load]);

  // La durée « il y a … » vieillit sans événement.
  const [, setClock] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClock((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const launch = useCallback(
    async (story?: string) => {
      try {
        await api.call("POST", `${base}/launch`, story ? { story } : {});
        setInfo(story ? t("project.info.storyLaunched") : t("project.info.projectLaunched"));
      } catch (e) {
        onError((e as Error).message);
      }
    },
    [api, base, onError],
  );

  // Menus et raccourcis.
  const lastSignal = useRef(signal.n);
  useEffect(() => {
    if (signal.n === lastSignal.current) return;
    lastSignal.current = signal.n;
    if (signal.action === "request") {
      setView({ screen: "board" });
      setTimeout(() => field.current?.focus(), 0);
    } else if (signal.action === "launch") void launch(view.screen === "story" ? view.story : undefined);
    else if (signal.action === "history") setView({ screen: "history" });
    else if (signal.action === "folder") void api.call("POST", `${base}/open`, { access: "." }).catch((e: Error) => onError(e.message));
  }, [signal, launch, view, api, base, onError]);

  const send = async () => {
    const text = request.trim();
    if (!text) return;
    let story = "";
    const ok = await act.run("request", async () => {
      story = (await api.call<{ story: string }>("POST", `${base}/backlog`, { request: text, ...(oneOffAgent ? { agent: oneOffAgent } : {}) })).story;
      await load();
    });
    if (!ok) return;
    setRequest("");
    setOneOffAgent("");
    setView({ screen: "story", story });
  };

  const byGroup = useMemo(() => {
    const m = new Map<StoryGroup, StoryView[]>();
    for (const f of stories ?? []) m.set(f.group, [...(m.get(f.group) ?? []), f]);
    return m;
  }, [stories]);
  const history = byGroup.get("history") ?? [];
  const selected = view.screen === "story" ? view.story : null;

  const Item = ({ f, dot }: { f: StoryView; dot: string }) => (
    <button className={`item ${selected === f.story ? "selected" : ""}`} onClick={() => setView({ screen: "story", story: f.story })} title={f.request ?? f.title}>
      <span className={`dot ${dot} ${f.running ? "pulsing" : ""}`} />
      <span className="item-text">
        {f.title}
        <small>{subtitle(f)}</small>
      </span>
    </button>
  );

  if (!available) {
    return (
      <main className="empty">{t("project.off")}</main>
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <button className={`item game-home ${view.screen === "board" ? "selected" : ""}`} onClick={() => setView({ screen: "board" })}>
          <span className="item-text">
            <strong>{project.name}</strong>
            <small>{project.engine ? `${project.engine} ${project.version ?? ""}` : (project.problem ?? "")}</small>
          </span>
        </button>
        {GROUPS.map(({ id, title, dot }) => {
          const list = byGroup.get(id) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={id}>
              <h3>{title()}</h3>
              {list.map((f) => (
                <Item key={f.story} f={f} dot={dot} />
              ))}
            </section>
          );
        })}
        {history.length > 0 && (
          <section>
            <h3 className="clickable" onClick={() => setView({ screen: "history" })}>
              {t("project.group.history")} <span>›</span>
            </h3>
            {history.slice(0, 3).map((f) => (
              <Item key={f.story} f={f} dot="grey" />
            ))}
          </section>
        )}
      </aside>

      <div className="main-pane">
        <header className="game-header">
          <strong>{project.name}</strong>
          <span className="muted">{project.root}</span>
          <span className="spacer" />
          {info && (
            <span className="muted" onClick={() => setInfo(null)}>
              {info}
            </span>
          )}
          <button className="btn" onClick={() => void launch()} title={t("project.launch.title")}>
            {t("project.launch.button")}
          </button>
        </header>
        <form
          className="request"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={field}
            rows={1}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={t("project.request.placeholder")}
          />
          <button type="submit" className="btn primary" disabled={!request.trim() || act.pending !== null}>
            {label(act, "request", t("project.request.send"), t("project.request.sending"))}
          </button>
          <Refusal action={act} k="request" />
        </form>

        {view.screen === "story" ? (
          <Story key={view.story} api={api} events={events} project={project.id} story={view.story} active={active} onLaunch={() => void launch(view.story)} onError={onError} onClosed={() => setView({ screen: "board" })} />
        ) : view.screen === "history" ? (
          <History stories={history} onPick={(story) => setView({ screen: "story", story })} />
        ) : (
          <Board
            stories={stories}
            byGroup={byGroup}
            settings={settings}
            oneOffAgent={oneOffAgent}
            onAgent={setOneOffAgent}
            onPick={(story) => setView({ screen: "story", story })}
            onRequest={() => field.current?.focus()}
          />
        )}
      </div>

      {dialog === "goto" && <GoTo stories={stories ?? []} onClose={closeDialog} onPick={(story) => (setView({ screen: "story", story }), closeDialog())} />}
      {dialog === "settings" && settings && (
        <SettingsDialog
          settings={settings}
          name={project.name}
          onClose={closeDialog}
          onSave={async (r) => {
            try {
              setSettings(await api.call<ProjectSettings>("PUT", `${base}/settings`, r));
              closeDialog();
            } catch (e) {
              onError((e as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}

// Le titre en gras à la place du marqueur \u0000 du message : l'ordre des mots dépend de la langue.
function Bold({ text, title }: { text: string; title: string }) {
  const [before, after = ""] = text.split("\u0000");
  return (
    <>
      {before}
      <strong>{title}</strong>
      {after}
    </>
  );
}

function Board({
  stories,
  byGroup,
  settings,
  oneOffAgent,
  onAgent,
  onPick,
  onRequest,
}: {
  stories: StoryView[] | null;
  byGroup: Map<StoryGroup, StoryView[]>;
  settings: ProjectSettings | null;
  oneOffAgent: AgentName | "";
  onAgent: (a: AgentName | "") => void;
  onPick: (story: string) => void;
  onRequest: () => void;
}) {
  const blocked = byGroup.get("blocked") ?? [];
  const acceptance = byGroup.get("acceptance") ?? [];
  const running = byGroup.get("active") ?? [];
  if (stories === null) return <div className="scroll" />;
  return (
    <div className="scroll">
      {blocked.map((f) => (
        <div key={f.story} className="banner orange">
          <span>
            <Bold text={t("project.board.blocked", { title: "\u0000", interrupted: f.waiting?.reason === "interrupted" ? t("project.board.interrupted") : "" })} title={f.title} />
          </span>
          <button className="btn small" onClick={() => onPick(f.story)}>
            {t("project.board.decide")}
          </button>
        </div>
      ))}
      {acceptance.map((f) => (
        <div key={f.story} className="banner blue">
          <span>
            <Bold text={t("project.board.acceptance", { title: "\u0000" })} title={f.title} />
          </span>
          <button className="btn small" onClick={() => onPick(f.story)}>
            {t("project.board.review")}
          </button>
        </div>
      ))}
      {running.length > 0 && (
        <section className="card">
          <h2>{t("project.board.active")}</h2>
          {running.map((f) => (
            <button key={f.story} className="item" onClick={() => onPick(f.story)}>
              <span className={`dot green ${f.running ? "pulsing" : ""}`} />
              <span className="item-text">
                {f.title}
                <small>
                  {subtitle(f)} · {since(f.start)}
                </small>
              </span>
            </button>
          ))}
        </section>
      )}
      {stories.length === 0 && (
        <section className="card prompt" onClick={onRequest}>
          <h2>{t("project.board.promptTitle")}</h2>
          <p>{t("project.board.promptBody")}</p>
        </section>
      )}
      {stories.length > 0 && blocked.length + acceptance.length + running.length === 0 && <p className="muted">{t("project.board.idle")}</p>}
      <details className="card">
        <summary>{t("project.board.advanced")}</summary>
        <label className="field">
          <span>{t("project.board.agent")}</span>
          <select value={oneOffAgent} onChange={(e) => onAgent(e.target.value as AgentName | "")}>
            <option value="">{settings ? `${AGENT_NAMES[settings.agent]} ${t("project.board.projectSetting")}` : t("project.board.projectSettingOnly")}</option>
            {(Object.keys(AGENT_NAMES) as AgentName[])
              .filter((a) => a !== settings?.agent)
              .map((a) => (
                <option key={a} value={a}>
                  {t("project.board.forThisFeature", { agent: AGENT_NAMES[a] })}
                </option>
              ))}
          </select>
        </label>
      </details>
    </div>
  );
}

function History({ stories, onPick }: { stories: StoryView[]; onPick: (story: string) => void }) {
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();
  const list = stories.filter((x) => !f || `${x.title} ${x.request ?? ""} ${x.story}`.toLowerCase().includes(f));
  return (
    <div className="scroll">
      <section className="card">
        <h2>{t("project.history.title")}</h2>
        <input className="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("project.history.search")} autoFocus />
        {list.length === 0 ? (
          <p className="muted">{stories.length === 0 ? t("project.history.none") : t("project.history.noMatch")}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t("project.history.colStory")}</th>
                <th>{t("project.history.colRequest")}</th>
                <th>{t("project.history.colEnd")}</th>
                <th>{t("project.history.colResult")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.story} className="clickable" onClick={() => onPick(x.story)}>
                  <td>{x.title}</td>
                  <td className="muted">{x.request ? `« ${x.request.length > 70 ? `${x.request.slice(0, 70)}…` : x.request} »` : "—"}</td>
                  <td>{since(x.updated)}</td>
                  <td className={x.result === "accepted" ? "ok" : "muted"}>{t(x.result === "accepted" ? "project.history.delivered" : x.result === "abandoned" ? "project.history.abandoned" : "project.history.closed")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function GoTo({ stories, onClose, onPick }: { stories: StoryView[]; onClose: () => void; onPick: (story: string) => void }) {
  const [text, setText] = useState("");
  const [rank, setRank] = useState(0);
  const q = text.trim().toLowerCase();
  const list = stories.filter((f) => !q || `${f.title} ${f.request ?? ""} ${f.story}`.toLowerCase().includes(q)).slice(0, 12);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette">
        <input
          autoFocus
          value={text}
          placeholder={t("project.goto.placeholder")}
          onChange={(e) => {
            setText(e.target.value);
            setRank(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setRank((r) => Math.min(r + 1, list.length - 1));
            else if (e.key === "ArrowUp") setRank((r) => Math.max(r - 1, 0));
            else if (e.key === "Enter" && list[rank]) onPick(list[rank].story);
            else return;
            e.preventDefault();
          }}
        />
        {list.length === 0 && <div className="muted">{t("project.goto.none")}</div>}
        {list.map((f, i) => (
          <div key={f.story} className={i === rank ? "selected" : ""} onMouseEnter={() => setRank(i)} onClick={() => onPick(f.story)}>
            <span>{f.title}</span>
            <span className="muted">{subtitle(f)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsDialog({ settings, name, onClose, onSave }: { settings: ProjectSettings; name: string; onClose: () => void; onSave: (r: ProjectSettings) => void }) {
  const [agent, setAgent] = useState<AgentName>(settings.agent);
  const [model, setModel] = useState(settings.localModel);
  const [context, setContext] = useState(String(settings.localContext));
  const value = Number(context.replace(/[s_]/g, ""));
  const valid = Number.isInteger(value) && value >= 8000 && value <= 1_000_000 && /^(lmstudio|ollama)\/\S+$/.test(model.trim());
  return (
    <Dialog title={t("project.settings.title", { name })} onClose={onClose}>
      <label className="field">
        <span>{t("project.settings.agent")}</span>
        <select value={agent} onChange={(e) => setAgent(e.target.value as AgentName)}>
          {(Object.keys(AGENT_NAMES) as AgentName[]).map((a) => (
            <option key={a} value={a}>
              {AGENT_NAMES[a]}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small-text">{t("project.settings.agentNote")}</p>
      <label className="field">
        <span>{t("project.settings.model")}</span>
        <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
      </label>
      <p className="muted small-text">{t("project.settings.modelNote")}</p>
      <label className="field">
        <span>{t("project.settings.context")}</span>
        <input value={context} onChange={(e) => setContext(e.target.value)} inputMode="numeric" />
      </label>
      <p className="muted small-text">{t("project.settings.contextNote")}</p>
      <div className="actions end">
        <button className="btn" onClick={onClose}>
          {t("project.settings.cancel")}
        </button>
        <button className="btn primary" disabled={!valid} onClick={() => onSave({ agent, localModel: model.trim(), localContext: value })}>
          {t("project.settings.save")}
        </button>
      </div>
    </Dialog>
  );
}
