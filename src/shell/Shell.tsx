// La coque unique de l'app (docs/navigation.md §2) : menus, barre de gauche (portée et lieux), fil d'Ariane et contenu,
// barre d'état. Tout l'écran se déduit de l'adresse ; la coque tient les données partagées et les gestes.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Api, ProjectView } from "../shared/api.ts";
import { t, useLang } from "../i18n/i18n.ts";
import { working } from "../data/inbox.ts";
import { useBacklogs } from "../data/useBacklogs.ts";
import { useClock } from "../data/useClock.ts";
import { useEvents } from "../data/useEvents.ts";
import { useModules } from "../data/useModules.ts";
import { useProjects } from "../data/useProjects.ts";
import { useWorkspaces } from "../data/useWorkspaces.ts";
import { Breadcrumb } from "../navigation/Breadcrumb.tsx";
import { crumbs } from "../navigation/breadcrumb.ts";
import { resolveRoute } from "../navigation/resolve.ts";
import { projectRoute, sameRoute, workspaceRoute, type Route } from "../navigation/route.ts";
import { useRoute } from "../navigation/useRoute.ts";
import { launch, openFolder } from "../project/launch.ts";
import type { ShellActions } from "./actions.ts";
import { appMenus } from "./appMenus.ts";
import type { DialogKind } from "./dialogs.ts";
import { FirstRun } from "./FirstRun.tsx";
import { Menus } from "./Menus.tsx";
import { placeLabel } from "./placeLabel.ts";
import { currentPlace, placesOf, withPlace } from "./places.ts";
import { ProjectContent } from "./ProjectContent.tsx";
import { scopeOf, scopeProjects } from "./scope.ts";
import { ScopePicker } from "./ScopePicker.tsx";
import { ShellDialogs } from "./ShellDialogs.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { useShortcuts } from "./useShortcuts.ts";
import { WorkspaceContent } from "./WorkspaceContent.tsx";
import "./shell.css";

