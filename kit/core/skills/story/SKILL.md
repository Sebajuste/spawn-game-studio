---
name: story
description: Mène une feature de jeu de l'intention de l'utilisateur jusqu'au jugement de l'utilisateur, avant la fusion dans develop - fil et worktree, spec validée une seule fois, plan TDD, tâches déléguées, relecture finale, fin de feature. À utiliser dès que l'utilisateur demande une fonctionnalité, un changement de gameplay ou de contenu à livrer, ou pour reprendre un fil existant.
---

# Tranche

L'utilisateur valide la spec, puis juge ce qu'il voit à la fin. Entre les deux, aucune question. Tout arbitrage se tranche par la règle « Décider par l'objectif » du CLAUDE.md du projet.

Chaque commande `spawn …` ci-dessous se copie telle quelle et se lance depuis le worktree du fil.

Le ledger du fil ne s'écrit que par `spawn ledger <type> --option valeur…` (formes : `spawn ledger help`), jamais à la main. Une commande mal formée est refusée avec la forme attendue : la corriger et relancer. Une commande `spawn ledger` acceptée affiche elle-même l'action suivante : la faire, sans relancer `spawn next`. Une commande par appel, sans `&&` ni `;`. Ne jamais inventer de commande : celles qui existent sont celles que donne `spawn next`.

## La boucle

`spawn next` rend la prochaine action exacte du fil (étape, quoi faire, commandes, preuve attendue), déduite de l'état du fil, du ledger, du plan et des fichiers de travail. **Faire exactement cette action, puis relancer `spawn next`** (sauf après un `spawn ledger`, qui l'affiche déjà), jusqu'au rapport final. En reprise (nouvelle session, compactage) : entrer dans le worktree du fil, puis `spawn next`, sans autre lecture. Les sections ci-dessous détaillent chaque étape ; en cas d'écart, `spawn next` fait foi.

## 1. Fil

- Nom du fil : court, kebab-case, d'après l'intention (`saut-mural`).
- EnterWorktree avec ce nom : le hook du kit crée `feature/<fil>` depuis `develop` à jour, fait l'import du moteur et l'état du fil. Jamais `git worktree` par le shell.
- `spawn story update --status active --task "spec"`.

## 2. Spec

Lire `CLAUDE.md`, `knowledge/organization.md` et ce qu'il faut de `context/` et du code : tout le jeu se fait avec le moteur du projet (`spawn.json`), jamais en technologies web. Puis écrire `docs/specs/AAAA-MM-JJ-<fil>.md`, une page au plus :

- **Résultat attendu** : ce que l'utilisateur pourra voir ou jouer, et comment, en 3 à 5 lignes (scène, touche, situation).
- **Exigences** : une par élément de liste, `- **<TAG>-NN** <phrase observable>. Preuve : <test | bout en bout | capture | aucune>.` (`<TAG>` : préfixe du projet). La **preuve** dit ce qui sera testé et ce qui ne le sera pas ; l'utilisateur la valide avec le reste :
  - `test`, `bout en bout` : un test écrit avec l'outillage qui existe déjà ; il nomme son **contrôle négatif**, le cas qui doit échouer. Un test de bout en bout charge la scène principale et rejoue « Ce que tu verras ». Le projet garde au moins un test de bout en bout : s'il n'en a pas, une exigence a cette preuve ;
  - `capture` : vu sur la capture de la recette, une par exigence, nommée par son identifiant. Une capture montre ce que le projet affiche au lancement, sans clic ni touche : une exigence qui demande une action (menu déplié, saut) a la preuve `test`, ou `aucune` si l'utilisateur la regarde à la recette ;
  - `aucune` : dit franchement.

  Un test qui demanderait un outillage absent ne s'invente pas : la preuve est `capture` ou `aucune`, et la spec dit ce qu'un test demanderait. L'outillage serait une feature à part, décidée par l'utilisateur.
- **Hors périmètre** : ce qui ne sera pas fait.

Commit de la spec, puis `spawn ledger spec-proposed --path docs/specs/<fichier>.md` (une exigence sans preuve, ou d'une preuve hors de la liste, est refusée avec la raison) et `spawn story update --status blocked:spec-approval --task "valider la spec"`, et s'arrêter. **C'est la seule question de la feature**, et c'est l'utilisateur qui la valide, dans l'app : la validation (`spec-approved` au ledger) n'est jamais écrite par l'agent. S'il répond sans valider, `spawn next` dit de corriger la spec et de la proposer de nouveau.

## 3. Plan

`docs/plans/AAAA-MM-JJ-<fil>.md`, en-tête `**Spec :** <chemin>`. Chaque tâche sous un titre exact `## Tâche N : <titre>` (c'est ce que lit `spawn next`), de 2 à 5 minutes, autonome :

- fichiers touchés, exigences couvertes ;
- si la spec prévoit un test pour ces exigences : test d'abord (le test qui doit rougir, puis ce qui le fait passer) et commande de preuve `spawn engine test --filter <motif>` ; sinon, aucun test : la suite existante (`spawn engine test`) reste verte ;
- interfaces produites dont les tâches suivantes dépendent.

Un gros changement se découpe en une tâche par composant. Commit du plan, puis `spawn ledger plan --path docs/plans/<fichier>.md` : un plan sans tâches lisibles, qui prévoit des fichiers d'une autre plateforme que le moteur, ou qui écrit un test que la spec validée ne prévoit pas, est refusé avec la raison.

## 4. Exécution

Par `spawn next` : chaque tâche dans l'ordre, une à la fois (détail : skill `spawnstudio:task`), puis `spawnstudio:review`, puis `spawnstudio:finish-story`.

## Arbitrages, sans l'utilisateur

Un choix technique, une ambiguïté de spec, un plan qui ne tient pas : décider, écrire au ledger et continuer.

`spawn ledger ruling --decision "<décision>" --reason "<raison>" --cost "<coût si faux>"`

Ce qu'aucun type ne couvre : `spawn ledger note --text "<texte>"`, en dernier recours (une note n'est pas comptée par `spawn metrics`).

Seuls trois cas arrêtent le fil et attendent l'utilisateur :

- un choix de design du projet qui change ce que l'utilisateur verra ;
- une action irréversible ;
- une action hors du projet.

Alors : `spawn story update --status blocked:decision --first-step "<ce qui reprend après la réponse>"`, puis une seule question, avec les options et ta recommandation, écrite dans ton dernier message, et tu t'arrêtes. Jamais par un outil de question : lancé par l'app, l'agent tourne sans interface et la question est annulée sans réponse. Ne jamais demander une permission, un avis technique ou une confirmation de routine.
