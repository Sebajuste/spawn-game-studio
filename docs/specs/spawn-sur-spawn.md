# Spawn développé avec Spawn : le minimum (spec, 2026-11-18)

Objectif : reprendre le développement de Spawn Game Studio avec Spawn lui-même. On développe à la main seulement ce qu'il faut pour cela ; le reste (phase 5 bis, maquette `docs/maquettes/app.html`) devient le premier backlog de Spawn, mené par l'outil. Les commits et les tags servent de sauvegarde si quelque chose se passe mal.

Préfixe d'exigences du dépôt : `SGS`. Quatre stories, dans cet ordre.

Constat qui motive la story 1 (2026-11-18, corrigé après vérification) : Claude Code lit le plugin directement dans le dépôt (`claude plugin list --json` : `readFromFolder` = `kit/core` du dépôt ; la copie 0.1.0 de son cache n'est pas lue). La couche OpenCode, les commandes données aux agents et l'app pointent aussi sur le dépôt. Rien n'est figé : un agent qui modifie le dépôt modifie l'outil qui le guide.

---

## Story 1 : le runtime, une version figée hors du dépôt

**Résultat attendu.** Une commande installe une version de Spawn hors du dépôt, dans `~/.spawn/runtime/<version>/`. Claude Code, OpenCode, les commandes données aux agents et l'app utilisent tous cette version. Modifier le dépôt ne change rien à ce qui tourne tant qu'une nouvelle version n'est pas installée. On revient à une version précédente en une commande.

**Critères d'acceptation.**

- **SGS-01** `spawn runtime install`, lancé depuis le dépôt, copie dans `~/.spawn/runtime/<version>/` le kit (`kit/core`, `kit/engines`), le service et leurs dépendances de production, en gardant la disposition du dépôt. La version est `<version de package.json>+<commit court>` (ex. `0.1.0+1b13ecf`).
- **SGS-02** L'installation refuse un dépôt modifié et non commité (rien n'est installé qui ne soit dans un commit), et refuse si les vérifications du dépôt échouent (typecheck, lint, tests du kit et du service). Le commit installé reçoit le tag `runtime-<version>`.
- **SGS-03** L'installation construit l'app (Tauri, en mode release) et place son exécutable dans le runtime. Lancée, cette app démarre le service **du runtime**, jamais celui du dépôt.
- **SGS-04** Claude Code : l'installation met à jour la marketplace locale pour qu'elle désigne le runtime, puis réinstalle le plugin (sa version change à chaque installation, pour que Claude Code reprenne la copie). Si cela ne peut pas se faire en ligne de commande, l'outil donne les commandes exactes à taper dans Claude Code, et `spawn runtime status` signale le plugin périmé tant que ce n'est pas fait.
- **SGS-05** OpenCode : la couche (plugin de périmètre, skills, agents) est régénérée depuis le runtime ; tous ses chemins désignent le runtime.
- **SGS-06** Exécuté depuis n'importe quelle copie (runtime ou cache du plugin de Claude Code), le kit trouve les adaptateurs de moteur et donne aux agents des commandes qui désignent le runtime actif. Aucune commande donnée à un agent ne désigne le dépôt ni une copie incomplète.
- **SGS-07** `spawn runtime status` montre la version active, son commit, les versions installées, et pour chaque composant (Claude Code, OpenCode, app, commandes des agents) ce qu'il exécute réellement ; tout composant qui désigne le dépôt, une autre version ou une copie périmée est signalé, avec la commande pour corriger.
- **SGS-08** `spawn runtime use <version>` rend active une version déjà installée (retour en arrière), avec les mêmes mises à jour qu'à l'installation (SGS-03 à SGS-05). Les trois dernières versions sont gardées.
- **SGS-09** L'installation et le changement de version refusent pendant qu'un agent du runtime actif travaille (service avec une conversation en cours, ou pilote lancé), en disant lequel.
- **SGS-44** (décidé le 2026-11-18) L'installation embarque dans la version le Node qui l'exécute (`<version>/node/`). L'app démarre le service avec ce Node, les hooks du plugin Claude Code et le plugin de périmètre d'OpenCode le lancent par son chemin, et les agents lancés par l'app l'ont en tête de leur PATH : Spawn tourne sans Node installé. Seule la machine qui produit le runtime a besoin de Node, npm et Rust.
- **SGS-45** (décidé le 2026-11-18) Le modèle local d'OpenCode est un réglage du projet (`localModel`), servi par LM Studio (`lmstudio/<modèle>`) ou par Ollama (`ollama/<modèle>`). Avant le premier tour, l'outil vérifie que le serveur répond, que le modèle est là et chargé (il le charge à la demande) ; pour Ollama, il refuse un contexte chargé plus petit que le réglage du projet et dit comment l'agrandir, parce qu'Ollama couperait les consignes de l'agent sans le dire.

