// Accueil sans jeu ouvert (Nouveau jeu, Ouvrir un jeu, récents = registre de la machine), et les dialogues de création
// et d'ouverture. La création montre ses étapes au fur et à mesure (événement « creation » du service).
import { useEffect, useState } from "react";
import { useAction } from "./action.ts";
import { pickFolder, inTauri, type Api, type KnownEngine, type ProjectView } from "./api.ts";

export function Home({ projects, onNew, onOpen, onPick }: { projects: ProjectView[]; onNew: () => void; onOpen: () => void; onPick: (id: string) => void }) {
  return (
    <main className="home">
      <h1>Spawn App Studio</h1>
      <p className="muted">Tu dis ce que tu veux, tu juges ce que tu vois.</p>
      <div className="big-buttons">
        <button onClick={onNew}>
          <strong>Nouveau projet</strong>
          <span className="muted">Ctrl+N</span>
        </button>
        <button onClick={onOpen}>
          <strong>Ouvrir un projet…</strong>
          <span className="muted">Ctrl+O · choisir son dossier</span>
        </button>
      </div>
      {projects.length > 0 && (
        <>
          <h2 className="small-title">Récents</h2>
          {projects.map((p) => (
            <button key={p.id} className="recent" onClick={() => onPick(p.id)} title={p.root}>
              <span>
                <strong>{p.name}</strong> <span className="muted">{p.root}</span>
              </span>
              <span className={p.problem ? "alert" : "muted"}>{p.problem ?? (p.open_stories === 0 ? "rien en cours" : `${p.open_stories} feature${p.open_stories > 1 ? "s" : ""} en cours`)}</span>
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
          Parcourir…
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
    void pickFolder("Ouvrir un projet").then((d) => (d ? onOpen(d) : onClose()));
  }, [onOpen, onClose]);
  if (inTauri()) return null;
  return (
    <Dialog title="Ouvrir un projet" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dir.trim()) onOpen(dir.trim());
        }}
      >
        <label className="field">
          <span>Dossier du projet (celui qui contient spawn.json)</span>
          <FolderField value={dir} onChange={setDir} title="Ouvrir un projet" />
        </label>
        <div className="actions end">
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn primary" disabled={!dir.trim()}>
            Ouvrir
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function NewGameDialog({ api, events, onClose, onCreated }: { api: Api; events: EventSource | null; onClose: () => void; onCreated: (p: ProjectView) => void }) {
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
      made.p = await api.call<ProjectView>("POST", "/api/games", {
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
      <Dialog title={`Création de « ${name.trim()} »`} onClose={() => error && onClose()}>
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
                Modifier
              </button>
              <button className="btn" onClick={onClose}>
                Fermer
              </button>
            </div>
          </>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog title="Nouveau projet" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void create();
        }}
      >
        <label className="field">
          <span>Nom</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Casse-briques" autoFocus />
        </label>
        <label className="field">
          <span>Dans le dossier</span>
          <FolderField value={parent} onChange={setParent} title="Dossier où créer le projet" />
        </label>
        <label className="field">
          <span>Moteur</span>
          {engines && engines.length > 0 ? (
            <select value={engine} onChange={(e) => setEngine(e.target.value)}>
              {engines.map((m) => (
                <option key={`${m.engine} ${m.version}`} value={`${m.engine} ${m.version}`} title={m.executable}>
                  {m.engine === "godot" ? "Godot" : m.engine} {m.version}
                </option>
              ))}
            </select>
          ) : (
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="version du moteur, ex. 4.5.1 pour Godot, 24 pour Node (aucun moteur connu sur cette machine)" />
          )}
        </label>
        <details>
          <summary>Avancé</summary>
          <label className="field">
            <span>Préfixe des exigences (2 à 6 majuscules)</span>
            <input value={tag} onChange={(e) => setTag(e.target.value.toUpperCase())} placeholder="tiré du nom" />
          </label>
          <label className="field">
            <span>Dépôt distant</span>
            <select value={remote} onChange={(e) => setRemote(e.target.value)}>
              <option value="local">Local, à côté du projet</option>
              <option value="none">Aucun</option>
            </select>
          </label>
        </details>
        <div className="actions end">
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn primary" disabled={!ready || act.pending !== null}>
            {act.pending === "create" ? "Création…" : "Créer"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
