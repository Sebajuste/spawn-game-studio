# Ajouter un projet existant : l'adoption (validé le 2026-11-21)

> Remplace le `/adopter` de `kit-perimetre.md` §4.2 pour l'app. Réglages et fenêtres : `reglages.md`. Contrat : `kit/engine-contract.md` (`detect`, `adopt`). Maquette : `docs/maquettes/reglages.html` (écrans 4 et 5).

## 1. But

Spawn sert d'abord à des projets qui existent déjà. Ajouter un dossier doit suffire : Spawn dit ce qui lui manque, l'installe après accord, et le projet est prêt pour une première story. Rien n'est écrasé, rien n'est poussé, rien n'est caché.

## 2. Parcours

« Ajouter un projet existant… » : menu Fichier (Ctrl+O), sélecteur de portée, premier lancement, Réglages > Workspace > Projets > Ajouter. Lancé depuis un workspace, le projet y est ajouté à la fin.

1. **Choisir le dossier.** Déjà un projet Spawn (`spawn.json`) : il est inscrit, c'est fini.
2. **Diagnostic, en lecture seule.** La fenêtre « Adopter *nom* » montre chaque point : ✓ déjà là, + à ajouter, ~ à compléter, ⚠ à savoir, ⛔ bloquant. Le moteur, sa version et le préfixe d'exigences sont proposés et modifiables ; les lignes du moteur viennent de son adaptateur (`adopt --dry-run`).
3. **Adopter.** Le bouton est actif s'il n'y a aucun ⛔. Les étapes s'affichent pendant qu'elles se font, puis le résultat : le commit, la suite de tests de départ (même rouge : elle est dite, pas cachée), les manques laissés à faire.

## 3. Ce que le cœur vérifie et fait

| Point | Diagnostic | Adoption |
|---|---|---|
| Dépôt git | ⛔ pas un dépôt (commande `git init` dite : on ne commite pas d'office les fichiers de quelqu'un) ; ⛔ tête détachée | — |
| Arbre de travail | ⛔ modifications non commitées (listées) : on ne mêle pas un travail en cours au commit d'adoption | — |
| `develop` | ✓ existe ; + créée depuis la branche courante | extraite |
| Dépôt distant | ⚠ `origin/HEAD` ne pointe pas sur `develop` (rien n'est poussé, la commande est dite) | — |
| Moteur | proposé par `detect` de chaque adaptateur (le premier qui reconnaît le dossier) ; ⛔ aucun | — |
| `spawn.json` | + moteur, version, préfixe, limites | écrit, puis complété par l'adaptateur |
| Fichiers du moteur | lignes de `adopt --dry-run` | `adopt` |
| `.gitignore` | + lignes du kit et du moteur qui manquent | ajoutées à la fin, rien de retiré |
| `.gitattributes` | jamais touché sur un projet existant | — |
| Hooks git | ✓ `core.hooksPath` du kit ; ⛔ un autre `core.hooksPath` ou un dossier `.husky/` : à trancher par une personne | réglé (configuration locale) |
| Plugin | + spawnstudio pour ce projet, seuil de compactage | installé et activé ; `.claude/settings.json` complété, pas remplacé |
| Suite de départ | — | `prepare-worktree` puis `test` : résultat affiché, jamais bloquant |
| Commit | — | un seul, « spawn : adoption », sur `develop`, rien de poussé |
| Inscription | — | registre de l'app ; ajout au workspace s'il y a lieu |

Le diagnostic est refait juste avant d'adopter : un dossier modifié entre-temps est refusé avec le nouveau diagnostic.

## 4. Ce que fait l'adaptateur

Chaque moteur pose **son** gabarit, sans rien écraser (`adopt`) ; un fichier qui existe déjà est gardé tel quel.

- **Godot** : `detect` reconnaît `project.godot` et lit la version de `config/features`. `adopt` installe GUT (version figée) s'il manque et l'active dans `project.godot`, écrit `.gutconfig.json` s'il manque, un `.gdignore` dans les dossiers exclus (`.spawn`, `.claude`), et un premier test seulement si le projet n'en a aucun.
- **Node (applications web et services)** : `detect` reconnaît `package.json` ; la version vient de `engines.node`, puis `.nvmrc` ou `.node-version`, puis du Node de la machine. `adopt` garde `package.json` et remplit la section `node` de `spawn.json` depuis ses `scripts` (`typecheck`, `lint`, `build` → compile ; `test` → test ; `dev` ou `start` → launch ; `smoke` → smoke_test). Sans script de test, il ajoute un test `node:test` minimal et son script. Ce qu'il ne sait pas déclarer est rendu dans `gaps` (ex. pas de script de lancement, lancement qui n'écrit pas `SPAWN-URL`).
- Le `test` de l'adaptateur node lit la sortie du lanceur de Node, de **Vitest** et de **Jest** : un projet existant garde son lanceur.

## 5. Découverte des moteurs

Le service liste les adaptateurs présents (`kit/engines/*/adapter.json`, qui gagne un `title`). « Nouveau projet » et « Ajouter un projet existant » proposent ces moteurs ; plus de moteur écrit en dur dans l'app.

## 6. Code

| Où | Quoi |
|---|---|
| `kit/core/src/adopt/` (hors cœur) | un fichier par vérification (`git.ts`, `engine.ts`, `files.ts`, `hooks.ts`), `diagnose.ts` (lecture seule), `adopt.ts` (les étapes) |
| `kit/engines/node`, `kit/engines/godot` | `detect`, `adopt` ; lecteurs Vitest et Jest (node) |
| `service/src/modules/projects.ts` | `GET /api/adapters`, `POST /api/projects/diagnose` `{ dir }`, `POST /api/projects/adopt` `{ dir, engine, version, tag, workspace? }` (étapes poussées par l'événement `adoption`) |
| `src/adopt/` | la fenêtre, une ligne par point, le journal |

## 7. Décisions (2026-11-21)

1. Le cœur fait ce qui est commun (git, `spawn.json`, hooks, plugin, commit) ; le gabarit est celui du moteur, posé par son adaptateur. Deux sous-commandes au contrat : `detect`, `adopt`.
2. L'adaptateur node lit Vitest et Jest en plus du lanceur de Node.
3. Pas de commande `spawn adopt` dans la CLI (cœur) : l'adoption se fait depuis l'app.
4. Restent à décider : la liste des adaptateurs copiés dans le runtime, écrite en dur dans `kit/core/src/runtime.ts` (cœur) ; plusieurs gabarits par moteur (`templates[]`, `new-project --template`).