**Hors périmètre.** Distribution sur une autre machine (archive, installeur) ; mise à jour automatique ; commande `spawn` dans le PATH de l'utilisateur  ; une session d'agent ouverte hors de l'app (terminal) utilise le `node` de la machine pour les commandes `spawn`.

---

## Story 2 : un adaptateur Node

**Résultat attendu.** Un projet Node et TypeScript (Spawn le premier) se compile, se teste, se lance et se capture par `spawn engine`, avec le même contrat que Godot (`kit/engine-contract.md`), vérifié par la suite de contrat. Rien de propre à Spawn dans l'adaptateur : le projet déclare ses commandes dans `spawn.json`.

**Critères d'acceptation.**

- **SGS-10** L'adaptateur `kit/engines/node` se déclare avec le contrat 1, le moteur `node` et un domaine d'application : produit « app », point d'entrée « point d'entrée de l'app », utilisateur « utilisateur », cadre « tout se fait avec la pile du projet (TypeScript, React, Rust pour la coque), selon ses conventions ».
- **SGS-11** Le projet déclare ses commandes dans `spawn.json`, section `node` : scripts npm de `compile` (liste), `test`, `smoke-test`, `launch`, l'URL et la page à capturer, et le motif des tests de bout en bout. L'adaptateur ne lance que ces scripts ; une commande non déclarée est un échec qui dit quoi ajouter à `spawn.json`.
- **SGS-12** `prerequisites` vérifie Node (version majeure de `spawn.json`), npm, et que les dépendances sont installées ; sinon il dit la commande exacte (`npm ci`).
- **SGS-13** `prepare-worktree` rend un worktree utilisable : il reprend les dépendances du projet principal si `package-lock.json` est identique (`cache: shared`), sinon lance `npm ci` (`cache: none`).
- **SGS-14** `compile` lance les scripts déclarés ; chaque erreur porte `file` et `line` quand l'outil les donne (formats de tsc, eslint, cargo).
- **SGS-15** `test` lance le script déclaré et rend `total`, `passed`, `failed`, `skipped` (sortie du lanceur de tests de Node), et les noms des tests en échec ; `end_to_end` liste les tests dont le fichier correspond au motif déclaré. Zéro test est un échec (`no-tests`).
- **SGS-16** `smoke-test` lance le script déclaré (pour Spawn : le service démarre sur un port libre et répond, l'app se construit) ; un code de sortie non nul ou un dépassement de `--seconds` est un échec, avec le journal.
- **SGS-17** `launch` lance l'app du dossier donné (le worktree d'une story) détachée, sur un port libre, et rend `pid` et l'URL ; l'arrêt se fait par ce `pid`, jamais par nom de processus.
- **SGS-18** `capture` ouvre l'URL déclarée (ou `--scene`, une route de l'app) dans Edge sans fenêtre et enregistre une image PNG ; Edge absent est un échec qui le dit.
- **SGS-19** `file-types` et `git-patterns` couvrent la pile (`.ts`, `.tsx`, `.rs`, `.css`, `.json`, `.md` ; `node_modules/`, `dist/`, `target/` ignorés).
- **SGS-20** La suite de contrat passe pour l'adaptateur Node. Les scénarios propres aux scènes (`invalid-scene`, `empty-main-scene`) sont déclarés non applicables par l'adaptateur, et la suite de contrat l'accepte (évolution du contrat, compatible avec Godot).

