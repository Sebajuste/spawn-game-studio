// Accueil sans jeu ouvert (Nouveau jeu, Ouvrir un jeu, récents = registre de la machine), et les dialogues de création
// et d'ouverture. La création montre ses étapes au fur et à mesure (événement « creation » du service).
import { useEffect, useState } from "react";
import { useAction } from "./action.ts";
import { t } from "./i18n.ts";
import { pickFolder, inTauri, type Api, type KnownEngine, type ProjectView } from "./api.ts";

export function Home({ projects, onNew, onOpen, onPick }: { projects: ProjectView[]; onNew: () => void; onOpen: () => void; onPick: (id: string) => void }) {
  return (
    <main className="home">
      <h1>Spawn App Studio</h1>
      <p className="muted">{t("home.tagline")}</p>
      <div className="big-buttons">
        <button onClick={onNew}>
          <strong>{t("home.new")}</strong>
          <span className="muted">Ctrl+N</span>
        </button>
        <button onClick={onOpen}>
          <strong>{t("home.open")}</strong>
          <span className="muted">{t("home.openHint")}</span>
        </button>
      </div>
      {projects.length > 0 && (
        <>
          <h2 className="small-title">{t("home.recent")}</h2>
          {projects.map((p) => (
            <button key={p.id} className="recent" onClick={() => onPick(p.id)} title={p.root}>
              <span>
                <strong>{p.name}</strong> <span className="muted">{p.root}</span>
              </span>
              <span className={p.problem ? "alert" : "muted"}>{p.problem ?? (p.open_stories === 0 ? t("home.nothing") : t(p.open_stories > 1 ? "home.features.other" : "home.features.one", { n: p.open_stories }))}</span>
            </button>
          ))}
        </>
      )}
    </main>
  );
}

export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? "wide" : ""}`} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// Champ de dossier : le sélecteur de Windows sous Tauri, la saisie sinon (et toujours possible).
function FolderField({ value, onChange, title }: { value: string; onChange: (v: string) => void; title: string }) {
  return (
    <div className="field-row">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="C:\Dev" autoFocus={!inTauri()} />
      {inTauri() && (
        <button type="button" className="btn" onClick={() => void pickFolder(title).then((d) => d && onChange(d))}>
          {t("dialog.browse")}
        </button>
      )}
    </div>
  );
}

export function OpenDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (dir: string) => void }) {
  const [dir, setDir] = useState("");
  // Sous Tauri, le sélecteur de Windows s'ouvre tout de suite : c'est ce qu'on attend de Ctrl+O.
  useEffect(() => {
    if (!inTauri()) return;
    void pickFolder(t("open.title")).then((d) => (d ? onOpen(d) : onClose()));
  }, [onOpen, onClose]);
  if (inTauri()) return null;
  return (
    <Dialog title={t("open.title")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dir.trim()) onOpen(dir.trim());
        }}
      >
        <label className="field">
          <span>{t("open.folder")}</span>
          <FolderField value={dir} onChange={setDir} title={t("open.title")} />
        </label>
        <div className="actions end">
          <button type="button" className="btn" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!dir.trim()}>
            {t("open.action")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function NewProjectDialog({ api, events, onClose, onCreated }: { api: Api; events: EventSource | null; onClose: () => void; onCreated: (p: ProjectView) => void }) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("C:\\Dev");
  const [engines, setEngines] = useState<KnownEngine[] | null>(null);
  const [engine, setEngine] = useState("");
  const [version, setVersion] = useState("");
  const [tag, setTag] = useState("");
  const [remote, setRemote] = useState("local");
  const [steps, setSteps] = useState<string[] | null>(null);
  const act = useAction();
  const error = act.refusal?.text ?? null;

  useEffect(() => {
    api
      .call<KnownEngine[]>("GET", "/api/engines")
      .then((m) => {
        setEngines(m);
        const first = m[0];
        if (first) setEngine(`${first.engine} ${first.version}`);
      })
      .catch(() => setEngines([]));
  }, [api]);

  useEffect(() => {
    if (!events || steps === null) return;
    const onLine = (e: Event) => {
      const { line } = JSON.parse((e as MessageEvent<string>).data) as { line: string };
      setSteps((l) => [...(l ?? []), line]);
    };
    events.addEventListener("creation", onLine);
    return () => events.removeEventListener("creation", onLine);
  }, [events, steps]);

  const choice = engines?.find((m) => `${m.engine} ${m.version}` === engine);
  const ready = name.trim() && parent.trim() && (choice || /^\d+(\.\d+)*$/.test(version.trim()));

  const create = async () => {
    setSteps([]);
    // La liste des étapes est l'attente de la création ; un refus s'y affiche avec « Modifier ».
    const made: { p?: ProjectView } = {};
    await act.run("create", async () => {
      made.p = await api.call<ProjectView>("POST", "/api/projects/new", {
        name: name.trim(),
        parent: parent.trim(),
        engine: choice?.engine ?? "godot",
        version: choice?.version ?? version.trim(),
        ...(tag.trim() ? { tag: tag.trim() } : {}),
        remote,
      });
    });
    if (made.p) onCreated(made.p);
  };

  if (steps !== null) {
    return (
      <Dialog title={t("new.creating", { name: name.trim() })} onClose={() => error && onClose()}>
        <ol className="creation-steps">
          {steps.map((l, i) => (
            <li key={i} className="done">
              {l}
            </li>
          ))}
          {!error && <li className="running">…</li>}
        </ol>
        {error && (
          <>
            <div className="error-banner">{error}</div>
            <div className="actions end">
              <button className="btn" onClick={() => setSteps(null)}>
                {t("dialog.edit")}
              </button>
              <button className="btn" onClick={onClose}>
                {t("dialog.close")}
              </button>
            </div>
          </>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog title={t("new.title")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void create();
        }}
      >
        <label className="field">
          <span>{t("new.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("new.namePlaceholder")} autoFocus />
        </label>
        <label className="field">
          <span>{t("new.parent")}</span>
          <FolderField value={parent} onChange={setParent} title={t("new.parentPick")} />
        </label>
        <label className="field">
          <span>{t("new.engine")}</span>
          {engines && engines.length > 0 ? (
            <select value={engine} onChange={(e) => setEngine(e.target.value)}>
              {engines.map((m) => (
                <option key={`${m.engine} ${m.version}`} value={`${m.engine} ${m.version}`} title={m.executable}>
                  {m.engine === "godot" ? "Godot" : m.engine} {m.version}
                </option>
              ))}
            </select>
          ) : (
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder={t("new.engineVersion")} />
          )}
        </label>
        <details>
          <summary>{t("new.advanced")}</summary>
          <label className="field">
            <span>{t("new.tag")}</span>
            <input value={tag} onChange={(e) => setTag(e.target.value.toUpperCase())} placeholder={t("new.tagPlaceholder")} />
          </label>
          <label className="field">
            <span>{t("new.remote")}</span>
            <select value={remote} onChange={(e) => setRemote(e.target.value)}>
              <option value="local">{t("new.remoteLocal")}</option>
              <option value="none">{t("new.remoteNone")}</option>
            </select>
          </label>
        </details>
        <div className="actions end">
          <button type="button" className="btn" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!ready || act.pending !== null}>
            {act.pending === "create" ? t("new.pending") : t("new.create")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
