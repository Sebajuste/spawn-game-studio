# Plan : navigation unifiée de l'app

**Statut :** fait (2026-11-20) : typecheck, lint et `test:app` verts ; captures comparées à la maquette.

**Spec :** `docs/navigation.md` (validé le 2026-11-20) ; maquette `docs/maquettes/navigation.html`.

**But :** une seule coque (menus, barre de gauche avec la portée et ses lieux, fil d'Ariane, barre d'état) sur tous les écrans, et toute la navigation dans une adresse (`#/…`).

**Architecture :** l'état de navigation est une seule valeur `Route`, lue et écrite dans le hash (`src/navigation/`). La coque (`src/shell/`) lit la route et monte le lieu demandé, pris dans `src/project/`, `src/workspace/` ou `src/story/`. Les données partagées (projets, workspaces, modules, backlogs) se chargent une fois dans `src/data/` et passent aux lieux.

**Outils :** React 19, TypeScript strict exécuté par Node (retrait des types), Vite ; tests `node --test`.

## Contraintes globales

- Aucun changement du service ni du contrat (`service/src/contract.ts`) ; rien dans le cœur du kit.
- Un fichier, une responsabilité ; les fichiers d'un même thème dans un dossier : `navigation/`, `shell/`, `data/`, `project/`, `workspace/`, `story/` (avec `story/conversation/` et `story/files/`), `shared/`, `i18n/`, `styles/`.
- Noms techniques en anglais, textes et commentaires en français ; toute clé de texte en anglais d'abord (`locales/en` source), le français suit (typecheck).
- Pas d'`enum`, pas de `namespace` ; imports avec extension `.ts`/`.tsx`.
- Les fonctions pures (`route`, `breadcrumb`, `places`, `inbox`) n'importent ni React ni `i18n.ts` (qui lit `localStorage` au chargement) : elles reçoivent leurs libellés.
- Classe de la barre d'état de la coque : `app-status` (`status-bar` existe déjà dans la conversation).
- « Retirer un projet d'un workspace » (spec §4) demande une route absente du service : hors de cette branche.
- Preuve : `npm run typecheck`, `npm run lint`, `npm run test:app`, `npm run test:spawn`, et des captures des écrans de la maquette.

## Structure des fichiers

| Dossier | Fichier | Responsabilité |
|---|---|---|
| `navigation/` | `route.ts` (+ `route.test.ts`) | type `Route`, `parseRoute(hash)`, `formatRoute(route)`, `legacyRoute(hash)` |
| | `breadcrumb.ts` (+ test) | `crumbs(route, names, placeLabel)` : segments du fil d'Ariane |
| | `useRoute.ts` | route courante depuis le hash ; `navigate` ; dernière adresse retenue |
| | `Breadcrumb.tsx` | affichage du fil d'Ariane |
| `shell/` | `Shell.tsx` | la coque : données, route, lieu monté, dialogues |
| | `Sidebar.tsx`, `ScopeBlock.tsx`, `PlaceList.tsx` | barre de gauche, bloc de portée, liste des lieux |
| | `places.ts` (+ test) | lieux d'une portée et leur raccourci |
| | `ScopePicker.tsx` | sélecteur de portée (dialogue, ou plein écran sans portée) |
| | `FirstRun.tsx` | accueil du premier lancement |
| | `StatusBar.tsx` | agents au travail, état du service, message passager |
| | `Menus.tsx`, `useAppMenus.ts`, `useShortcuts.ts` | barre de menus, contenu des menus, raccourcis |
| | `dialogs.ts` | type `DialogKind` |
| | `shell.css` | styles de la coque |
| `data/` | `useProjects.ts`, `useWorkspaces.ts`, `useModules.ts`, `useBacklogs.ts`, `useClock.ts` | données partagées et rechargement sur événements |
| | `inbox.ts` (+ test) | ce qui attend l'utilisateur, ce qui tourne, pour un ou plusieurs backlogs |
| `project/` | `ProjectInbox.tsx`, `ProjectBacklog.tsx`, `NewFeatureForm.tsx`, `StoryRow.tsx`, `InboxBanners.tsx` | lieux du projet et leurs morceaux |
| | `SettingsDialog.tsx`, `NewProjectDialog.tsx`, `OpenProjectDialog.tsx`, `FolderField.tsx`, `GoToDialog.tsx` | dialogues |
| | `storyText.ts`, `agents.ts`, `launch.ts` | étape lisible et sous-titre ; noms d'agent ; lancer et ouvrir le dossier |
| | `project.css` | styles |
| `workspace/` | `WorkspaceInbox.tsx`, `WorkspaceEpics.tsx`, `EpicPage.tsx`, `EpicLanes.tsx`, `EpicSummary.tsx`, `WorkspaceProjects.tsx` | lieux et page d'un epic |
| | `NewWorkspaceDialog.tsx`, `NewEpicDialog.tsx`, `AddStoryDialog.tsx`, `useSubmit.ts`, `epicState.ts` | dialogues et aides |
| | `workspace.css` | styles |
| `story/` | `StoryPage.tsx` + `Steps.tsx`, `Outcome.tsx`, `Idle.tsx`, `ApproveSpec.tsx`, `Answer.tsx`, `Acceptance.tsx`, `Log.tsx`, `Technical.tsx`, `progress.ts` | page d'une story, découpée sans changer son comportement |
| `story/conversation/` | `Conversation.tsx`, `Turn.tsx`, `Activity.tsx`, `Gauge.tsx`, `AgentStatus.tsx` | onglet Conversation |
| `story/files/` | `Files.tsx`, `Preview.tsx` | onglet Fichiers |
| `shared/` | `api.ts`, `action.ts`, `Dialog.tsx`, `Bold.tsx`, `time.ts` | transverses |
| `i18n/` | `i18n.ts`, `locales/` (+ zone `navigation.ts`) | langue |
| `styles/` | `base.css` | jetons, boutons, champs, cartes, bandeaux |

