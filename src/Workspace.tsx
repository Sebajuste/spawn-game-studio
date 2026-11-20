// Un workspace (docs/workspaces.md, docs/maquettes/workspaces.html) : ses projets et ses epics, en voies par projet. L'état de
// chaque story est lu dans son projet par le service ; une story attend tant que ses dépendances ne sont pas fusionnées.
import { useState } from "react";
import { Dialog } from "./Home.tsx";
import { t } from "./i18n.ts";
import type { Api, EpicStoryView, EpicView, ProjectView, WorkspaceView } from "./api.ts";

const refKey = (r: { project: string; story: string }) => `${r.project}/${r.story}`;

function stateLabel(state: string): string {
  const key = `workspace.state.${state}`;
  const label = t(key as Parameters<typeof t>[0]);
  return label === key ? t("workspace.state.other", { state }) : label;
}

const stateClass = (s: EpicStoryView) => (s.merged ? "done" : s.state === "not-started" ? (s.waiting_for.length > 0 ? "waiting" : "idle") : "running");

const megas = (n: number) => (n / 1_000_000).toFixed(1);

// Barre de lieux : les workspaces avec leurs projets, puis les projets hors workspace (maquette workspaces.html).
export function WorkspaceSidebar({ workspaces, projects, selected, onPickWorkspace, onPickProject }: { workspaces: WorkspaceView[]; projects: ProjectView[]; selected: string | null; onPickWorkspace: (id: string) => void; onPickProject: (id: string) => void }) {
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const grouped = new Set(workspaces.flatMap((w) => w.projects));
  const standalone = projects.filter((p) => !grouped.has(p.id));
  return (
    <aside className="sidebar">
      <h3>{t("workspace.side.workspaces")}</h3>
      {workspaces.map((w) => (
        <div key={w.id}>
          <button className={`item${w.id === selected ? " selected" : ""}`} onClick={() => onPickWorkspace(w.id)}>
            <div className="item-text">
              <strong>{w.name}</strong>
              <small>{t(w.epics.length === 1 ? "workspace.side.epics.one" : "workspace.side.epics.other", { n: w.epics.length })}</small>
            </div>
          </button>
          {w.projects.map((p) => (
            <button key={p} className="item sub" onClick={() => onPickProject(p)}>
              <div className="item-text">{names.get(p) ?? p}</div>
            </button>
          ))}
        </div>
      ))}
      {standalone.length > 0 && <h3>{t("workspace.side.standalone")}</h3>}
      {standalone.map((p) => (
        <button key={p.id} className="item" onClick={() => onPickProject(p.id)}>
          <div className="item-text">{p.name}</div>
        </button>
      ))}
    </aside>
  );
}

// Création et ajout passent tous par la même forme : un appel, l'erreur du service montrée dans le dialogue.
function useSubmit(run: () => Promise<unknown>, onDone: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await run();
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  };
  return { pending, error, submit };
}