export function Shell({ api }: { api: Api }) {
  useLang();
  useClock();
  const [error, setError] = useState<string | null>(null);
  const onError = useCallback((e: string | null) => setError(e), []);
  const { events, connected } = useEvents(api);
  const { projects, reload: reloadProjects } = useProjects(api, onError);
  const { workspaces, reload: reloadWorkspaces } = useWorkspaces(api, events, onError);
  const { modules, active, toggle } = useModules(api, events, onError);
  const { route: asked, navigate } = useRoute();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  // L'adresse demandée n'est jugée qu'une fois le registre lu ; une adresse disparue ramène au sélecteur.
  const resolved = useMemo(() => {
    if (!projects || !workspaces) return null;
    return resolveRoute(asked, {
      projects: new Set(projects.map((p) => p.id)),
      workspaces: new Map(workspaces.map((w) => [w.id, { projects: w.projects, epics: w.epics.map((e) => e.id) }])),
    });
  }, [asked, projects, workspaces]);
  const route: Route = resolved?.route ?? asked;
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!resolved || sameRoute(resolved.route, asked)) return;
    if (resolved.gone) setGone(true);
    navigate(resolved.route, true);
  }, [resolved, asked, navigate]);

  const allProjects = useMemo(() => projects ?? [], [projects]);
  const allWorkspaces = useMemo(() => workspaces ?? [], [workspaces]);
  const project: ProjectView | null = route.kind === "project" ? (allProjects.find((p) => p.id === route.project) ?? null) : null;
  const workspaceId = route.kind === "picker" ? null : route.workspace;
  const workspace = allWorkspaces.find((w) => w.id === workspaceId) ?? null;
  const names = useMemo(() => new Map(allProjects.map((p) => [p.id, p.name])), [allProjects]);
  const projectName = useCallback((id: string) => names.get(id) ?? id, [names]);

  const scope = useMemo(() => scopeProjects(route, allWorkspaces), [route, allWorkspaces]);
  const { backlogs } = useBacklogs(api, events, scope, active.has("backlog"), onError);

  const go = useCallback(
    (next: Route, replace = false) => {
      setGone(false);
      setComposing(false);
      navigate(next, replace);
    },
    [navigate],
  );

  const run = useCallback(
    (story: string | null) => {
      if (route.kind !== "project") return;
      launch(api, route.project, story).then(setNotice, (e: Error) => onError(e.message));
    },
    [api, route, onError],
  );

  const addProject = useCallback(
    async (dir: string) => {
      try {
        const p = await api.call<ProjectView>("POST", "/api/projects", { dir });
        setError(null);
        await reloadProjects();
        setDialog(null);
        go(projectRoute(p.id));
      } catch (e) {
        onError((e as Error).message);
      }
    },
    [api, reloadProjects, go, onError],
  );

  const actions = useMemo<ShellActions>(
    () => ({
      navigate: go,
      open: setDialog,
      closeDialog: () => setDialog(null),
      create: () => {
        if (route.kind === "project") {
          go(projectRoute(route.project, route.workspace, "backlog"));
          setComposing(true);
        } else if (route.kind === "workspace") {
          go(workspaceRoute(route.workspace, "epics"));
          setDialog("epic");
        }
      },
      launch: () => run(route.kind === "project" ? route.story : null),
      folder: () => {
        if (route.kind === "project") openFolder(api, route.project).catch((e: Error) => onError(e.message));
      },
      closeScope: () => go(route.kind === "project" && route.workspace ? workspaceRoute(route.workspace) : { kind: "picker" }),
      place: (place) => go(withPlace(route, place)),
      toggleModule: (id, value) => void toggle(id, value),
    }),
    [go, route, run, api, onError, toggle],
  );
  useShortcuts(route, dialog, actions);

  if (!projects || !workspaces) return <main className="empty">{error ?? t("app.connecting")}</main>;

  const menus = <Menus menus={appMenus(route, allProjects, allWorkspaces, modules, actions)} />;
  const banner = error && (
    <div className="error-banner" onClick={() => setError(null)} title={t("app.dismiss")}>
      {error}
    </div>
  );
  const dialogs = (
    <ShellDialogs
      dialog={dialog}
      api={api}
      events={events}
      route={route}
      projects={allProjects}
      workspaces={allWorkspaces}
      scope={scope}
      backlogs={backlogs}
      projectName={projectName}
      open={setDialog}
      close={() => setDialog(null)}
      navigate={go}
      addProject={(dir) => void addProject(dir)}
      reloadProjects={reloadProjects}
      reloadWorkspaces={reloadWorkspaces}
      onError={onError}
    />
  );
  const status = (
    <StatusBar
      working={working(backlogs, scope)}
      connected={connected}
      notice={notice}
      projectName={projectName}
      onOpen={(item) => go(projectRoute(item.project, route.kind === "picker" ? null : route.workspace, "inbox", item.story.story))}
      onNotice={() => setNotice(null)}
    />
  );

  if (allProjects.length === 0 && allWorkspaces.length === 0) {
    return (
      <div className="window">
        {menus}
        {banner}
        <FirstRun onNew={() => setDialog("new")} onOpen={() => setDialog("open")} />
        {status}
        {dialogs}
      </div>
    );
  }

  const parent = route.kind === "project" ? workspace : null;
  const waiting = scope.reduce((n, id) => n + (backlogs.get(id) ?? []).filter((s) => s.group === "blocked" || s.group === "acceptance").length, 0);
  const trail = crumbs(route, { project: projectName, workspace: (id) => allWorkspaces.find((w) => w.id === id)?.name ?? id, epic: (ws, id) => `${id} ${allWorkspaces.find((w) => w.id === ws)?.epics.find((e) => e.id === id)?.title ?? ""}`.trim() }, placeLabel);

  return (
    <div className="window">
      {menus}
      {banner}
      <div className="shell">
        <Sidebar
          scope={scopeOf(route, project, route.kind === "workspace" ? workspace : null, parent)}
          places={placesOf(route)}
          current={currentPlace(route)}
          badge={waiting}
          onScope={() => setDialog("picker")}
          onLaunch={route.kind === "project" ? () => run(null) : null}
          onPlace={actions.place}
        />
        <section className="main-pane">
          <Breadcrumb crumbs={trail} onNavigate={go} />
          {route.kind === "picker" ? (
            <div className="scroll picker-page">
              <p className="muted">{t("nav.picker.choose")}</p>
              <ScopePicker projects={allProjects} workspaces={allWorkspaces} inline notice={gone ? t("nav.picker.gone") : null} onPick={go} onNewProject={() => setDialog("new")} onOpenProject={() => setDialog("open")} onNewWorkspace={() => setDialog("workspace")} onClose={() => undefined} />
            </div>
          ) : route.kind === "project" && project ? (
            <ProjectContent api={api} events={events} route={route} project={project} backlogs={backlogs} active={active} composing={composing} onCompose={setComposing} navigate={go} onLaunch={run} onError={onError} />
          ) : route.kind === "workspace" && workspace ? (
            <WorkspaceContent api={api} route={route} workspace={workspace} projects={allProjects} backlogs={backlogs} active={active} projectName={projectName} navigate={go} onNewEpic={() => setDialog("epic")} onChanged={() => void reloadWorkspaces()} onError={onError} />
          ) : null}
        </section>
      </div>
      {status}
      {dialogs}
    </div>
  );
}
