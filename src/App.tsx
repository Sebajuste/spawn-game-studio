// Coque de l'app (docs/ux-parcours.md) : une fenêtre = un jeu. Menus Fichier, Projet, Affichage, Aide et leurs raccourcis ;
// accueil sans projet ouvert ; le projet ouvert vit dans Project.tsx. Le dernier projet ouvert se rouvre au démarrage.
import { useCallback, useEffect, useMemo, useState } from "react";
import { t, setLang, getLang, useLang, LANGS } from "./i18n.ts";
import { Home, NewProjectDialog, OpenDialog } from "./Home.tsx";
import { Api, connect, type ModuleState, type ProjectView, type WorkspaceView } from "./api.ts";
import { Project } from "./Project.tsx";
import { NewWorkspaceDialog, Workspace } from "./Workspace.tsx";
import { Menus, type Menu } from "./Menus.tsx";
import "./App.css";

const PROJECT_KEY = "spawn.game";
// Clé d'avant le nommage anglais : lue une fois, puis remplacée.
const LEGACY_PROJECT_KEY = "spawn.jeu";

function readProject(): string | null {
  try {
    const legacy = localStorage.getItem(LEGACY_PROJECT_KEY);
    if (legacy !== null) {
      localStorage.removeItem(LEGACY_PROJECT_KEY);
      if (localStorage.getItem(PROJECT_KEY) === null) localStorage.setItem(PROJECT_KEY, legacy);
    }
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
}
function rememberProject(id: string | null): void {
  try {
    if (id) localStorage.setItem(PROJECT_KEY, id);
    else localStorage.removeItem(PROJECT_KEY);
  } catch {
    // stockage indisponible : l'accueil s'affichera au prochain démarrage
  }
}

export type DialogKind = "new" | "open" | "goto" | "settings" | "workspace" | null;

export default function App() {
  useLang();
  const [api, setApi] = useState<Api | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modules, setModules] = useState<ModuleState[]>([]);
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [game, setGame] = useState<string | null>(readProject);
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

  const loadWorkspaces = useCallback(async () => {
    if (!api) return;
    try {
      setWorkspaces(await api.call<WorkspaceView[]>("GET", "/api/workspaces"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    void loadProjects();
    void loadWorkspaces();
  }, [loadProjects, loadWorkspaces]);

  useEffect(() => {
    if (!api) return;
    const source = api.events();
    source.addEventListener("modules", (e) => setModules(JSON.parse((e as MessageEvent<string>).data) as ModuleState[]));
    source.addEventListener("workspaces", () => void loadWorkspaces());
    setEvents(source);
    return () => source.close();
  }, [api, loadWorkspaces]);

  const openProject = useCallback((id: string | null) => {
    setGame(id);
    setWorkspaceId(null);
    rememberProject(id);
    setDialog(null);
  }, []);

  // Un jeu retenu qui a disparu du registre : retour à l'accueil.
  const project = projects?.find((p) => p.id === game) ?? null;
  useEffect(() => {
    if (game && projects && !projects.some((p) => p.id === game)) openProject(null);
  }, [game, projects, openProject]);

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
      openProject(p.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const workspace = workspaces.find((w) => w.id === workspaceId) ?? null;
  const hasProject = project !== null;
  const menus: Menu[] = [
    {
      title: t("menu.file"),
      entries: [
        { title: t("menu.file.new"), shortcut: "Ctrl+N", action: () => setDialog("new") },
        { title: t("menu.file.open"), shortcut: "Ctrl+O", action: () => setDialog("open") },
        {
          title: t("menu.file.recent"),
          sub: (projects ?? []).map((p) => ({ title: p.name, detail: p.root, action: () => openProject(p.id), checked: p.id === game })),
        },
        { title: t("menu.file.newWorkspace"), action: () => setDialog("workspace") },
        {
          title: t("menu.file.workspaces"),
          sub: workspaces.map((w) => ({
            title: w.name,
            action: () => {
              openProject(null);
              setWorkspaceId(w.id);
            },
            checked: w.id === workspaceId,
          })),
        },
        "-",
        { title: t("menu.file.close"), shortcut: "Ctrl+W", action: () => openProject(null), disabled: !hasProject },
      ],
    },
    {
      title: t("menu.project"),
      entries: [
        { title: t("menu.project.feature"), shortcut: "Ctrl+Maj+N", action: () => request("request"), disabled: !hasProject },
        { title: t("menu.project.launch"), shortcut: "F5", action: () => request("launch"), disabled: !hasProject },
        { title: t("menu.project.history"), action: () => request("history"), disabled: !hasProject },
        "-",
        { title: t("menu.project.folder"), action: () => request("folder"), disabled: !hasProject },
        "-",
        { title: t("menu.project.settings"), action: () => setDialog("settings"), disabled: !hasProject },
      ],
    },
    {
      title: t("menu.view"),
      entries: [
        { title: t("menu.view.goto"), shortcut: "Ctrl+K", action: () => setDialog("goto"), disabled: !hasProject },
        "-",
        { title: t("menu.view.language"), sub: LANGS.map((l) => ({ title: l.label, action: () => setLang(l.id), checked: getLang() === l.id })) },
        "-",
        ...modules
          .filter((m) => !m.core)
          .map((m) => ({ title: m.title, detail: m.reason ?? m.description, checked: m.active, action: () => void toggleModule(m.id, !m.active) })),
      ],
    },
    {
      title: t("menu.help"),
      entries: [{ title: t("menu.help.journey"), disabled: true }],
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
      else if (ctrl && k === "k" && hasProject) setDialog("goto");
      else if (ctrl && k === "w" && hasProject) openProject(null);
      else if (e.key === "F5" && hasProject) request("launch");
      else if (e.key === "Escape" && dialog) setDialog(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasProject, request, openProject, dialog]);

  if (!api) return <main className="empty">{error ?? t("app.connecting")}</main>;

  return (
    <div className="window">
      <Menus menus={menus} />
      {error && (
        <div className="error-banner" onClick={() => setError(null)} title={t("app.dismiss")}>
          {error}
        </div>
      )}
      {project ? (
        <Project key={project.id} api={api} events={events} project={project} active={active} signal={signal} dialog={dialog} closeDialog={() => setDialog(null)} onError={setError} />
      ) : workspace ? (
        <Workspace
          api={api}
          workspace={workspace}
          projects={projects ?? []}
          onBack={() => setWorkspaceId(null)}
          onChanged={() => void loadWorkspaces()}
          onDeleted={() => {
            setWorkspaceId(null);
            void loadWorkspaces();
          }}
          onError={setError}
        />
      ) : (
        <Home
          projects={projects ?? []}
          workspaces={workspaces}
          onNew={() => setDialog("new")}
          onOpen={() => setDialog("open")}
          onPick={openProject}
          onPickWorkspace={setWorkspaceId}
          onNewWorkspace={() => setDialog("workspace")}
        />
      )}
      {dialog === "workspace" && (
        <NewWorkspaceDialog
          api={api}
          projects={projects ?? []}
          onClose={() => setDialog(null)}
          onCreated={(w) => {
            void loadWorkspaces();
            setDialog(null);
            setWorkspaceId(w.id);
          }}
        />
      )}
      {dialog === "new" && (
        <NewProjectDialog
          api={api}
          events={events}
          onClose={() => setDialog(null)}
          onCreated={(p) => {
            void loadProjects().then(() => openProject(p.id));
          }}
        />
      )}
      {dialog === "open" && <OpenDialog onClose={() => setDialog(null)} onOpen={(d) => void addProject(d)} />}
    </div>
  );
}
