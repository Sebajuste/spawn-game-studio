# Réglages et adoption d'un projet existant : plan d'implémentation

> Specs : `docs/reglages.md` et `docs/adoption.md` (validées le 2026-11-21). Contrat : `kit/engine-contract.md` (`detect`, `adopt`, `title`). Maquette : `docs/maquettes/reglages.html`.

**But :** une fenêtre Réglages (Application, Workspace, Projet), un menu ⋯ par objet, une seule confirmation ; et « Ajouter un projet existant » qui diagnostique un dossier puis l'adopte (git, `spawn.json`, hooks, plugin, gabarit du moteur, suite de départ, un commit).

**Architecture :** le contrat gagne `detect` et `adopt` ; chaque adaptateur pose son gabarit (Godot : GUT ; Node : section `node` depuis les scripts, Vitest et Jest lus). Le kit (`kit/core/src/adopt/`, hors cœur) fait le diagnostic en lecture seule et l'adoption, avec une exécution injectable pour les tests. Le service expose adaptateurs, diagnostic, adoption (événement `adoption`) et les routes de gestion des workspaces. L'app ajoute `src/settings/`, `src/adopt/` et deux composants partagés (`MenuButton`, `ConfirmDialog`).

**Contraintes :** le contrat (`adapter/`, `engine-contract.md`) change avec l'accord du mainteneur, rien d'autre du cœur ; noms techniques en anglais, textes et commentaires en français ; TypeScript exécuté par Node (ni `enum` ni `namespace`) ; un fichier = une responsabilité, regroupés par thème ; aucune attribution IA dans les commits.

## Fichiers

| Fichier | Responsabilité |
|---|---|
| `kit/core/src/adapter/types.ts`, `call.ts` | `detect`, `adopt`, `DetectData`, `AdoptData`, `title` du descripteur |
| `kit/core/src/adapter/contract.ts` (+ `test/contract.test.ts`) | vérifications `detect` / `adopt` de la suite de contrat |
| `kit/engines/node/src/commands/detect.ts`, `adopt.ts` | reconnaître un projet Node ; déclarer la section `node`, test minimal |
| `kit/engines/node/src/scripts.ts` | correspondance scripts de `package.json` → section `node` (pur) |
| `kit/engines/node/src/parse.ts` | sorties Vitest et Jest en plus du lanceur de Node |
| `kit/engines/godot/src/commands/detect.ts`, `adopt.ts` | reconnaître `project.godot` ; GUT, `.gutconfig.json`, `.gdignore`, premier test |
| `kit/engines/godot/src/project-godot.ts` | lire la version, activer un plugin dans `project.godot` (pur) |
| `kit/core/src/adopt/git.ts` | état git (dépôt, branche, arbre, develop, origin/HEAD, hooks) |
| `kit/core/src/adopt/engine.ts` | quel adaptateur reconnaît le dossier (`detect` de chacun) |
| `kit/core/src/adopt/files.ts` | `spawn.json` et lignes de `.gitignore` à poser |
| `kit/core/src/adopt/diagnose.ts` | diagnostic en lecture seule : points ✓ + ~ ⚠ ⛔ |
| `kit/core/src/adopt/adopt.ts` | adoption : refait le diagnostic, applique, suite de départ, commit, inscription |
| `kit/core/src/adapters.ts` | lister les adaptateurs de `kit/engines/*` (nom, titre) |
| `kit/core/src/workspaces.ts` | `renameWorkspace`, `removeProject`, `renameEpic`, `removeEpic` |
| `service/src/modules/adopt.ts` | `GET /api/adapters`, `POST /api/projects/diagnose`, `POST /api/projects/adopt` |
| `service/src/modules/workspaces.ts`, `projects.ts` | renommer, retirer un projet, epic renommé ou supprimé ; retrait d'un projet de ses workspaces |
| `src/shared/MenuButton.tsx`, `ConfirmDialog.tsx` | menu ⋯ ; confirmation partagée |
| `src/settings/SettingsWindow.tsx`, `AppSection.tsx`, `WorkspaceSection.tsx`, `ProjectSection.tsx`, `DangerZone.tsx` | la fenêtre Réglages, une section par fichier |
| `src/adopt/AdoptWindow.tsx`, `DiagnosisList.tsx`, `useAdoption.ts` | ajouter un projet existant : diagnostic, journal, résultat |
| `src/shell/*` | menus réorganisés, Ctrl+, et Ctrl+O, menu ▾ de la portée |
| `src/story/StoryPage.tsx`, `src/workspace/EpicPage.tsx`, `WorkspaceProjects.tsx` | menus ⋯ ; lieu Projets sans gestion |

## Tâches

1. **Contrat** : sous-commandes et types ; `checkContract` vérifie `detect` (dossier vide → `match: false` ; projet de `new-project` → `match: true`) et `adopt` (`--dry-run` n'écrit rien ; dossier vide → `not-a-project`). Les faux adaptateurs de test les implémentent.
2. **Adaptateur Node** : `detect`, `adopt` (tests : scripts `typecheck`/`lint`/`test`/`dev`, section existante gardée, sans test → `test/spawn.test.mjs`, idempotence, dry-run) ; lecture Vitest et Jest (tests sur des sorties réelles, vert et rouge) ; `title` dans `adapter.json`.
3. **Adaptateur Godot** : `detect`, `adopt` (tests sans Godot ni réseau : GUT déjà présent, plugin activé dans `project.godot`, `.gutconfig.json` d'après les tests existants, premier test seulement s'il n'y en a aucun ; dry-run sans téléchargement) ; `title`.
4. **Kit** : `adopt/` et `adapters.ts` ; tests sur des dépôts temporaires (pas un dépôt → ⛔, arbre sale → ⛔, `.husky/` → ⛔, `main` sans develop → develop créée ; adoption d'un projet Node : `spawn.json`, `.gitignore`, `core.hooksPath`, un commit sur develop, inscrit ; deuxième diagnostic → plus rien à ajouter). Fonctions de workspaces avec tests.
5. **Service** : routes et tests (diagnostic d'un dossier Node ; adoption avec ajout au workspace ; retrait d'un projet refusé s'il a une story dans un epic ; `DELETE /api/projects/:id` le retire des workspaces).
6. **App** : composants partagés, Réglages, adoption, menus, ⋯, `NewProjectDialog` sur `/api/adapters` (plus de `godot` en dur), i18n en et fr ; tests des fonctions pures.
7. **Vérification** : `npm run typecheck`, `npm run lint`, `npm run test:spawn` ; captures (Réglages des trois sections, menu ⋯, confirmation, diagnostic et adoption d'un vrai projet Node temporaire) comparées à la maquette.

## Statut

Fait : contrat et adaptateurs (`ce3ccc2`), adoption du kit (`8ac14db`), service (`8834574`), interface (`d42914d`).
Vérifié : typecheck, lint, tests de l'app ; captures des Réglages (application, workspace, projet), des menus ▾ et ⋯,
de la confirmation d'abandon et du diagnostic d'un projet Node existant.

Non vérifié : une adoption réelle de bout en bout par le service (elle lance l'agent), l'adoption d'un projet Godot avec
téléchargement de GUT, l'installation réelle du plugin.

## Hors de ce plan

Liste des adaptateurs du runtime figé (`kit/core/src/runtime.ts`, cœur) dérivée de `kit/engines/` ; plusieurs gabarits par moteur ; commande `spawn adopt` ; migration de la mémoire et des worktrees d'un projet déjà mené hors Spawn.
