# Nommage technique (validé par le mainteneur le 2026-11-18)

Tout ce qui est technique est en anglais : noms de fichiers et de dossiers, identifiants (fonctions, variables, types, classes CSS), commandes et options de la CLI, contrat des adaptateurs (sous-commandes, options, champs JSON, codes d'erreur), formats sur disque (champs, statuts, événements, dossiers), routes de l'API, noms de tests.

Reste en français : les textes que l'utilisateur lit (interface, messages, refus, sorties destinées aux humains), les consignes aux agents (sorties de `spawn next`, skills, agents), la documentation (`docs/`), les commentaires du code.

Les termes ci-dessous font foi ; un nom absent se traduit en anglais technique courant, de la même façon.

## Concepts

| Français | Anglais |
|---|---|
| fil (l'unité livrée) | story |
| feature (demande de l'utilisateur, fiche titre + phrase) | feature request ; fiche : `story meta` |
| tâche | task |
| relecture / relecture finale | review / final-review |
| relecteur | reviewer |
| implémenteur | implementer |
| spec proposée / spec validée | spec-proposed / spec-approved |
| recette, à juger | acceptance ; statut `in-acceptance` |
| compte rendu de recette | acceptance report |
| preuve | proof |
| avancement | progress |
| moteur / adaptateur / contrat | engine / adapter / contract |
| périmètre | guard |
| ménage | cleanup |
| fusion, file de fusion, traiteur | merge, merge queue, merge worker |
| pilote | pilot |
| mesure | metrics |
| registre | registry |
| réglages | settings |
| limites | limits |
| ledger | ledger |
| journal | log |
| capture | capture |
| domaine (vocabulaire de l'adaptateur) | domain |
| jugement | acceptance (`accept`, `requestChanges`, `abandon`) |
| prérequis | prerequisites |
| nouveau projet (ex-« nouveau jeu ») | new-project (alias : new-game) |
| brief / rapport / verdict | brief / report / verdict |

## Statuts d'une story

| Avant | Après |
|---|---|
| `actif` | `active` |
| `compactage` | `compacting` |
| `releve-attendue` | `handoff-pending` |
| `bloque:<raison>` (`bloque:validation-spec`, `bloque:decision`) | `blocked:<reason>` (`blocked:spec-approval`, `blocked:decision`) |
| `a-juger` | `in-acceptance` |
| `termine` | `done` |
| `nettoye` | `cleaned` |

État d'une story (`.spawn/stories/<story>.json`) : `fil` → `story`, `statut` → `status`, `branche` → `branch`, `worktree`, `base`, `tache` → `task`, `premier_geste` → `first_step`, `sous_agents` → `subagents`, `mr`, `maj` → `updated`.

## Événements du ledger

| Avant | Après | Champs (avant → après) |
|---|---|---|
| `spec-proposee` | `spec-proposed` | `chemin` → `path` |
| `spec` | `spec-approved` | `chemin` → `path` |
| `plan` | `plan` | `chemin` → `path` |
| `lancee` | `task-started` | `tache` → `task`, `base` |
| `terminee` | `task-done` | `tache` → `task`, `commits` |
| `round` | `round` | `tache` → `task`, `numero` → `number`, `detail` |
| `parquee` | `task-parked` | `tache` → `task`, `detail`, `ruling` |
| `mineur` | `minor` | `tache` → `task`, `detail` |
| `ruling` | `ruling` | `decision`, `raison` → `reason`, `cout` → `cost` |
| `relecture-finale` | `final-review` | `verdict` : `propre` → `clean`, `corrections` → `changes` ; `detail` |
| `captures` | `captures` | `chemins` → `paths`, `verdict` : `valide` → `valid`, `invalide` → `invalid`, `indecidable` → `undecidable` |
| `preuve` | `proof` | `compilation`, `tests`, `lancement` → `launch`, `bout_en_bout` → `end_to_end` |
| `a-juger` | `acceptance-report` | `fait` → `summary`, `verifier` → `how_to_check` |
| `redemande` | `changes-requested` | `message` |
| `acceptee` | `accepted` | |
| `abandon` | `abandoned` | `raison` → `reason` |
| `fusion` | `merged` | `commit` |
| `note` | `note` | `texte` → `text` |

## Fichiers sur disque

| Avant | Après |
|---|---|
| `spawn.json` : `engine`, `version`, `tag`, `limites` (`agents_paralleles`, `rounds`, `modele`, `modele_escalade`) | `spawn.json` : `engine`, `version`, `tag`, `limits` (`parallel_agents`, `rounds`, `model`, `escalation_model`) |
| `.spawn/fils/` | `.spawn/stories/` |
| `.spawn/ledgers/` | `.spawn/ledgers/` |
| `.spawn/taches/<fil>/` (`N-brief.md`, `N-rapport.md`, `N-relecture.md`, `N-paquet.diff`, `finale-relecture.md`) | `.spawn/tasks/<story>/` (`N-brief.md`, `N-report.md`, `N-review.md`, `N-package.diff`, `final-review.md`) |
| `.spawn/features/` | `.spawn/story-meta/` (`title`, `request`, `created`) |
| `.spawn/conversation/<fil>/` (`etat.json`, `tour-N.jsonl`) | `.spawn/conversations/<story>/` (`state.json`, `turn-N.jsonl`) |
| `.spawn/journal/perimetre.jsonl`, `.spawn/journal/sessions/` | `.spawn/logs/guard.jsonl`, `.spawn/logs/sessions/` |
| `.spawn/journaux/` | `.spawn/logs/engine/` |
| `.spawn/captures/<fil>/` | `.spawn/captures/<story>/` |
| `.spawn/pilote/<fil>/` (`bilan.json`) | `.spawn/pilot/<story>/` (`report.json`) |
| `.spawn/reglages.json` (`agent`, `contexteLocal`) | `.spawn/settings.json` (`agent`, `localContext`) |
| `<git-common-dir>/spawn/fusion/` (`file/`, `journal.jsonl`, `verrou.json`) | `<git-common-dir>/spawn/merge/` (`queue/`, `log.jsonl`, `lock.json`) |
| `~/.spawn/projets.json`, `moteurs.json`, `app.json` | `~/.spawn/projects.json`, `engines.json`, `app.json` |

## CLI `spawn`

| Avant | Après |
|---|---|
| `fil` (`lister`, `creer`, `maj`) | `story` (`list`, `create`, `update`) |
| `ledger <type>` | `ledger <type>` (types anglais ci-dessus) |
| `moteur <sous-commande>` | `engine <subcommand>` |
| `suivant` | `next` |
| `menage [--appliquer]` | `cleanup [--apply]` |
| `prerequis [--installer --agent --oui]` | `prerequisites [--install --agent --yes]` |
| `fusion` (`etat`, `traiter`, `--sans-attendre`, `--resume`) | `merge` (`status`, `process`, `--no-wait`, `--summary`) |
| `mesure` | `metrics` |
| `limites` | `limits` |
| `pilote` (`--fil`, `--intention`, `--intention-fichier`, `--charger`, `--contexte`, `--relances`, `--duree-max-h`, `--modele`) | `pilot` (`--story`, `--intent`, `--intent-file`, `--load`, `--context`, `--restarts`, `--max-hours`, `--model`) |
| `moteurs` | `engines` |
| `nouveau-jeu` (`--nom`, `--dossier`, `--version`, `--moteur`, `--tag`, `--distant`) | `new-project` (alias `new-game` ; `--name`, `--dir`, `--version`, `--engine`, `--tag`, `--remote`) |
| `aide` | `help` |
| options `--statut`, `--tache`, `--premier-geste`, `--chemin`, `--verdict`, `--detail`, `--commits`, `--base` | `--status`, `--task`, `--first-step`, `--path`, `--verdict`, `--detail`, `--commits`, `--base` |

Variable d'environnement : `SPAWN_MOTEURS` → `SPAWN_ENGINES`, `SPAWN_CONFIG`, `SPAWN_AGENT`, `SPAWN_OPENCODE_CONFIG` inchangées.

## Contrat des adaptateurs

| Avant | Après |
|---|---|
| `prerequis`, `nouveau-projet`, `preparer-worktree`, `compiler`, `tester`, `capturer`, `lire-journal`, `types-fichiers`, `motifs-git`, `exemple`, `lancer`, `smoke-test` | `prerequisites`, `new-project`, `prepare-worktree`, `compile`, `test`, `capture`, `read-log`, `file-types`, `git-patterns`, `example`, `launch`, `smoke-test` |
| options `--projet`, `--nom`, `--exclure`, `--source`, `--filtre`, `--scene`, `--sortie`, `--images`, `--largeur`, `--hauteur`, `--fichier`, `--scenario`, `--secondes`, `--delai`, `--journaux`, `--moteur` | `--project`, `--name`, `--exclude`, `--source`, `--filter`, `--scene`, `--output`, `--frames`, `--width`, `--height`, `--file`, `--scenario`, `--seconds`, `--timeout`, `--logs`, `--engine` |
| résultat : `contrat`, `moteur`, `commande`, `ok`, `erreurs`, `avertissements`, `artefacts`, `journal`, `donnees` | `contract`, `engine`, `command`, `ok`, `errors`, `warnings`, `artifacts`, `log`, `data` |
| diagnostic : `code`, `message`, `fichier`, `ligne`, `colonne` | `code`, `message`, `file`, `line`, `column` |
| artefact : `type`, `chemin` | `type`, `path` |
| descripteur `adaptateur.json` : `contrat`, `moteur`, `commande`, `domaine` (`produit`, `entree`, `utilisateur`, `cadre`) | `adapter.json` : `contract`, `engine`, `command`, `domain` (`product`, `entry`, `user`, `framing`) |
| données : `total`, `reussis`, `echoues`, `ignores`, `fichiers_verifies`, `scenes_verifiees`, `bout_en_bout`, `version_attendue`, `outils` (`nom`, `present`, `chemin`), `cache` (`aucun`, `copie`, `partage`), `types` (`extension`, `categorie`, `langage`, `ouvrir`), `fichiers`, `lignes`, `secondes` | `total`, `passed`, `failed`, `skipped`, `files_checked`, `scenes_checked`, `end_to_end`, `expected_version`, `tools` (`name`, `present`, `path`), `cache` (`none`, `copy`, `shared`), `types` (`extension`, `category`, `language`, `open`), `files`, `lines`, `seconds` |
| codes d'erreur (`projet-introuvable`, `moteur-introuvable`, `scene-invalide`, `scene-principale-absente`, `scene-principale-vide`, `erreur-execution`, `test-echoue`, `aucun-test`, `test-non-charge`…) | même sens en anglais : `project-not-found`, `engine-not-found`, `invalid-scene`, `main-scene-missing`, `main-scene-empty`, `runtime-error`, `test-failed`, `no-tests`, `test-not-loaded`… |
| scénarios d'exemple (`sain`, `erreur-code`, `erreur-execution`, `test-rouge`, `test-non-charge`, `sans-test`, `scene-invalide`, `sans-scene-principale`, `scene-principale-vide`) | `healthy`, `code-error`, `runtime-error`, `failing-test`, `test-not-loaded`, `no-tests`, `invalid-scene`, `no-main-scene`, `empty-main-scene` |

## Plugin, skills, agents

| Avant | Après |
|---|---|
| skills `tranche`, `tache`, `relecture`, `fin-de-feature` | `story`, `task`, `review`, `finish-story` |
| agents `implementer`, `task-reviewer`, `scene-validator` | inchangés |

## Service et app

| Avant | Après |
|---|---|
| routes `/api/projets`, `/fils`, `/features`, `/conversation`, `/fichiers`, `/fichier`, `/ouvrir`, `/reglages`, `/lancer`, `/moteurs`, `/jeux`, `/modules`, `/evenements` | `/api/projects`, `/stories` (état technique), `/backlog` (vue utilisateur), `/conversation`, `/files`, `/file`, `/open`, `/settings`, `/launch`, `/engines`, `/projects/new`, `/modules`, `/events` |
| modules `projets`, `fils`, `features`, `conversation`, `activite`, `contexte`, `barre-etat`, `fichiers`, `galerie` | `projects`, `stories`, `backlog`, `conversation`, `activity`, `context`, `status-bar`, `files`, `gallery` |
| événements SSE `modules`, `fils`, `conversation`, `conversation-fin`, `feature`, `creation` | `modules`, `stories`, `conversation`, `conversation-end`, `backlog`, `creation` |
| composants `Accueil`, `Jeu`, `Feature`, `Fichiers`, `Menus`, `Conversation` | `Home`, `Game`, `Story`, `Files`, `Menus`, `Conversation` |

## Ajouts de l'étape 1 (contrat des adaptateurs)

- Résultat : `duree_ms` → `duration_ms` ; artefact `rapport-tests` → `test-report` ; Godot `code_sortie_moteur` → `engine_exit_code`.
- Données : `source` de `prerequisites` (`setting`, `search`, `path`, `variable`) ; capture `width`, `height` ; `read-log` `lines` ; `git-patterns` `lockable` ; catégories de fichiers `code`, `scene`, `resource`, `model-3d`, `project`, `text`… ; ouverture `engine`, `editor`, `system`.
- Option `--images` → `--frames`.
- Codes d'erreur (exemples) : `timeout`, `engine-launch-failed`, `syntax-error`, `compile-error`, `script-error`, `resource-not-loaded`, `report-missing`, `scene-not-found`, `project-exists`, `capture-failed`, `version-mismatch`.
- Marqueurs GDScript : `SPAWN-FAILED`, `SPAWN-CHECKED`, `SPAWN-SCENE-FAILED`, `SPAWN-CAPTURE-ERROR`, `SPAWN-SMOKE-ERROR`, `SPAWN-SMOKE-END` ; jeton `--spawn-token=`.
- Adaptateur factice : moteur `fake`, fichier `fake.project` (`main=<fichier>`), cache `.fake-cache` ; adaptateur menteur : `liar`.
- Identifiants principaux : `callAdapter`, `loadAdapter`, `Adapter`, `AdapterResult`, `AdapterDescriptor`, `AdapterDomain`, `validateResponse`, `checkContract`.
- À faire aux étapes suivantes : `~/.spawn/moteurs.json` → `engines.json` (cœur et Godot ensemble), variables `SPAWN_SANS_GODOT` → `SPAWN_NO_GODOT`, `SPAWN_GODOT_RECHERCHE` → `SPAWN_GODOT_SEARCH` ; le fichier de jeu `knowledge/organisation.md` → `knowledge/organization.md` ; libellés français des catégories de fichiers dans l'app.

## Ajouts de l'étape 2 (cœur du kit)

- Hooks (hooks.json) : `reserve`, `start`, `stop`. `spawn engines set`. `--remote none`.
- Fusion : causes de refus `failing`, `empty`, `conflict`, `head-changed`, `import` ; verdicts `queued`, `merged`, `refused`, `error` ; issue de la file `busy`, `empty`, `processed` ; worktree d'intégration `.spawn/merge/integration/` ; `SPAWN_MERGE_FAULT=before-develop` ; ligne de squash `Story-Head:` (l'historique existant garde `Tranche-Tete:`).
- Événements d'agent : `start`, `text`, `tool`, `tool-result`, `subagent`, `usage`, `end` (champs `model`, `text`, `subagent`, `name`, `summary`, `files`, `error`, `excerpt`, `context`, `output`).
- Avancement : étapes `understand`, `breakdown`, `tasks`, `proof`, `acceptance`, `merge` ; états `done`, `current`, `pending`, `parked` ; champs `title`, `state`, `start`, `end`, `tasks`, `number`, `rounds`.
- `spawn next --json` : `step`, `instruction`, `commands`, `proof` (libellés d'étape en français, pour l'agent). `spawn engine` : champ `next`.
- Rapport du pilote : verdicts `merged`, `abandoned`, `max-duration` ; interventions `intent`, `validation`, `acceptance`, `restart`.
- Mesures : `cache_write`, `cache_read`, `by_model`, `parked_tasks`, `remaining_worktrees`, `remaining_feature_branches`.
- Garde : champ de session `streak`. Modèle de projet : `{{GAME_NAME}}`, `{{ENGINE}}` ; `context/objectives.md`, `knowledge/organization.md`. Relecture finale : `final-package.diff`, `final-remaining.md`, `final-report.md`.
- Variables : `SPAWN_NO_GODOT`, `SPAWN_GODOT_SEARCH`, `SPAWN_TRIAL_MODEL`, `SPAWN_TOKEN`.

## Ajouts de l'étape 3 (service et app)

- Connexion : `{port, token}` (première ligne du service, paramètre d'URL `?port=…&token=…`) ; erreurs `{error}`.
- Routes : `/api/projects` (`{dir}`), `/api/projects/new` (`{name, parent, version, engine?, tag?, remote?}`), `/api/engines`, `/api/modules/:id` (`{active}`), `/api/projects/:id/stories[/:story]`, `/api/projects/:id/backlog[/:story]` (`POST {request, agent?}`, `PATCH {title}`, `/approve-spec`, `/answer`, `/request-changes`, `/accept`, `/abandon`), `/settings` (`{agent, localContext}`), `/launch` (`{story?}`), `/context/:agent`, `…/conversation` (`/resume`, `/stop`), `…/files`, `/file?path=`, `/open` (`{access}`).
- Types : `ProjectView`, `StoryView` (groupes `blocked`, `acceptance`, `active`, `history` ; attente `spec-approval`, `question`, `stopped`, `interrupted` ; résultat `accepted`, `abandoned`), `StoryDetail`, `ProgressStep`, `ToolProof`, `ConversationTurn`, `TouchedFile`, `StoryFiles`, `ProjectSettings`, `KnownEngine`, `ModuleState`.
- Événements SSE : `modules`, `stories`, `conversation`, `conversation-end`, `backlog`, `creation`. Modules : `projects`, `stories`, `conversation`, `backlog`, `activity`, `context`, `status-bar`, `files`, `gallery` (les anciens identifiants de `~/.spawn/app.json` sont repris une fois).
- Sur disque : `.spawn/story-meta/<story>.json`, `.spawn/conversations/<story>/state.json`, `turn-N.jsonl` (pilote compris). `localStorage` : `spawn.game` (ancienne clé reprise une fois).
- App : composants `Home`, `Game`, `Story`, `Files`, `Menus`, `Conversation` ; classes CSS en anglais.

## Étape 4 (données existantes), faite le 2026-11-18

- `~/.spawn` : `projets.json` → `projects.json`, `moteurs.json` → `engines.json` (`app.json` : anciens identifiants de modules repris par le service).
- morpion, morpion-local, morpion-lmstudio : `.spawn` converti (stories, ledgers, tâches, story-meta, conversations, journaux → `logs/`, pilote, réglages), file de fusion `.git/spawn/merge`, `spawn.json` `limits` ; `CLAUDE.md` régénéré depuis le modèle et `organization.md`, `objectives.md` renommés, en un commit sur develop. Les branches de feature gardent l'ancien `CLAUDE.md`.
- Couche OpenCode régénérée ; anciens dossiers `spawn-tranche`, `spawn-tache`, `spawn-relecture`, `spawn-fin-de-feature` supprimés.
- Pas de code de migration dans le kit : une donnée à l'ancien format n'est plus lue.
