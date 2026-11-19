// Coque de l'app (docs/ux-parcours.md) : une fenêtre = un jeu. Menus Fichier, Projet, Affichage, Aide et leurs raccourcis ;
// accueil sans jeu ouvert ; le jeu ouvert vit dans Game.tsx. Le dernier jeu ouvert se rouvre au démarrage.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Home, NewGameDialog, OpenDialog } from "./Home.tsx";
import { Api, connect, type ModuleState, type ProjectView } from "./api.ts";
import { Game } from "./Game.tsx";
import { Menus, type Menu } from "./Menus.tsx";
import "./App.css";

const GAME_KEY = "spawn.game";
// Clé d'avant le nommage anglais : lue une fois, puis remplacée.
const LEGACY_GAME_KEY = "spawn.jeu";

function readGame(): string | null {
  try {
    const legacy = localStorage.getItem(LEGACY_GAME_KEY);
    if (legacy !== null) {
      localStorage.removeItem(LEGACY_GAME_KEY);
      if (localStorage.getItem(GAME_KEY) === null) localStorage.setItem(GAME_KEY, legacy);
    }
    return localStorage.getItem(GAME_KEY);
  } catch {
    return null;
  }
}
function rememberGame(id: string | null): void {
  try {
    if (id) localStorage.setItem(GAME_KEY, id);
    else localStorage.removeItem(GAME_KEY);
  } catch {
    // stockage indisponible : l'accueil s'affichera au prochain démarrage
  }
}

export type DialogKind = "new" | "open" | "goto" | "settings" | null;

export default function App() {
  const [api, setApi] = useState<Api | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modules, setModules] = useState<ModuleState[]>([]);
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [game, setGame] = useState<string | null>(readGame);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [events, setEvents] = useState<EventSource | null>(null);
  // Demandes faites par les menus et les raccourcis au jeu ouvert : un compteur par action.
  const [signal, setSignal] = useState<{ action: string; n: number }>({ action: "", n: 0 });

  const active = useMemo(() => new Set(modules.filter((m) => m.active).map((m) => m.id)), [modules]);

  useEffect(() => {
    connect()
      .then((c) => setApi(new Api(c)))
      .catch((e: Error) => setError(e.message));
  }, []);

  const loadProjects = useCallback(async () => {
    if (!api) return;
    try {
      setProjects(await api.call<ProjectView[]>("GET", "/api/projects"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!api) return;
    const source = api.events();
    source.addEventListener("modules", (e) => setModules(JSON.parse((e as MessageEvent<string>).data) as ModuleState[]));
    setEvents(source);
    return () => source.close();
  }, [api]);

  const openGame = useCallback((id: string | null) => {
    setGame(id);
    rememberGame(id);
    setDialog(null);
  }, []);

  // Un jeu retenu qui a disparu du registre : retour à l'accueil.
  const project = projects?.find((p) => p.id === game) ?? null;
  useEffect(() => {
    if (game && projects && !projects.some((p) => p.id === game)) openGame(null);
  }, [game, projects, openGame]);

  const request = useCallback((action: string) => setSignal((s) => ({ action, n: s.n + 1 })), []);

  const toggleModule = async (id: string, value: boolean) => {
    if (!api) return;
    try {
      setModules(await api.call<ModuleState[]>("PUT", `/api/modules/${id}`, { active: value }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addProject = async (dir: string) => {
    if (!api) return;
    try {
      const p = await api.call<ProjectView>("POST", "/api/projects", { dir });
      setError(null);
      await loadProjects();
      openGame(p.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const hasGame = project !== null;
  const menus: Menu[] = [
    {
      title: "Fichier",
      entries: [
        { title: "Nouveau projet…", shortcut: "Ctrl+N", action: () => setDialog("new") },
        { title: "Ouvrir un projet…", shortcut: "Ctrl+O", action: () => setDialog("open") },
        {
          title: "Projets récents",
          sub: (projects ?? []).map((p) => ({ title: p.name, detail: p.root, action: () => openGame(p.id), checked: p.id === game })),
        },
        "-",
        { title: "Fermer le projet", shortcut: "Ctrl+W", action: () => openGame(null), disabled: !hasGame },
      ],
    },
    {
      title: "Projet",
      entries: [
        { title: "Nouvelle feature", shortcut: "Ctrl+Maj+N", action: () => request("request"), disabled: !hasGame },
        { title: "Lancer le projet", shortcut: "F5", action: () => request("launch"), disabled: !hasGame },
        { title: "Livrées et abandonnées", action: () => request("history"), disabled: !hasGame },
        "-",
        { title: "Ouvrir le dossier", action: () => request("folder"), disabled: !hasGame },
        "-",
        { title: "Réglages du projet…", action: () => setDialog("settings"), disabled: !hasGame },
      ],
    },
    {
      title: "Affichage",
      entries: [
        { title: "Aller à…", shortcut: "Ctrl+K", action: () => setDialog("goto"), disabled: !hasGame },
        "-",
        ...modules
          .filter((m) => !m.core)
          .map((m) => ({ title: m.title, detail: m.reason ?? m.description, checked: m.active, action: () => void toggleModule(m.id, !m.active) })),
      ],
    },
    {
      title: "Aide",
      entries: [{ title: "Parcours de l'app : docs/ux-parcours.md", disabled: true }],
    },
  ];

  // Raccourcis clavier des menus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && e.shiftKey && k === "n") request("request");
      else if (ctrl && k === "n") setDialog("new");
      else if (ctrl && k === "o") setDialog("open");
      else if (ctrl && k === "k" && hasGame) setDialog("goto");
      else if (ctrl && k === "w" && hasGame) openGame(null);
      else if (e.key === "F5" && hasGame) request("launch");
      else if (e.key === "Escape" && dialog) setDialog(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasGame, request, openGame, dialog]);

  if (!api) return <main className="empty">{error ?? "Connexion au service…"}</main>;

  return (
    <div className="window">
      <Menus menus={menus} />
      {error && (
        <div className="error-banner" onClick={() => setError(null)} title="Cliquer pour fermer">
          {error}
        </div>
      )}
      {project ? (
        <Game key={project.id} api={api} events={events} project={project} active={active} signal={signal} dialog={dialog} closeDialog={() => setDialog(null)} onError={setError} />
      ) : (
        <Home projects={projects ?? []} onNew={() => setDialog("new")} onOpen={() => setDialog("open")} onPick={openGame} />
      )}
      {dialog === "new" && (
        <NewGameDialog
          api={api}
          events={events}
          onClose={() => setDialog(null)}
          onCreated={(p) => {
            void loadProjects().then(() => openGame(p.id));
          }}
        />
      )}
      {dialog === "open" && <OpenDialog onClose={() => setDialog(null)} onOpen={(d) => void addProject(d)} />}
    </div>
  );
}