`App.tsx` ne fait plus que se connecter puis monter `<Shell/>`. Supprimés : `Home.tsx`, `Project.tsx`, `Workspace.tsx`, `Story.tsx`, `Conversation.tsx`, `Files.tsx`, `App.css`, et les règles mortes (`ws-bar`, `game-header`, `request`, `home`, `recent`).

## Tâche 1 : la route et ses tests

- **Fichiers :** `src/navigation/route.ts`, `src/navigation/route.test.ts`, `package.json` (script `test:app` : `node --test src/**/*.test.ts`), `scripts/run-tests.mjs` (lance aussi `test:app`).
- **Produit :**
  ```ts
  export type ProjectPlace = "inbox" | "backlog";
  export type WorkspacePlace = "inbox" | "epics" | "projects";
  export type Route =
    | { kind: "picker" }
    | { kind: "project"; workspace: string | null; project: string; place: ProjectPlace; story: string | null }
    | { kind: "workspace"; workspace: string; place: WorkspacePlace; epic: string | null };
  export function parseRoute(hash: string): Route | null;   // null : adresse vide ou illisible
  export function formatRoute(route: Route): string;        // "#/p/x/backlog/s/y"
  export function legacyRoute(hash: string): Route | null;  // "#workspace=w&project=p"
  ```
- **Tests :** aller-retour `formatRoute(parseRoute(h)) === h` pour chaque adresse du tableau §8 ; `#/p/x` → place `inbox` ; segments encodés (`%2F`) ; `#/w/w/epics/ARN-2` → epic ; `#/x`, `#/p` → null ; `#/` et `""` → null ; `legacyRoute("#workspace=w&project=p")` → projet `p` avec parent `w`, place inbox.
- **Preuve :** `npm run test:app` vert.

## Tâche 2 : fil d'Ariane, lieux, inbox (pur)

- **Fichiers :** `navigation/breadcrumb.ts`, `shell/places.ts`, `data/inbox.ts`, et leurs tests.
- **Produit :**
  ```ts
  export interface Crumb { label: string; route: Route | null }  // null : le dernier, non cliquable
  export function crumbs(route: Route, names: { project(id: string): string; workspace(id: string): string; epic(ws: string, id: string): string }, placeLabel: (p: ProjectPlace | WorkspacePlace) => string): Crumb[];
  export function placesOf(route: Route): (ProjectPlace | WorkspacePlace)[];       // [] pour picker
  export function withPlace(route: Route, place: ProjectPlace | WorkspacePlace): Route; // story/epic remis à null
  export interface InboxItem { project: string; story: StoryView }
  export function waitingFor(backlogs: ReadonlyMap<string, StoryView[] | null>, projects: string[]): InboxItem[]; // blocked puis acceptance
  export function running(backlogs: ReadonlyMap<string, StoryView[] | null>, projects: string[]): InboxItem[];    // group active
  ```
- **Tests :** `Arena › ar-api › À traiter › equipment-routes` (4 segments, le dernier sans route, les autres avec la bonne route) ; `ar-api › Backlog` sans parent ; `Arena › Epics › ARN-2 Titre` ; workspace inbox = 2 segments ; `placesOf` projet = `["inbox","backlog"]`, workspace = `["inbox","epics","projects"]` ; `waitingFor` ordonne blocked avant acceptance et ignore les backlogs `null`.

## Tâche 3 : modules transverses et langue

