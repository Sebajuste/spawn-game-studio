# Périmètre du kit

Source : un relevé des pratiques du projet Deep Front, tenu hors de ce dépôt (abrégé `retex`).

## 0. Pourquoi

L'utilisateur veut faire des jeux ; les agents savent écrire le code. Ce qui manque est son attention. Dans Deep Front, elle part dans les permissions, les arbitrages, les relèves, les worktrees, les rouges à juger, et dans l'outillage lui-même (36 % des commits ne touchent que lui, retex §2).

> **L'utilisateur fixe la vision et décide de l'architecture ; il dit ce qu'il veut, puis juge ce qu'il voit. Tout le reste se fait sans lui, et tout ce qu'on lui montre a été vérifié. Le projet ne s'éloigne ni de sa vision ni de son architecture sans qu'il l'ait décidé.**

Reformulé le 2026-11-18 : l'outil sert à développer des projets complets avec des LLM. Le risque n'est pas de perdre le fil des stories, c'est l'érosion : chaque story localement juste, et au bout de cent stories un jeu loin de sa vision et un code sans architecture.

1. **Sans lui.** Entre l'intention et sa validation : aucune permission, relève, fusion, ménage ni rouge à arbitrer.
2. **Vérifié.** Chaque état affiché (vert, relu, terminé, livré) est établi par une vérification de l'outil, jamais par la déclaration d'un agent ; ce qui n'a pas été vérifié est affiché comme non vérifié. « Vert » veut dire que le jeu se lance et remplit ses critères d'acceptation. `develop` se lance toujours sans erreur. Aucune dette n'est cachée. (Reformulé le 2026-11-18 : « vrai » ne disait ni vérifié par qui, ni comment.)
3. **Maîtrisé.** La vision et l'architecture sont écrites, visibles et confrontées à chaque cadrage ; l'architecture est relevée depuis le code par l'outil, pas déclarée par l'agent. Toute sortie de la vision ou changement d'architecture (composant, dépendance, contrat) est une décision soumise à l'utilisateur et enregistrée avec sa raison ; une règle d'architecture cassée bloque la fusion comme un test rouge.
4. **Petit.** L'outillage ne devient pas le projet : chaque brique justifie par une mesure ce qu'elle évite, à la taille du projet où elle sert.

Mesures : interventions de l'utilisateur par feature (cible 0), délai de l'intention au jouable, `develop` vert, part des commits d'outillage.

Toute décision de ce document, et toute décision technique dans un projet, se tranche par ce filtre : si la réponse n'est pas évidente, c'est l'objectif qu'il faut clarifier d'abord.

Conséquence pour l'outillage : **il guide**. Chaque sortie dit quoi faire ensuite (`fichier:ligne`, commande exacte) ; l'outil porte l'enchaînement des étapes et le modèle exécute une étape à la fois. Un modèle qui doit deviner échoue : un petit modèle local d'abord, mais Claude aussi, en tokens et en rounds. Un outillage qui suffit à un modèle de 9B est plus rapide et moins cher pour Claude.

## 1. Décisions (mainteneur, 2026-11-17)

