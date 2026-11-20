// Menus Fichier, Projet, Affichage, Aide (docs/navigation.md §9) : chaque entrée est un geste de la coque.
import { getLang, LANGS, setLang, t } from "../i18n/i18n.ts";
import type { ModuleState, ProjectView, WorkspaceView } from "../shared/api.ts";
import { projectRoute, workspaceRoute, type Route } from "../navigation/route.ts";
import type { ShellActions } from "./actions.ts";
import type { Menu } from "./Menus.tsx";
import { placeLabel } from "./placeLabel.ts";
import { placesOf } from "./places.ts";

export function appMenus(route: Route, projects: ProjectView[], workspaces: WorkspaceView[], modules: ModuleState[], act: ShellActions): Menu[] {
  const inScope = route.kind !== "picker";
  const project = route.kind === "project" ? route.project : null;
  const workspace = route.kind === "workspace" ? route.workspace : null;
  return [
    {
      title: t("menu.file"),
      entries: [
        { title: t("menu.file.new"), shortcut: "Ctrl+N", action: () => act.open("new") },
        { title: t("menu.file.open"), shortcut: "Ctrl+O", action: () => act.open("open") },
        { title: t("menu.file.scope"), shortcut: "Ctrl+P", action: () => act.open("picker") },
        {
          title: t("menu.file.recent"),
          sub: projects.map((p) => ({ title: p.name, detail: p.root, action: () => act.navigate(projectRoute(p.id)), checked: p.id === project })),
        },
        "-",
        { title: t("menu.file.newWorkspace"), action: () => act.open("workspace") },
        {
          title: t("menu.file.workspaces"),
          sub: workspaces.map((w) => ({ title: w.name, action: () => act.navigate(workspaceRoute(w.id)), checked: w.id === workspace })),
        },
        "-",
        { title: t("menu.file.closeScope"), shortcut: "Ctrl+W", action: act.closeScope, disabled: !inScope },
      ],
    },
    {
      title: t("menu.project"),
      entries: [
        { title: t("menu.project.feature"), shortcut: "Ctrl+Maj+N", action: act.create, disabled: !project },
        { title: t("menu.project.launch"), shortcut: "F5", action: act.launch, disabled: !project },
        "-",
        { title: t("menu.project.folder"), action: act.folder, disabled: !project },
        "-",
        { title: t("menu.project.settings"), action: () => act.open("settings"), disabled: !project },
      ],
    },
    {
      title: t("menu.view"),
      entries: [
        { title: t("menu.view.goto"), shortcut: "Ctrl+K", action: () => act.open("goto"), disabled: !inScope },
        ...(placesOf(route).length > 0 ? (["-"] as const) : []),
        ...placesOf(route).map((p, i) => ({ title: t("menu.view.place", { place: placeLabel(p) }), shortcut: `Ctrl+${i + 1}`, action: () => act.place(p) })),
        "-",
        { title: t("menu.view.language"), sub: LANGS.map((l) => ({ title: l.label, action: () => setLang(l.id), checked: getLang() === l.id })) },
        "-",
        ...modules.filter((m) => !m.core).map((m) => ({ title: m.title, detail: m.reason ?? m.description, checked: m.active, action: () => act.toggleModule(m.id, !m.active) })),
      ],
    },
    {
      title: t("menu.help"),
      entries: [{ title: t("menu.help.journey"), disabled: true }],
    },
  ];
}
