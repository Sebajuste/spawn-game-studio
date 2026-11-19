// Le jeu ouvert (docs/ux-parcours.md §3 à §7) : en-tête avec « Lancer le jeu », « Que veux-tu ? » toujours en haut,
// barre latérale triée par ce qui concerne l'utilisateur (décision attendue, en recette, en cours, historique), et au
// centre le tableau du jeu, une story ou l'historique. Tout se recharge sur les événements du service.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DialogKind } from "./App.tsx";
import { label, Refusal, useAction } from "./action.ts";
import { Dialog } from "./Home.tsx";
import type { Api, AgentName, ProjectSettings, ProjectView, StoryGroup, StoryView } from "./api.ts";
import { Story } from "./Story.tsx";

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

export const AGENT_NAMES: Record<AgentName, string> = { "claude-code": "Claude Code", opencode: "OpenCode · modèle local" };

const GROUPS: { id: StoryGroup; title: string; dot: string }[] = [
  { id: "blocked", title: "Bloquée : ta décision", dot: "orange" },
  { id: "acceptance", title: "En recette", dot: "blue" },
  { id: "active", title: "En cours", dot: "green" },
];

// L'étape de `spawn next` dite en mots d'utilisateur, sans le vocabulaire du kit.
export function readableStep(step: string | null): string | null {
  if (step === null) return null;
  const task = /^tâche (\d+\/\d+) : (.+?), [^,]+$/.exec(step);
  if (task) return `tâche ${task[1]} : ${task[2]}`;
  if (step.startsWith("fusion refusée")) return "corrige un refus de fusion";
  const words: Record<string, string> = {
    spec: "cadre la feature",
    "en attente de l'utilisateur": "bloquée : ta décision",
    plan: "découpe en tâches",
    "plan illisible": "découpe en tâches",
    "plan introuvable": "découpe en tâches",
    "relecture finale": "relit l'ensemble",
    "preuve et captures": "tests et captures",
    "compte rendu à juger": "prépare la recette",
    "à juger": "en recette",
    "worktree à commiter": "commite ses fichiers",
    "relecture finale approuvée": "relecture finale approuvée",
    "corrections de la relecture finale": "corrige la relecture finale",
    "correction demandée": "corrige ce que tu as redemandé",
    fusion: "fusion dans develop",
    "fusion en cours": "fusion dans develop",
    "après fusion": "range après la fusion",
  };
  return words[step] ?? step;
}

export function subtitle(f: StoryView): string {
  if (f.group === "history") return f.result === "accepted" ? `livrée ${since(f.updated)}` : f.result === "abandoned" ? `abandonnée ${since(f.updated)}` : `fermée ${since(f.updated)}`;
  if (f.group === "acceptance") return `en recette ${since(f.updated)}`;
  if (f.waiting?.reason === "spec-approval") return "cadrage à valider";
  if (f.waiting?.reason === "question") return "ta décision";
  if (f.waiting?.reason === "interrupted") return "coupée : à reprendre";
  if (f.waiting?.reason === "paused") return "en pause";
  if (f.waiting?.reason === "stopped") return "arrêtée";
  return readableStep(f.step) ?? (f.running ? "en cours" : "en attente");
}