**Hors périmètre.** La commande `architecture` (phase 5 bis) ; `new-project` pour Node ; yarn et pnpm ; un autre navigateur qu'Edge.

---

## Story 3 : préparer le dépôt de Spawn

**Résultat attendu.** Le dépôt de Spawn est un projet Spawn : il s'ouvre dans l'app (celle du runtime), une story s'y crée, s'y développe dans un worktree et se fusionne dans `develop`.

**Critères d'acceptation.**

- **SGS-21** Branche `develop` créée depuis `main` ; `main` ne reçoit plus que les versions livrées.
- **SGS-22** `spawn.json` : moteur `node`, version `24`, préfixe `SGS`, limites, section `node` (SGS-11) : `compile` = typecheck et lint, `test` = tests du kit et du service, `smoke-test` = service et construction de l'app, `launch` = app de dev sur un port libre, tests de bout en bout = `service/test/service.test.ts`.
- **SGS-23** `CLAUDE.md` du dépôt : l'objectif (§0), les conventions (noms techniques en anglais, commentaires et textes en français, organisation par composant), et la règle : le cœur du kit (périmètre, vérifications, `spawn next`, ledger, fusion) n'est modifié que par le mainteneur et Claude hors de Spawn, jamais dans une story.
- **SGS-24** `.spawn/` ignoré par git ; le projet inscrit dans `~/.spawn/projects.json` ; `spawn prerequisites` et `spawn engine compile` réussissent depuis le runtime.
- **SGS-25** Le dépôt distant se règle **par projet** : c'est le dépôt distant git du projet (`origin`), que Spawn lit et utilise pour pousser `develop` et les tags ; aucun serveur n'est écrit en dur dans le kit. Pour Spawn : le dépôt GitHub `Sebajuste/spawn-game-studio`. Sans dépôt distant, la fusion reste locale.

**Hors périmètre.** Régler le dépôt distant depuis l'app (Réglages du projet, phase 5 bis) ; une commande `adopter` pour un projet existant (fait à la main ici) ; l'intégration des issues GitLab.

---

## Story 4 : premier essai

**Résultat attendu.** Une petite story de l'app est menée par Spawn, sur son propre dépôt, depuis l'app du runtime, de la demande à la fusion dans `develop`, sans que l'outil tourne sur le code qu'il modifie.

**Critères d'acceptation.**

- **SGS-26** La demande : « Dans la barre de menus, renommer le menu “Jeu” en “Projet” » (maquette `docs/maquettes/app.html`). Menée depuis l'app du runtime, agent Claude Code.
- **SGS-27** Pendant tout l'essai, chaque commande d'agent et chaque hook exécute le runtime (vérifié par `spawn runtime status` et par le journal du périmètre), et le dépôt principal reste sur `develop`, propre.
- **SGS-28** La recette montre la preuve de l'outil (compilation, suite de tests existante, smoke test, le test de bout en bout existant) et une capture de l'app avec le menu « Projet ». La spec de la story dit la preuve de chaque exigence (pour un libellé : la capture) ; aucun test ni outillage de test n'est ajouté pour cette story. Corrigé après le premier lancement du 18/11 : l'ancienne rédaction (« au moins un test de bout en bout ») et l'absence de preuve par exigence ont mené l'agent à bâtir un pilote d'Edge pour tester un libellé.
- **SGS-29** Après acceptation : la story est fusionnée dans `develop`, worktree et branche nettoyés, et `develop` passe toutes les vérifications.
- **SGS-30** Mesures relevées dans `docs/essais/` : interventions de l'utilisateur, durée, tokens, rounds, et tout ce qui a demandé une correction à la main.

**Hors périmètre.** Livrer une version de Spawn par Spawn (vient avec la phase 5 bis).