export function NewWorkspaceDialog({ api, projects, onClose, onCreated }: { api: Api; projects: ProjectView[]; onClose: () => void; onCreated: (w: WorkspaceView) => void }) {
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  let created: WorkspaceView | null = null;
  const { pending, error, submit } = useSubmit(
    async () => {
      created = await api.call<WorkspaceView>("POST", "/api/workspaces", { name: name.trim(), projects: chosen });
    },
    () => created && onCreated(created),
  );
  return (
    <Dialog title={t("workspace.new.title")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>{t("workspace.new.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("workspace.new.namePlaceholder")} autoFocus />
        </label>
        <div className="field">
          <span>{t("workspace.new.projects")}</span>
          {projects.length === 0 && <p className="muted">{t("workspace.new.none")}</p>}
          {projects.map((p) => (
            <label key={p.id} style={{ display: "block" }}>
              <input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))} /> {p.name}
            </label>
          ))}
        </div>
        {error && <p className="alert">{error}</p>}
        <div className="actions end">
          <button type="button" className="btn" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!name.trim() || pending}>
            {pending ? t("workspace.saving") : t("workspace.save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function NewEpicDialog({ api, workspace, onClose, onDone }: { api: Api; workspace: WorkspaceView; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const { pending, error, submit } = useSubmit(
    () => api.call("POST", `/api/workspaces/${encodeURIComponent(workspace.id)}/epics`, { title: title.trim(), acceptance: acceptance.split("\n") }),
    onDone,
  );
  return (
    <Dialog title={t("workspace.epic.title")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>{t("workspace.epic.name")}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>{t("workspace.epic.acceptance")}</span>
          <textarea rows={4} style={{ width: "100%" }} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
        </label>
        {error && <p className="alert">{error}</p>}
        <div className="actions end">
          <button type="button" className="btn" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!title.trim() || pending}>
            {pending ? t("workspace.saving") : t("workspace.save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AddStoryDialog({ api, workspace, epic, names, onClose, onDone }: { api: Api; workspace: WorkspaceView; epic: EpicView; names: Map<string, string>; onClose: () => void; onDone: () => void }) {
  const [project, setProject] = useState(workspace.projects[0] ?? "");
  const [story, setStory] = useState("");
  const [after, setAfter] = useState<string[]>([]);
  const { pending, error, submit } = useSubmit(
    () =>
      api.call("POST", `/api/workspaces/${encodeURIComponent(workspace.id)}/epics/${encodeURIComponent(epic.id)}/stories`, {
        project,
        story: story.trim(),
        blocked_by: epic.stories.filter((s) => after.includes(refKey(s))).map((s) => ({ project: s.project, story: s.story })),
      }),
    onDone,
  );
  return (
    <Dialog title={t("workspace.story.title", { epic: epic.id })} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>{t("workspace.story.project")}</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            {workspace.projects.map((p) => (
              <option key={p} value={p}>
                {names.get(p) ?? p}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("workspace.story.name")}</span>
          <input value={story} onChange={(e) => setStory(e.target.value)} autoFocus />
        </label>
        <div className="field">
          <span>{t("workspace.story.after")}</span>
          {epic.stories.length === 0 && <p className="muted">{t("workspace.story.afterNone")}</p>}
          {epic.stories.map((s) => (
            <label key={refKey(s)} style={{ display: "block" }}>
              <input type="checkbox" checked={after.includes(refKey(s))} onChange={(e) => setAfter(e.target.checked ? [...after, refKey(s)] : after.filter((x) => x !== refKey(s)))} /> {names.get(s.project) ?? s.project} / {s.story}
            </label>
          ))}
        </div>
        {error && <p className="alert">{error}</p>}
        <div className="actions end">
          <button type="button" className="btn" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!project || !story.trim() || pending}>
            {pending ? t("workspace.saving") : t("workspace.save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function EpicCard({ epic, workspace, names, onAdd }: { epic: EpicView; workspace: WorkspaceView; names: Map<string, string>; onAdd: () => void }) {
  const total = epic.stories.length;
  const lanes = [...new Set(epic.stories.map((s) => s.project))];
  const measured = epic.stories.flatMap((s) => (s.metrics ? [s.metrics] : []));
  const sum = (k: "duration_min" | "interventions" | "cache_read") => measured.reduce((a, m) => a + m[k], 0);
  return (
    <section className="card epic">
      <header className="epic-head">
        <h2>
          <span className="muted">{epic.id}</span> {epic.title}
        </h2>
        <span className="muted">{total === 0 ? t("workspace.epic.empty") : t("workspace.epic.progress", { done: epic.merged, total })}</span>
      </header>
      <div className="epic-bar">
        <b style={{ width: total === 0 ? "0%" : `${Math.round((epic.merged / total) * 100)}%` }} />
      </div>
      {epic.acceptance.length > 0 && (
        <ul className="muted">
          {epic.acceptance.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <div className="epic-lanes">
        {lanes.map((p) => (
          <div key={p} className="epic-lane">
            <h4>{names.get(p) ?? p}</h4>
            {epic.stories
              .filter((s) => s.project === p)
              .map((s) => (
                <div key={refKey(s)} className={`epic-story ${stateClass(s)}`}>
                  {s.story}
                  <small>
                    {stateLabel(s.state)}
                    {s.waiting_for.length > 0 && ` · ${t("workspace.story.waiting", { refs: s.waiting_for.map((d) => `${names.get(d.project) ?? d.project}/${d.story}`).join(", ")})}`}
                  </small>
                  {s.metrics && <small>{t("workspace.metrics.story", { min: s.metrics.duration_min, n: s.metrics.interventions, cache: megas(s.metrics.cache_read) })}</small>}
                </div>
              ))}
          </div>
        ))}
      </div>
      {measured.length > 0 && <p className="muted">{t("workspace.metrics.epic", { min: sum("duration_min"), n: sum("interventions"), cache: megas(sum("cache_read")) })}</p>}
      <div className="actions">
        <button className="btn small" onClick={onAdd} disabled={workspace.projects.length === 0}>
          {t("workspace.story.add")}
        </button>
      </div>
    </section>
  );
}

export function Workspace({ api, workspace, projects, onBack, onChanged, onDeleted, onError }: { api: Api; workspace: WorkspaceView; projects: ProjectView[]; onBack: () => void; onChanged: () => void; onDeleted: () => void; onError: (m: string) => void }) {
  const [dialog, setDialog] = useState<"epic" | { epic: string } | null>(null);
  const [adding, setAdding] = useState("");
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const addable = projects.filter((p) => !workspace.projects.includes(p.id));
  const done = () => {
    setDialog(null);
    onChanged();
  };
  const call = (run: () => Promise<unknown>) => run().then(onChanged, (e: Error) => onError(e.message));
  const epic = typeof dialog === "object" && dialog !== null ? workspace.epics.find((e) => e.id === dialog.epic) : undefined;

  return (
    <main className="workspace">
      <div className="actions">
        <button className="btn small" onClick={onBack}>
          ← {t("workspace.back")}
        </button>
      </div>
      <h1>{workspace.name}</h1>
      <p className="muted">
        {t("workspace.projects")} : {workspace.projects.map((p) => names.get(p) ?? p).join(", ") || "—"}
      </p>
      <div className="actions">
        {addable.length > 0 && (
          <select
            value={adding}
            onChange={(e) => {
              const id = e.target.value;
              setAdding("");
              if (id) void call(() => api.call("POST", `/api/workspaces/${encodeURIComponent(workspace.id)}/projects`, { project: id }));
            }}
          >
            <option value="">{t("workspace.addProjectPick")}</option>
            {addable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn primary" onClick={() => setDialog("epic")}>
          + {t("workspace.epic.add")}
        </button>
        <button
          className="btn small danger"
          onClick={() => {
            if (window.confirm(t("workspace.deleteConfirm", { name: workspace.name }))) void api.call("DELETE", `/api/workspaces/${encodeURIComponent(workspace.id)}`).then(onDeleted, (e: Error) => onError(e.message));
          }}
        >
          {t("workspace.delete")}
        </button>
      </div>
      {workspace.epics.length === 0 && <p className="muted">{t("workspace.noEpics")}</p>}
      {workspace.epics.map((e) => (
        <EpicCard key={e.id} epic={e} workspace={workspace} names={names} onAdd={() => setDialog({ epic: e.id })} />
      ))}
      {dialog === "epic" && <NewEpicDialog api={api} workspace={workspace} onClose={() => setDialog(null)} onDone={done} />}
      {epic && <AddStoryDialog api={api} workspace={workspace} epic={epic} names={names} onClose={() => setDialog(null)} onDone={done} />}
    </main>
  );
}
