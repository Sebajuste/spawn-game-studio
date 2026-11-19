---
name: finish-story
description: Clôt une feature relue - preuve fraîche (compilation et suite complète), captures et compte rendu de ce que l'utilisateur devra juger, puis arrêt à juger ; correction d'une fusion refusée. À utiliser après la relecture finale propre, ou quand l'utilisateur demande de terminer ou livrer une feature.
---

# Fin de feature

Chaque commande `spawn …` ci-dessous se copie telle quelle et se lance depuis le worktree du fil.

## 1. Preuve fraîche

1. `spawn engine compile`, puis `spawn engine test` sans filtre : la suite complète.
2. Relire le JSON : `ok`, `errors`, `data` (`total`, `passed`, `failed`). Le code de sortie seul ne suffit pas.
3. Un seul rouge et la feature n'est pas finie, quelle que soit l'origine du rouge. Pas de liste de rouges connus, pas de test désactivé : ajouter au plan une tâche de correction, la mener par `spawnstudio:task`, puis reprendre ici au pas 1.

## 2. Captures

Pour chaque élément de « Résultat attendu » dans la spec, produire ce que l'utilisateur jugera, dans `<racine>/.spawn/captures/<fil>/` (`<racine>` = parent de `git rev-parse --path-format=absolute --git-common-dir`), hors du worktree qui va disparaître :

- image fixe : `spawn engine capture --scene <scène> --output <png>` (sous Godot, `<scène>` s'écrit `res://…`) ;
- scène qui évolue, ou rendu à juger : agent `spawnstudio:scene-validator`, qui capture à plusieurs instants et regarde les images. INVALIDE : la feature n'est pas finie (tâche de correction, comme au pas 1.3). INDÉCIDABLE : le dire au rapport.

Regarder chaque PNG avec Read avant de le montrer : une capture noire ou vide ne se présente pas comme une preuve. Puis `spawn ledger captures --paths <png> [--paths <png>]… --verdict valid|invalid|undecidable`.

## 3. À juger

L'utilisateur juge avant toute fusion : `develop` ne reçoit que ce qu'il a vu.

1. `spawn ledger acceptance-report --summary "<ce qui a été fait>" --how_to_check "<ce qu'il faut essayer>"` : deux ou trois phrases en mots de joueur, d'après « Résultat attendu » de la spec, sans jargon ni chemin de fichier. L'app les montre avec les captures.
2. `spawn story update --status in-acceptance --task "à juger"`, puis s'arrêter. Dans l'app, il accepte (l'app fusionne et fait le ménage, sans toi), redemande (le fil repart : `spawn next` dit d'ajouter une tâche de correction) ou abandonne.

## 4. Fusion refusée après acceptation

L'app inscrit la branche quand l'utilisateur accepte. Refusée (`cause` : `failing`, `conflict`, `import`, `head-changed`), le fil redevient actif et tu es relancé : traiter la cause par une tâche de correction (`spawnstudio:task`) ; pour un `conflict`, intégrer `develop` dans la branche (`git merge develop`). Puis preuve fraîche (pas 1) et `spawn merge --summary "<titre court>"` : l'acceptation tient, pas de nouveau jugement. Ne jamais fusionner à la main ni pousser `develop`.

## 5. Rapport

Court : ce qui est à juger et comment le vérifier, preuve (compilation, tests réussis / total, sans rouge), dette (mineurs restants, Rulings dont le coût si faux le concerne). Rien n'est caché.