export function since(date: string | null): string {
  if (!date) return "";
  const s = Math.max(0, (Date.now() - Date.parse(date)) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `le ${new Date(date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
}

export function Game({ api, events, project, active, signal, dialog, closeDialog, onError }: Props) {
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
        setInfo(story ? "Version de la story lancée." : "Jeu lancé (develop).");
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
      <main className="empty">
        Le module Stories est éteint : le rallumer dans Affichage.
      </main>
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
              <h3>{title}</h3>
              {list.map((f) => (
                <Item key={f.story} f={f} dot={dot} />
              ))}
            </section>
          );
        })}
        {history.length > 0 && (
          <section>
            <h3 className="clickable" onClick={() => setView({ screen: "history" })}>
              Livrées et abandonnées <span>›</span>
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
          <button className="btn" onClick={() => void launch()} title="Lancer develop (F5)">
            ▶ Lancer le jeu
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
            placeholder="Nouvelle feature : que veux-tu dans ce jeu ?  (Entrée pour envoyer · Maj+Entrée pour aller à la ligne)"
          />
          <button type="submit" className="btn primary" disabled={!request.trim() || act.pending !== null}>
            {label(act, "request", "Envoyer", "Création…")}
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
            <strong>{f.title}</strong> est bloquée : ta décision{f.waiting?.reason === "interrupted" ? " (coupée par un arrêt)" : ""}.
          </span>
          <button className="btn small" onClick={() => onPick(f.story)}>
            Décider
          </button>
        </div>
      ))}
      {acceptance.map((f) => (
        <div key={f.story} className="banner blue">
          <span>
            <strong>{f.title}</strong> est en recette.
          </span>
          <button className="btn small" onClick={() => onPick(f.story)}>
            Recetter
          </button>
        </div>
      ))}
      {running.length > 0 && (
        <section className="card">
          <h2>En cours</h2>
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
          <h2>Que veux-tu dans ce jeu ?</h2>
          <p>Écris-le en une phrase dans le champ du haut, comme tu le dirais à quelqu'un : « un score par joueur au-dessus de la grille ». L'agent cadre d'abord ta feature et te fait valider le cadrage, puis il travaille seul jusqu'à la recette.</p>
        </section>
      )}
      {stories.length > 0 && blocked.length + acceptance.length + running.length === 0 && <p className="muted">Rien en cours. Dis ce que tu veux dans le champ du haut.</p>}
      <details className="card">
        <summary>Avancé pour la prochaine feature</summary>
        <label className="field">
          <span>Agent</span>
          <select value={oneOffAgent} onChange={(e) => onAgent(e.target.value as AgentName | "")}>
            <option value="">{settings ? `${AGENT_NAMES[settings.agent]} (réglage du projet)` : "réglage du projet"}</option>
            {(Object.keys(AGENT_NAMES) as AgentName[])
              .filter((a) => a !== settings?.agent)
              .map((a) => (
                <option key={a} value={a}>
                  {AGENT_NAMES[a]}, pour cette feature seulement
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
        <h2>Livrées et abandonnées</h2>
        <input className="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Chercher dans les titres et les demandes…" autoFocus />
        {list.length === 0 ? (
          <p className="muted">{stories.length === 0 ? "Aucune story livrée ni abandonnée pour l'instant." : "Rien ne correspond."}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Story</th>
                <th>Feature demandée</th>
                <th>Fin</th>
                <th>Résultat</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.story} className="clickable" onClick={() => onPick(x.story)}>
                  <td>{x.title}</td>
                  <td className="muted">{x.request ? `« ${x.request.length > 70 ? `${x.request.slice(0, 70)}…` : x.request} »` : "—"}</td>
                  <td>{since(x.updated)}</td>
                  <td className={x.result === "accepted" ? "ok" : "muted"}>{x.result === "accepted" ? "livrée" : x.result === "abandoned" ? "abandonnée" : "fermée"}</td>
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
  const t = text.trim().toLowerCase();
  const list = stories.filter((f) => !t || `${f.title} ${f.request ?? ""} ${f.story}`.toLowerCase().includes(t)).slice(0, 12);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette">
        <input
          autoFocus
          value={text}
          placeholder="Aller à une story…"
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
        {list.length === 0 && <div className="muted">Aucune story.</div>}
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
    <Dialog title={`Réglages du projet · ${name}`} onClose={onClose}>
      <label className="field">
        <span>Agent par défaut des nouvelles stories</span>
        <select value={agent} onChange={(e) => setAgent(e.target.value as AgentName)}>
          {(Object.keys(AGENT_NAMES) as AgentName[]).map((a) => (
            <option key={a} value={a}>
              {AGENT_NAMES[a]}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small-text">Une story déjà commencée garde son agent.</p>
      <label className="field">
        <span>Modèle local (OpenCode)</span>
        <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
      </label>
      <p className="muted small-text">
        Nommé comme dans OpenCode : « lmstudio/qwen/qwen3.5-9b » pour LM Studio, « ollama/qwen3:8b » pour Ollama.
      </p>
      <label className="field">
        <span>Contexte du modèle local (tokens)</span>
        <input value={context} onChange={(e) => setContext(e.target.value)} inputMode="numeric" />
      </label>
      <p className="muted small-text">
        LM Studio : contexte avec lequel l'app charge le modèle, à régler selon la mémoire de ta carte graphique (par exemple 100 000 à 130 000 pour Qwen 9B). Un modèle déjà chargé garde son contexte ; la jauge montre celui qui est réellement chargé. Ollama : il fixe lui-même le contexte (ses réglages, ou OLLAMA_CONTEXT_LENGTH) ; l'app refuse de lancer l'agent s'il est plus petit que cette valeur.
      </p>
      <div className="actions end">
        <button className="btn" onClick={onClose}>
          Annuler
        </button>
        <button className="btn primary" disabled={!valid} onClick={() => onSave({ agent, localModel: model.trim(), localContext: value })}>
          Enregistrer
        </button>
      </div>
    </Dialog>
  );
}
