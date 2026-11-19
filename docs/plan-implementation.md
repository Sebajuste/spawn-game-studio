# Plan d'implémentation de Spawn Game Studio

Sources : `docs/kit-perimetre.md` (objectif §0, décisions D1 à D7), `docs/ux-reference-mrmak.md` et le relevé Deep Front (`retex`, hors dépôt).
Deep Front n'est pas touché. Les essais se font sur un mini projet jetable.

## Principes

- Chaque élément du plan passe le filtre de `kit-perimetre.md` §0 : il retire une intervention de l'utilisateur, rend un vert plus vrai, ou il attend que la taille d'un projet le justifie.
- Une phase = un livrable testé et validé par le mainteneur, puis un commit ; pas de commit en cours de boucle.
- Chaque phase a un critère de fin mesurable. Toute mesure a un contrôle négatif : un adaptateur factice, une commande qui doit être refusée, un fil dans un état faux.
- Le cœur et l'app ne connaissent aucun moteur. Tout ce qui est propre au moteur passe par le contrat (D6).
- Langage : le cœur et l'adaptateur Godot sont en TypeScript sur Node 22+, comme l'app. Raisons : multiplateforme, testable avec `node --test`, types partagés avec l'app (schéma des fils, résultats d'adaptateur). Les adaptateurs restent des programmes indépendants : un futur adaptateur peut être écrit dans un autre langage.

## Phase 0 : socle du dépôt

- Arborescence `kit/core/`, `kit/engines/godot/`, `kit/engine-contract.md`, `.claude-plugin/marketplace.json`.
- Espace de travail npm (app, cœur, adaptateur Godot), TypeScript strict, `node --test`, lint.
- Fin : `npm test` vert sur un test témoin et un test qui échoue volontairement quand on casse le témoin.

## Phase 1 : contrat moteur et adaptateur Godot

- `engine-contract.md` : commandes `prerequis`, `nouveau-projet`, `preparer-worktree`, `compiler`, `tester`, `capturer`, `lire-journal`, `types-fichiers`, `motifs-git` ; entrée par arguments, sortie JSON normalisée (`ok`, `erreurs[]`, `artefacts[]`, `journal`). Écrit avec le tableau Godot/Unreal sous les yeux : verrous LFS, worktrees lourds et caches partagés prévus dès maintenant.
- Schémas JSON des sorties, partagés avec l'app.
- Suite de tests de contrat, lancée contre l'adaptateur Godot et contre un **adaptateur factice** (contrôle négatif : un adaptateur qui ment sur `ok` doit être pris en défaut).
- Adaptateur Godot : lancement surveillé (relecture de la sortie : `SCRIPT ERROR` = échec même en code 0), import, GUT, capture d'image, types de fichiers (`.gd`, `.tscn`, `.tres`, `.gdshader`), motifs git (`.godot/`, `.gdignore`).
- Fin : contrat vert pour les deux adaptateurs ; un script GDScript en erreur produit `ok: false` alors que Godot sort en 0.

## Phase 2 : cœur

- `spawn.json` lu et validé ; choix de l'adaptateur.
- État des fils `.spawn/fils/<fil>.json` : schéma, écriture atomique, transitions autorisées (`actif` → `compactage` → `actif`, `termine` → `nettoye`…), refus des transitions interdites.
- Hook de périmètre `PreToolUse` : écritures hors projet refusées, liste courte d'irréversibles (`push --force`, `reset --hard` sur une branche partagée, push direct sur `develop`/`main`, kill par nom). Tests : une table de commandes permises et refusées, y compris des formes détournées (`git -C`, PowerShell, chemins relatifs).
- Hooks `WorktreeCreate` / `WorktreeRemove` : `git worktree add` depuis `develop` à jour, `git lfs pull`, `preparer-worktree` de l'adaptateur ; suppression propre.
- Hook git `commit-msg` : refus de toute attribution IA.
- Fin : tests verts ; en bypass réel, une écriture hors projet et un `push --force` sont bloqués.