| # | Décision | Pourquoi |
|---|---|---|
| D1 | Une seule convention de worktree, gérée par le kit : création avec import, fusion, nettoyage. Les worktrees créés automatiquement (`.claude/worktrees/`, branches `claude/*`) sont coupés ou rattrapés dans ce même cycle | 85 worktrees créés sans décision, sur une base en retard de 56 commits et sans import (retex §3 n° 10) ; l'utilisateur n'en a jamais créé lui-même |
| D2 | Agents à 100 % de droits sur le dossier du projet : `bypassPermissions`, périmètre tenu par un hook `PreToolUse` (écriture hors projet refusée, courte liste d'actions irréversibles). Plus de `ask`, plus de `deny` sur `git push` ni sur `rm -r` | Les permissions sont la première cause de surveillance (retex §3 n° 1-6) |
| D3 | Relève : orchestrateur léger qui délègue chaque tâche à un agent neuf ; au seuil, compactage automatique guidé par le format de passation, dans la même session ; fichier d'état court écrit à chaque jalon ; session neuve seulement au changement de tâche ou d'approche, lancée par l'app | Une relève recharge un socle d'environ 96 k et attend un humain (retex §3 n° 7, §5) |
| D4 | Pas de Superpowers : nos propres règles et skills, en reprenant ce qui a fait ses preuves (ledger, brief par tâche, relecture à rounds bornés, TDD) | Surcouches contradictoires, forme jugée trop lourde, ~85 % des tâches repassent en correction (retex §5) |
| D5 | Le cycle de vie d'une feature est fermé par le kit : en fin de feature, fusion puis nettoyage du worktree, de la branche, des passations et des notes | 168 worktrees et 850 branches en place (retex §2.2, §7) |
| D6 | Outil générique : un cœur indépendant du moteur et un adaptateur par moteur (Godot d'abord, Unreal plus tard). Chaque projet déclare son moteur dans `spawn.json` ; l'adaptateur est un programme appelé (arguments en entrée, JSON normalisé en sortie) qui respecte `kit/engine-contract.md`, vérifié par une suite de tests de contrat | L'utilisateur veut pouvoir intégrer Unreal ; tout ce qui est propre à Godot dans Deep Front (import, sortie à relire, GUT, captures) passe dans l'adaptateur |
| D7 | Fusion par une file tenue par l'outillage, jamais par un LLM, reprise du circuit de Deep Front et rendue générique : même logique avec ou sans forge (fichiers en local, MR et runner avec GitLab). La preuve d'une branche vaut par suite et par empreinte de ses entrées, pas par tête : un rebase ne rejoue que ce qu'il a changé. Aucun rouge admis : un rouge se corrige ou passe en quarantaine bornée et datée (§9) | Un rebase pour une ligne de `known-reds.txt` a coûté 30 min de suite à refaire ; les rouges admis s'accumulent sans être remis à plat (mainteneur, 2026-11-17). Deep Front a déjà la file sur runner GitLab, la sélection par carte de zones, les gels et la vérification après coup (`tools/ci/`, spec `2026-10-11-fusion-mr-gitlab`) |
| D8 | Le cœur est neutre vis-à-vis de l'agent comme il l'est du moteur (D6) : Claude Code et OpenCode (modèle local compris) sont deux adaptateurs d'agent. Ce qui est propre à un agent (hooks, format des transcripts, installation du plugin, pilotage par l'app) reste dans une couche fine ; l'outil `spawn`, les adaptateurs de moteur, la fusion et l'état des fils ne dépendent d'aucun agent | Le mainteneur, 2026-11-17 : supporter OpenCode quoi qu'il arrive, car l'outillage précis qu'exige un petit modèle (Qwen3.5 9B, 100 k de contexte) profite aussi à Claude. Vérifié le 2026-11-17 (OpenCode v2.2.6, Qwen3.5 9B) : le hook de permission `evaluate` des plugins v2 bloque aussi les sous-agents, contrôle négatif compris (`docs/essais/2026-11-17-opencode-perimetre.md`) ; le périmètre OpenCode passe par lui, pas par `tool.execute.before` (issue #5894, v1) |
| D9 | Architecture généralisable, sans généraliser : le cœur ne nomme pas le domaine qu'il sert. Les mots du jeu vidéo (« jeu », « scène principale », « joueur », le rappel du cadre technique) viennent de la section `domaine` du descripteur de l'adaptateur (`adaptateur.json`), avec des mots neutres par défaut (`kit/core/src/domaine.ts`). Restent propres au jeu, à renommer le jour où un deuxième domaine le justifie : la commande `nouveau-jeu`, le nom de l'outil, les libellés de l'app (« Lancer le jeu ») | Le mainteneur, 2026-11-18 : l'outil peut servir au-delà du jeu vidéo (une app C++ avec un adaptateur CMake) ; pas de généralisation tant qu'un deuxième usage réel ne la justifie (§0, « petit »), mais rien de nouveau ne doit lier le cœur au jeu |
| D10 | L'outil s'appelle **Spawn App Studio** et n'est plus propre au jeu : la commande est 
| D11 | **Proposé, non décidé** : un *workspace* groupe plusieurs projets (un dépôt peut figurer dans plusieurs) ; un epic peut viser plusieurs projets, une story reste dans un seul ; suivi local d'abord (workspaces.json), plugins de suivi (Jira…) plus tard. Détail : docs/workspaces.md | À valider par le mainteneur |
ew-project (
ew-game reste un alias), la route POST /api/projects/new, le composant Project. Les identifiants techniques (spawn-game-studio, spawnstudio, com.sebajuste.spawnstudio) ne changent pas : les renommer casse les installations existantes. L'interface est multilingue (src/i18n.ts, src/locales/), **anglais par défaut, français proposé** (menu Affichage > Langue) | Le mainteneur, 2026-11 : un POC multi-dépôts montre un deuxième domaine (backend Node en Docker) ; remplace la fin de D9 |

## 2. Structure d'un projet créé par le kit

Reprise de Mr. Mak Workspace : un dossier par nature de contenu, et le savoir du projet versionné dans le dépôt plutôt que dans la mémoire globale de l'agent.

```
<jeu>/
  spawn.json         moteur et version (`{ "engine": "godot", "version": "4.7.2" }`)
  CLAUDE.md            règles courtes du projet, ouvertes par « Décider par l'objectif » (§0) ;
                       modèle : kit/core/modele/CLAUDE.md
  context/             vision du jeu, préférences de l'utilisateur, objectifs en cours
  knowledge/           leçons apprises, une note par sujet (remplace la mémoire globale)
  docs/specs/          specs courtes, exigences <TAG>-NN
  docs/adr/            décisions bloquantes, numérotées par outil
  tools/               outillage minimal du kit (copié ou référencé)
  .claude/settings.json  bypass + hooks du kit
  .spawn/              état local, gitignoré, avec un .gdignore (Godot ne l'importe pas)
    fils/<fil>.json    état de chaque fil (contrat de l'app, §4)
    passations/        passations courtes, une par fil
  .claude/worktrees/   worktrees, emplacement natif de Claude Code (gitignoré, avec un .gdignore)
    logs/              journaux de Godot, des tests et des fusions
```

| Repris de Mr. Mak | Effet attendu sur Deep Front |
|---|---|
| Table « où ranger quoi » (`context/`, `knowledge/`, `processes/`) | Les 77 souvenirs `feedback` en mémoire globale deviennent des notes versionnées, relues et partagées par les worktrees |
| Registre unique d'entités avec statut (`workspace.json`) | Modèle de `.spawn/fils/*.json`, lu par l'app |
| Un seul dossier d'état local gitignoré (`.mrmak/`, `inbox/`) | Fin des 40 `.log`/`.patch` épars à la racine de `Godot4\` et des notes dans un dépôt frère |
| « Une leçon fiable → `knowledge/` ; un geste répété → process puis skill » | Une règle apprise devient un réglage ou une skill, pas une ligne de mémoire |

Non repris : contenu en anglais par défaut (les docs restent en français), cartes et rapports HTML (à revoir pour l'app), multi-CLI et synchronisation `.agents/` → `.claude/`.

### Organisation du code et des assets (mainteneur, 2026-11-17)

Principe, commun à tous les moteurs (modèle commun) : **par composant réutilisable, à la manière de React**. Un composant = un dossier qui contient au moins sa scène et son script, ses ressources dédiées et **ses tests** ; les composants sont regroupés par thème. Ce qui est réutilisable est séparé du code du jeu et des assets bruts.

Arborescence Godot (modèle de l'adaptateur ; un autre moteur a la sienne, ex. Unreal `Plugins/`, `Content/`, `Source/`) :

| Dossier | Contenu |
|---|---|
| `addons/` | Réutilisable et lié à l'éditeur (plugins) |
| `libs/` | Réutilisable entre projets, hors éditeur |
| `assets/` | Textures, modèles, sons, polices |
| `core/games/` | Scènes lançables : `main`, scènes de test manuelles |
| `core/actors/` | Objets de gameplay plaçables |
| `core/gui/` | Interface seulement |
| `core/systems/` | Code de jeu ni plaçable ni d'interface : règles, autoloads, systèmes |

Exemple : `core/actors/grille/` contient `grille.tscn`, `grille.gd`, `tests/test_grille.gd`. Vérifié à la compilation par l'adaptateur (un fichier hors composant est signalé, avec où le ranger), d'abord en avertissement.

## 3. Installation de Spawn Game Studio (une fois par machine)

Le dépôt `spawn-game-studio` porte l'app et le kit :

```
spawn-game-studio/
  src/, src-tauri/        l'app
  kit/core/               indépendant du moteur : plugin Claude Code (skills, agents, hooks, commandes),
                          outils (worktree, fusion, ménage, état des fils), modèle de projet commun
  kit/engines/godot/      adaptateur Godot, modèle de projet Godot, règles et skills Godot
  kit/engines/unreal/     plus tard
  kit/engine-contract.md  contrat des adaptateurs (D6)
  .claude-plugin/marketplace.json   le dépôt sert de marketplace locale
```

| Étape | Fait par | Contrôle |
|---|---|---|
| Vérifier les prérequis : git, PowerShell, Godot (version figée par projet), un agent (Claude Code CLI ou OpenCode) ; Node est embarqué par le runtime (SGS-44) ; Rust et Node seulement pour produire le runtime ou compiler une GDExtension | `kit/core/prerequis` + `prerequis` de l'adaptateur | Rapport : présent, version, chemin ; manquant → commande d'installation proposée, jamais lancée sans accord |
| Déclarer la marketplace locale (machine), puis installer et activer le plugin **par projet** (`--scope project`), jamais partout : actif partout, son hook `WorktreeCreate` remplacerait la création de worktrees dans tous les dépôts (Deep Front compris). `.claude/settings.json` est versionné, sinon les worktrees des fils n'ont ni plugin ni périmètre. Pas de `defaultMode` global : l'app lance les sessions en `--permission-mode bypassPermissions` | `spawn prerequis --installer` (plan affiché, appliqué avec `--oui`) | `spawn prerequis` vert depuis un worktree de fil |
| Réglages utilisateur minimaux : rien de propre à un projet dans `~/.claude/settings.json` | idem | Plus de règles `allow` de projet au niveau utilisateur (retex §3 n° 1) |
| Installer l'app (build local ou installeur) | `npm run tauri build` | L'app s'ouvre et liste les projets |

Mise à jour : un `git pull` de Spawn Game Studio puis `claude plugin update` ; les projets reçoivent le plugin à jour sans recopie. Ce qui est copié dans un projet (§4) se met à jour par `spawnstudio mettre-a-jour <projet>`, qui montre le diff avant d'écrire.

## 4. Créer ou adopter un projet

### 4.1 Nouveau jeu : `/nouveau-jeu <nom>` ou bouton « Nouveau projet » de l'app

| # | Étape | Contrôle |
|---|---|---|
| 1 | Demander : nom, dossier parent, version de Godot, préfixe d'exigences (`TAG`), forge et URL du dépôt distant (ou aucun) | — |
| 2 | Copier le modèle commun puis celui du moteur : structure du §2, `spawn.json`, fichiers du moteur (`project.godot` minimal pour Godot), `CLAUDE.md`, `context/` à remplir, `.gitignore`, `.gitattributes`, `.claude/settings.json` | Arborescence conforme |
| 3 | Installer les addons de test (GUT) à la version figée par le kit | Addon présent et activé |
| 4 | `git init -b main`, branche `develop`, règles du §5, premier commit | `git log` montre le commit initial signé `Sebajuste` |
| 5 | Dépôt distant : créer le projet sur la forge si demandé, pousser `main` et `develop`, fixer `origin/HEAD` sur `develop` | `git symbolic-ref refs/remotes/origin/HEAD` = `develop` |
| 6 | Premier import Godot et premier test vide | Sortie de Godot relue : 0 erreur, 1 test vert |
| 7 | Enregistrer le projet dans l'app | Le projet apparaît, sans fil |

### 4.2 Adopter un projet existant (Deep Front) : `/adopter`

| # | Étape |
|---|---|
| 1 | Inventaire en lecture seule : réglages, hooks, agents, outillage, worktrees, branches ; diff avec le kit |
| 2 | Proposer, sans rien écrire : réglages remplacés, outils du kit qui remplacent les outils locaux, ce qui reste local |
| 3 | Après accord : création de `.spawn/` et de `knowledge/`, migration de la mémoire globale vers `knowledge/`, réglages du kit |
| 4 | Ménage des worktrees et branches déjà fusionnés (§5), liste montrée avant suppression |

## 5. Règles git

| Règle | Tenue par |
|---|---|
| `main` = versions publiées ; `develop` = intégration ; une feature = une branche `feature/<fil>` partie de `develop` à jour (`git fetch` d'abord) | Skill `tranche`, outil worktree |
| Une branche = un worktree sous `.claude/worktrees/<fil>` (emplacement natif), import fait à la création | Hook `WorktreeCreate` du kit : toute création (app, `--worktree`, sous-agent) passe par lui |
| `origin/HEAD` pointe sur `develop` | Création du projet, contrôle de `prerequis` |
| Commits en français, moins de 100 mots, auteur `Sebajuste`, aucune attribution IA ; un commit par étape finie et testée | Skill `tache`, hook `commit-msg` |
| `develop` ne reçoit que des fusions de feature, en squash, avec la ligne `Tranche-Tete:`, par la file de fusion (§9) | Outil de fusion |
| Les agents poussent librement leur branche de feature ; jamais de push direct ni de `--force` sur `develop` ou `main` | Hook de périmètre (D2) |
| Interdits partout : `reset --hard` et réécriture d'historique sur une branche partagée | Hook de périmètre |
| Fin de feature : après fusion, suppression du worktree, de la branche locale et distante, de la passation et de l'état du fil (statut `nettoye`) | Skill `fin-de-feature` |
| Ménage hebdomadaire : worktrees et branches dont la tête est déjà dans `develop` ; liste dans l'app, suppression en un geste | Outil de ménage |
| Gros binaires (textures, sons, modèles) : Git LFS selon `.gitattributes` du modèle ; packs achetés (Fab) hors git, chemin déclaré dans `context/` | Modèle de projet |
| `.gitattributes` : fins de ligne fixées (`*.gd`, `*.tscn`, `*.tres` en LF) | Modèle de projet |
| Tags : `vX.Y.Z` sur `main` seulement, sans attribution IA | Skill de publication (plus tard) |

## 6. Briques du kit

| Brique | Origine Deep Front | Simplification exigée |
|---|---|---|
| Réglages de permission + hook de périmètre | `.claude/settings.json`, 106 `allow` utilisateur | Un hook, une liste courte d'irréversibles ; plus aucune règle de permission en mémoire. Il protège le travail d'autrui plutôt qu'un emplacement : un agent détruit librement dans son worktree et sur sa branche, jamais ailleurs (autres worktrees, racine principale, autres branches, stash commun). Il échoue fermé (toute panne sort en 2, `onFailure: "block"`), et chaque refus va dans `.spawn/journal/perimetre.jsonl` pour ajuster les règles sur des données |
| Garde de contexte | `tools/context-guard.ps1` | Au seuil : compactage guidé et mise à jour de l'état du fil, pas de blocage en attente d'un humain |
| Passation et état de fil | `passations-menage.ps1`, `contexte-et-quota.md:16-18` | En-tête JSON obligatoire (§4), corps ≤ 2 k tokens |
| Ledger de plan | `contexte-et-quota.md:20-27` | Un seul emplacement, sous `.spawn/` |
| Skills `tranche`, `tache`, `relecture`, `releve`, `fin-de-feature` | Superpowers + surcouches Deep Front | Courtes, sans cérémonie ; rounds de correction bornés |
| Agents `implementer`, `task-reviewer`, `scene-validator` | `.claude/agents/` | Sans référence à Deep Front |
| Lancement Godot surveillé | `Godot.psm1`, `OutputLog.psm1` | API figée, lecture de la sortie comme seule preuve |
| Worktree + import + nettoyage | `worktree.ps1`, `worktree_remove.ps1`, `import.ps1`, `clean-obsolete-worktrees.ps1` | Un seul outil, appelé par `fin-de-feature` |
| Tests sélectifs par diff | `test.ps1`, `Cibles.psm1`, `Listes.psm1` | Cœur générique séparé des cas Deep Front ; preuve par empreinte (§9) |
| Serveur CI de tests à la demande | `tools/ci/ci-server/` (machines vierges, bundles et LFS, dédoublonnage par commit) | Plus tard : rendu générique, l'adaptateur fournit le moteur à servir |
| File de fusion (§9) | `fusion-mr.ps1`, `tools/ci/gitlab/FileFusion.psm1`, `fusion-job.ps1` + 10 modules, `tests/lists/fusion-map.txt` | Un module du cœur, deux exécuteurs (fichiers, GitLab) ; carte de zones dans le projet |
| Issues de décision | `issue.ps1` | Forge abstraite |
| Traçabilité des exigences | `trace.ps1` | Préfixe de tag paramétrable |
| Règles Godot communes | `Godot4/CLAUDE.md` | Déjà génériques |
| Prérequis et installation | — | `prerequis` (cœur + adaptateur) : contrôle, installe sur accord (§3) |
| Modèle de projet + `/nouveau-jeu` + `/adopter` | — | Crée ou adopte un projet (§4) |
| Hook `commit-msg` et règles git | `Godot4/CLAUDE.md` (attribution) | §5 |

Hors kit (restent dans Deep Front ou abandonnés) : rouges connus (remplacés par la quarantaine bornée, §9), `merge-agent`, `godot-explorer`, `spec-auditor`, `assertion-auditor`, suivi de quota manuel, outils perf, vol, mer et personnages.

## 7. Contrat de données (première version)

`.spawn/fils/<fil>.json`, écrit par les skills et le hook, lu par l'app :

```json
{
  "fil": "caserne-cibles",
  "statut": "actif | compactage | releve-attendue | bloque:decision | termine | nettoye",
  "branche": "tranche/caserne-cibles",
  "worktree": ".claude/worktrees/caserne-cibles",
  "base": "<sha de develop au départ>",
  "tache": "Task 4",
  "premier_geste": "commande ou dispatch exact",
  "sous_agents": ["<id>"],
  "mr": null,
  "maj": "2026-11-17T10:00:00Z"
}
```


## 8. Vérifications dans la doc de Claude Code (2026-11-17)

Sources : `code.claude.com/docs/en/` pages `permissions`, `permission-modes`, `sandboxing`, `settings`, `worktrees`, `hooks`, `env-vars`, `plugin-marketplaces`, `agent-sdk/overview`.

| Point | Constat | Conséquence pour le kit |
|---|---|---|
| Origine des 85 worktrees | Sessions parallèles de l'app de bureau, `--worktree`, sous-agents `isolation: worktree` : création sous `.claude/worktrees/`, base `worktree.baseRef = "fresh"` = branche par défaut du distant (`origin/HEAD`). Un `WorktreeCreate` hook remplace la création (imprime le chemin sur stdout ; échec = création refusée). Balayage auto des worktrees de sous-agents propres après `cleanupPeriodDays` | D1 : `origin/HEAD` → `develop` à la création du projet ; hook `WorktreeCreate` du kit (git worktree + import Godot) ; emplacement natif gardé |
| Bac à sable sous Windows | « On native Windows, Claude Code runs commands unsandboxed » (WSL2 seulement) | D2 : le hook de périmètre est nécessaire pour le shell |
| Mode par défaut | `bypassPermissions` et `auto` sont ignorés dans `.claude/settings.json` et `settings.local.json` du projet : seulement utilisateur, managed ou `--permission-mode` | D2 : le kit écrit `defaultMode` dans `~/.claude/settings.json`, ou l'app lance les sessions avec `--permission-mode bypassPermissions` |
| `deny` en bypass | « Deny rules block in every mode, including `bypassPermissions` » ; un hook `PreToolUse` en sortie 2 bloque avant l'évaluation des permissions | D2 : `deny` courts + hook ; les deux tiennent en bypass |
| Écritures hors projet | `permissions.blockWritesOutsideWorkingDirectories` (v2.1.314+) bloque `Write`/`Edit` hors des dossiers de travail en tout mode, mais pas le shell ; il retire aussi `EnterWorktree` | D2 : à activer pour les outils fichiers ; le hook couvre le shell ; worktrees lancés par `--worktree` ou l'app |
| Chemins protégés | En bypass, écritures dans `.git` et `.claude` autorisées sans question | Le hook de périmètre garde les actions git irréversibles (§5) |
| Compactage | `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (100 k à 1 M) fixe le seuil ; `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` l'abaisse ; un hook `PreCompact` : son stdout devient les consignes du résumé ; `SessionStart` avec `source = compact` réinjecte du contexte | D3 faisable tel quel : fenêtre ~260 k, `PreCompact` imprime le format de passation, `SessionStart(compact)` réinjecte `.spawn/fils/<fil>.json` |
| Marketplace locale | `claude plugin marketplace add <dossier>` puis `claude plugin install <plugin>@<marketplace>` ; source relative lue directement : une modification prend effet au démarrage suivant ou par `/reload-plugins`, sans changer de version | §3 confirmé ; pas de copie à synchroniser |
| Agent SDK | Clé API exigée ; « Anthropic does not allow third party developers to offer claude.ai login » | L'app pilote le CLI officiel (`claude -p --output-format stream-json`, `--resume`, `--permission-mode`) avec ton propre compte : messages structurés, sans lire l'écran |
| Git LFS | Les worktrees créés par Claude Code ont des fichiers pointeurs si LFS est installé en `--local` ; `git lfs install` global n'est pas touché | §5 : LFS installé en global ; le hook `WorktreeCreate` lance `git lfs pull` |
| Mesure de référence Superpowers | Non faite (nécessite `token-report.ps1` sur Deep Front) | À faire au début du pilote |

## 9. Fusion et rouges (D7)

Repris de Deep Front (`tools/ci/`, `docs/agents/fusion.md`, spec `2026-10-11-fusion-mr-gitlab-design.md`), rendu générique. Ce qui change est marqué **nouveau**.

### 9.1 Circuit

| Règle | Détail |
|---|---|
| L'agent s'inscrit et s'arrête | Dès sa preuve verte, même si `develop` a avancé entre-temps : **nouveau**, plus de refus ni d'intégration de `develop` par l'agent avant l'inscription. Il n'est rappelé que sur un refus |
| Une seule logique, deux exécuteurs | Module `fusion` du cœur : tête de file, rebase, sélection, jugement, squash, refus. L'exécuteur ne fait que porter la file et lancer les tests |
| Exécuteur fichiers (projet sans forge) | **Nouveau.** Une inscription = un fichier JSON sous `<git-common-dir>/spawn/fusion/file/` (fil, branche, tête, preuve, date) ; décisions ajoutées à `journal.jsonl` (inscrite, prise, fusionnée, `refusee:<cause>`), lu par l'app. Le traiteur est un programme sans LLM : lancé par l'inscription s'il ne tourne pas, verrou par PID et signe de vie, `develop` avancé en dernier par `update-ref` (un traiteur tué ne laisse rien à moitié) |
| Exécuteur GitLab | Repris tel quel : MR étiquetée `file`, job `fusion` sur un runner dédié, un à la fois, enchaîné, planification de reprise, fusion squash par l'API avec `sha` = tête vérifiée |
| Ordre, gels, dépendances | Repris : plus ancienne inscription d'abord ; `gel:<zone>` ; `après <inscription>` |
| Sélection | Repris : socle, tests touchés, suites des zones que le diff atteint, d'après la carte de zones du projet (`motif \| suites \| raison`, comme `fusion-map.txt`) |
| Refus | Repris : la branche reste, la cause et le détail sont écrits (note de MR ou journal), le fil est prévenu par son état (`.spawn/fils/`) |
| Vérification après coup | Repris : suite complète sur `develop` après les fusions, une seule demande en attente qui couvre les fusions accumulées |

### 9.2 Preuve par empreinte (nouveau, à l'échelle de Deep Front)

Sur un petit projet, la suite dure quelques secondes : chaque fusion la rejoue en entier, c'est plus simple et aussi sûr (§0, « petit »). L'empreinte vient avec l'adoption de Deep Front, où une suite rejouée coûte 30 min.

- La preuve d'une branche est une liste de suites vertes, chacune avec l'**empreinte de ses entrées** : le contenu des fichiers que la carte de zones lui attribue, plus le socle (moteur, version, réglages du projet).
- Après un rebase ou un conflit résolu, seules les suites dont l'empreinte a changé sont rejouées, par le traiteur et non par l'agent. Une résolution dans un fichier qu'aucune suite ne lit ne rejoue rien.
- Une suite dont les entrées ne sont pas connues (fichier sans règle dans la carte) est rejouée : le doute coûte du temps, jamais de la fiabilité.
- Contrôle négatif : un rebase qui modifie une entrée d'une suite prouvée la fait rejouer ; un rebase qui ne touche qu'un fichier hors carte ne rejoue rien.

### 9.3 Aucun rouge admis (nouveau)

- Plus de liste de rouges connus ni de « rouges hérités admis » : un rouge sur la tête vérifiée refuse la fusion, quelle que soit son origine.
- Si le rouge vient de `develop`, c'est `develop` qui est cassé : la vérification après coup désigne la fusion fautive, sa zone est gelée et une issue de correctif prioritaire va au fil qui l'a introduite. Les autres zones continuent de fusionner.
- Seule échappatoire : la **quarantaine**, posée dans le test lui-même (marqueur avec numéro d'issue et date limite), jamais dans un fichier partagé. Plafond par projet (5 par défaut) ; une quarantaine échue redevient un rouge ; l'app affiche le compte.
- Pas de fichier partagé en ajout seul dans le flux de fusion (registres, listes de rouges) : une entrée par fichier. Ce sont des aimants à conflits.

### 9.4 Ouvert

- Fusion fautive sur `develop` : correction en avant seule (Deep Front) ou annulation automatique si le correctif n'arrive pas dans un délai ?
- Mesurer sur les artefacts `fusion.json` des jobs GitLab de Deep Front (depuis le 2026-10-11) la part des refus `conflit` et `rouge`, et le temps de preuve rejoué après un rebase. Ancien circuit local (174 journaux, 5-11 octobre) : 67 fusions, 49 refus `rouge`, 19 `conflit`, vérification médiane 14 min, 90e centile 36 min.