- **Fichiers :** déplacer `api.ts`, `action.ts` vers `shared/` ; `Dialog` (de `Home.tsx`) vers `shared/Dialog.tsx` ; `Bold` vers `shared/Bold.tsx` ; `since` vers `shared/time.ts` ; `readableStep`, `subtitle` vers `project/storyText.ts` ; `AGENT_NAMES` vers `project/agents.ts` ; `i18n.ts` et `locales/` vers `src/i18n/`. Nouvelle zone `i18n/locales/zones/navigation.ts` (en, fr) : lieux, fil d'Ariane, sélecteur, barre d'état, premier lancement, raccourcis.
- **Preuve :** typecheck vert ; comportement inchangé.

## Tâche 4 : découpe de la story (déplacement seul)

- **Fichiers :** `Story.tsx` → `story/StoryPage.tsx` (composant `StoryPage`, mêmes props que `Story`) et un fichier par sous-composant ; `Conversation.tsx` → `story/conversation/` ; `Files.tsx` → `story/files/`.
- **Interdit :** changer un comportement ou un texte.
- **Preuve :** typecheck, lint.

## Tâche 5 : données partagées

- **Produit :**
  ```ts
  useProjects(api, onError): { projects: ProjectView[] | null; reload(): Promise<void> }
  useWorkspaces(api, events, onError): { workspaces: WorkspaceView[] | null; reload(): Promise<void> }
  useModules(api, events): { modules: ModuleState[]; active: ReadonlySet<string>; toggle(id, value): Promise<void> }
  useBacklogs(api, events, projectIds: string[], enabled: boolean, onError): ReadonlyMap<string, StoryView[] | null>
  useClock(ms): void  // redessine pour que « il y a … » vieillisse
  ```
  `useBacklogs` charge `/api/projects/:id/backlog` pour chaque projet de la portée et recharge celui nommé par les événements `stories`, `conversation-end`, `backlog`.

## Tâche 6 : lieux du projet

- `ProjectInbox` : bandeaux « décision » et « recette » (ex-Board), puis « En cours » ; vide : « Rien ne t'attend ».
- `ProjectBacklog` : en-tête avec « + Nouvelle feature » (ouvre `NewFeatureForm` en tête, avec l'agent ponctuel de l'ancien « Avancé »), liste des stories actives ; filtres « En cours », « Livrées », « Fermées » ; recherche ; le premier projet vide invite à écrire la première demande.
- `GoToDialog` (stories de la portée, epics dans un workspace), `SettingsDialog`, `NewProjectDialog`, `OpenProjectDialog`.
- `launch.ts` : `launch(api, project, story?)`, `openFolder(api, project)`.

## Tâche 7 : lieux du workspace

- `WorkspaceInbox` : comme `ProjectInbox`, sur tous les projets du workspace, chaque carte avec son projet ; clic : `#/w/<w>/p/<p>/inbox/s/<story>`.
- `WorkspaceEpics` : un résumé par epic (titre, avancement, voies) ; « + Epic ». Clic : `EpicPage` (critères, voies, métriques, « + Story »).
- `WorkspaceProjects` : une ligne par projet (moteur, stories ouvertes, problème) ; clic : le projet avec ce workspace pour parent ; « + Ajouter un projet » ; « Supprimer le workspace ».

## Tâche 8 : la coque

- `useRoute` : lit le hash ; s'il est vide, l'adresse retenue (`spawn.route`), puis l'ancien format, puis l'ancienne clé `spawn.game`/`spawn.jeu` ; `navigate(route)` écrit le hash (historique) ; chaque route est retenue.
- `Shell` : route inconnue (projet ou workspace disparu) → sélecteur ; pas de projet ni de workspace → `FirstRun`.
- Raccourcis §10 ; menus Fichier (Nouveau, Ouvrir, Changer de portée Ctrl+P, Récents et Workspaces en raccourcis, Fermer Ctrl+W), Projet (Nouvelle feature, Lancer, Livrées et fermées → Backlog filtré, Dossier, Réglages), Affichage (Aller à, lieux Ctrl+1..3, Langue, modules), Aide.
- `StatusBar` : agents au travail dans la portée (clic : la story), service connecté, message passager du lancement.
- `App.tsx` réduit à la connexion.

## Tâche 9 : styles

- `styles/base.css` (jetons, boutons, champs, cartes, bandeaux, tableaux, dialogues), `shell/shell.css`, `project/project.css`, `workspace/workspace.css`, `story/story.css` ; règles mortes retirées.

## Tâche 10 : preuve et documents

- Typecheck, lint, `test:app`, `test:spawn`.
- Captures (service + Vite via `scripts/launch.mjs`, Edge sans tête) : sélecteur, À traiter et Backlog d'un projet, story, À traiter, Epics, epic et Projets d'un workspace, premier lancement ; comparées à la maquette.
- `docs/parcours.md`, `docs/workspaces.md` : renvoi à `navigation.md` pour la barre de gauche.