## Phase 3 : plugin Claude Code

- Marketplace locale, plugin `spawnstudio` : skills `tranche`, `tache`, `relecture`, `fin-de-feature` ; agents `implementer`, `task-reviewer`, `scene-validator` (génériques, appellent l'adaptateur) ; hooks du cœur ; hooks `PreCompact` (consignes au format de passation) et `SessionStart(compact)` (réinjecte l'état du fil).
- Contrôle que les hooks du kit sont actifs dans le projet (démarrage de session et `prerequis`), alerte sinon : un périmètre absent ne doit pas passer inaperçu. Ménage des worktrees de sous-agents, que Claude Code ne supprime jamais.
- `prerequis --installer` : marketplace (machine), plugin installé et activé par projet, `CLAUDE_CODE_AUTO_COMPACT_WINDOW` dans les réglages du projet, plan montré avant écriture. Ni `defaultMode` ni réglage global (voir `kit-perimetre.md` §3).
- Fin : `claude plugin list` montre le plugin ; un compactage forcé (`/compact`) produit un résumé au format attendu et la session reprend sa tâche.

## Phase 4 : `/nouveau-jeu` et essai de bout en bout

- `/nouveau-jeu` : modèle commun + modèle Godot (`.claude/settings.json` du kit dans le commit initial, `.spawn/` ignoré, préfixe d'exigences `TAG` rangé dans `spawn.json`), `git init` (`main`, `develop`), dépôt distant **local** (dépôt nu) pour l'essai, `origin/HEAD` sur `develop`, premier import, premier test.
- Fusion v1 sans forge (§9 de `kit-perimetre.md`), à la taille d'un petit projet : module `fusion` du cœur et exécuteur fichiers ; inscription dès la preuve verte, traiteur sans LLM sous verrou, rebase, suite complète, squash sur `develop` avec `Tranche-Tete:`, puis `fin-de-feature`. Aucun rouge admis. Contrôles négatifs : deux inscriptions simultanées, une fusion intermédiaire qui casse une branche déjà prouvée (refus), un traiteur tué en pleine fusion (`develop` intact).
- Essai sur un mini projet jetable : un morpion à deux joueurs sans IA (`C:\Dev\morpion`, créé par `spawn nouveau-jeu`), mené par les agents de la spec au nettoyage.
- Mesures : nombre d'interventions de l'utilisateur (cible : 0 hors validation finale), tokens consommés, rounds de correction, worktrees et branches restants après nettoyage (cible : 0).
- Fin : mesures notées dans `docs/essais/` ; projet jetable supprimable sans trace.

## Phase 4 bis : outillage qui guide, agent neutre (D8)

Avant l'app, parce que l'app pilote un agent et ne doit pas en supposer un seul.

- Corrections de l'essai du morpion (`docs/essais/2026-11-17-morpion.md`) : moteur trouvé sans variable d'environnement (`~/.spawn/moteurs.json`, recherche de la version du projet), section `limites` de `spawn.json` appliquée par hooks.
- `spawn suivant` : lit l'état du fil, le ledger et le plan, rend **une** action exacte (commande ou dispatch, fichiers, preuve attendue). Les skills deviennent des listes courtes qui s'appuient dessus.
- Chaque sortie de l'outil et de l'adaptateur porte un champ « ensuite ». Budget de contexte et taille des tâches réglables par projet (section `limites`).
- Adaptateur d'agent : la couche propre à Claude Code isolée (hooks, transcripts, installation) ; adaptateur OpenCode (plugin `tool.execute.before` pour le périmètre, worktrees créés par `spawn`, lecteur de transcripts pour `spawn mesure`). Contrôle négatif d'abord : un sous-agent OpenCode qui tente une action interdite doit être bloqué.
- Organisation par composant (`kit-perimetre.md` §2) : principe dans le modèle commun, arborescence Godot créée par `nouveau-projet` avec `knowledge/organisation.md`, tests GUT découverts dans les dossiers de composants, vérification à la compilation (avertissement avec « ensuite »). Cas d'essai : réorganiser le morpion par une feature menée par les agents.
- Fin : la même feature du morpion menée avec OpenCode et Qwen3.5 9B, mesures comparées à l'essai Claude (interventions, rounds, tokens, réussite) dans `docs/essais/`.

## Phase 5 : app v1, suivre et parler aux fils

- Liste des projets (`spawn.json`), onglets groupés par jeu, un onglet par fil, non-lu.
- Conversation pilotée par l'adaptateur d'agent (D8) : `claude -p --output-format stream-json --resume --permission-mode bypassPermissions` pour Claude Code, son équivalent pour OpenCode ; Terminal en secours.
- Ligne d'activité (sous-agents, commandes), jauge de contexte avec seuil de compactage, barre d'état (modèle, branche, worktree).
- Coupure (PC ou app arrêtés) sans perte : historique et session écrits dès qu'ils sont connus, tour coupé marqué au redémarrage et signalé dans la barre latérale, « Reprendre » relance la même session.
- Fait : 5a (socle, modules qu'on éteint), 5b (conversation, activité, jauge, barre d'état, reprise après coupure ; vérifié avec le vrai Claude Code).
- Fait : 5c (fichiers touchés selon git, aperçus seulement s'ils sont affichables, Ouvrir sinon, galerie des captures, fichiers servis par plages et bornés au projet). Formats relevés sur Edge 157 (moteur de WebView2) : MP4 H.264 et WebM VP8/VP9/AV1 lus ; Theora (.ogv de Godot) et HEVC non, donc Ouvrir.
- 5d, refonte par le parcours (`docs/ux-parcours.md`, maquette `docs/maquettes/app.html`, validée par le mainteneur le 2026-11-17) : la première ouverture de l'app a montré une interface construite module par module, sans parcours. Une fenêtre = un jeu, menus Fichier, Jeu, Affichage, Aide ; « Que veux-tu ? » d'une phrase (titre et nom tirés de la phrase, agent réglé par jeu) ; barre latérale par ce qui concerne l'utilisateur (réponse attendue, à juger, en cours, historique) ; avancement en étapes lisibles ; écran « À juger » (compte rendu, captures, lancer cette version, accepter, redemander, abandonner) ; historique et Aller à (Ctrl+K) ; nouveau jeu et ouverture par le sélecteur de dossier de Windows ; reprise automatique après coupure.
- Décisions du 2026-11-17 : on juge **avant** la fusion (nouvel état `a-juger`, `develop` ne reçoit que ce que l'utilisateur a vu ; accepter fusionne et fait le ménage sans LLM, un refus de fusion rappelle l'agent sans redemander de jugement) ; reprise automatique, « Reprendre » seulement si elle échoue ; titre par découpe de la phrase, renommable (F2) ; « Cette nuit » (file de nuit pour le modèle local) plus tard.
- Fait : 5d (cœur : état `a-juger`, événements `a-juger`, `redemande`, `acceptee`, `abandon`, `spawn suivant` et skill `fin-de-feature` s'arrêtent au jugement, avancement lisible ; adaptateur : commande `lancer` ; service : module features ; app : refonte). Vérifié à l'image sur un jeu de démonstration (Edge sans fenêtre), pas encore dans la fenêtre Tauri.
- Reste : « Cette nuit » ; état du jeu (`develop`, ménage) en phase 6.
- Fin : sur le projet d'essai, une feature menée entièrement depuis l'app.
- Fait (nuit du 18/11, `docs/essais/2026-11-18-nuit-opencode.md`) : OpenCode lancé réellement depuis le kit sous Windows ; spec validée par l'utilisateur, plan vérifié, relectures et fusion écrites par l'outil sur preuve ; « vert = jouable » (scènes instanciées par `compiler`, contrat `smoke-test`, tests de bout en bout exigés) ; contexte du modèle local réglé par projet.

## Phase 5 bis : vision, architecture, versions et cadrage (décidé le 2026-11-18)

Modèle : `docs/modele.md`. Parcours : `docs/parcours.md`. Maquette : `docs/maquettes/app.html`.

- **Structure de l'app** : barre de cinq lieux (À traiter, Backlog, Versions, Architecture, Vision), zone principale avec fil d'Ariane, barre d'état ; chaque action au niveau de ce qu'elle concerne.
- **Vision** : écrite à la création, confrontée à chaque cadrage ; stories hors vision signalées.
- **Architecture** : commande `architecture` du contrat moteur (carte relevée depuis le code), règles vérifiées comme des tests (bloquent la fusion), décisions au format ADR proposées au cadrage ; écart entre impact annoncé et carte relevée renvoyé à l'utilisateur.
- **Cadrage** : compréhension, vision, choix, découpage en stories (epic si plusieurs), version, impact sur l'architecture ; tout modifiable à la main, ou cadrage sans agent ; Definition of Ready vérifiée par l'outil.
- **Versions** : numéro et objectif (remplace le jalon) ; correctifs avec report automatique ; livraison par l'utilisateur avec preuve complète et notes de version.
- **Stories** : feature ou bug (reproduction d'abord) ; périmètre figé une fois commencée (suite, ou abandonner et recadrer) ; fermer avec motif, jamais supprimer.
- Fin : une feature à deux stories et un bug corrigé en 1.0.1 menés depuis l'app ; une règle d'architecture cassée bloquée puis décidée.

## Phase 5 ter : français et anglais

- Interface de l'app en français et en anglais (dictionnaire de libellés, langue choisie dans les préférences).
- Langue du projet (`spawn.json`) : celle des documents écrits par les agents (cadrage, spec, compte rendu de recette).
- Les consignes du kit aux agents restent en une seule langue tant qu'aucune mesure ne montre un gain à les traduire (§0, « petit »).

## Phase 6 : app v2, tableau de bord

- Fils et statuts, worktrees et branches (orphelins signalés), ménage en un geste, décisions en attente.
- Bouton « Nouveau projet » (appelle `/nouveau-jeu`), « Avancé » fermé par défaut.
- Fin : un second projet jetable créé et mené depuis l'app.

## Phase 7 : Spawn développé avec Spawn (décidé le 2026-11-18)

Condition remplie : Claude a livré un morpion jouable de bout en bout (`docs/essais/2026-11-17-morpion.md`).

- **Version de runtime** : les agents tournent sur une version livrée de Spawn, installée hors du dépôt (plugin Claude Code, couche OpenCode, commande `spawn`), jamais sur le code qu'ils modifient. La 0.N livrée développe la 0.N+1. Sert aussi à installer Spawn sur une autre machine.
- **Adaptateur Node** (TypeScript, Tauri), même contrat que Godot :
  - `compile` : tsc, eslint, `cargo check` ;
  - `test` : suites du kit, de Godot et du service ;
  - `smoke-test` : le service et l'app démarrent et répondent ;
  - `capture` : captures de l'app par Edge sans fenêtre ;
  - `domain` : « app ».
- **Dépôt préparé** : branche `develop`, `spawn.json`, préfixe d'exigences, remote GitLab auto-hébergé.
- **Premières stories sur l'app** ; le cœur du kit (périmètre, vérifications) reste modifié à la main tant que la confiance n'est pas établie.
- Fin : une story de l'app menée par Spawn depuis l'app, mesures du §0 relevées sur Spawn lui-même.

## Plus tard

Avec `/adopter` sur Deep Front, là où sa taille les justifie : exécuteur GitLab repris de Deep Front, preuve par empreinte, vérification après coup avec gel de zone, quarantaine bornée, serveur CI rendu générique. Ensuite : adaptateur Unreal validé sur un mini projet (`C:\Dev\UE_5.8`) ; accès mobile ; dictée.
