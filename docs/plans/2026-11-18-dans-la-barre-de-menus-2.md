# Plan : menu « Projet » dans la barre de menus

**Spec :** docs/specs/2026-11-18-dans-la-barre-de-menus-2.md

## Tâche 1 : renommer le menu « Jeu » en « Projet »

- **Fichiers touchés** : `src/App.tsx` (titre du deuxième menu, ligne `title: "Jeu"` → `title: "Projet"` ; commentaire d'en-tête qui liste les menus), `src/Menus.tsx` (commentaire d'en-tête qui liste les menus).
- **Exigences couvertes** : SGS-31, SGS-32 (preuve : capture ; aucun test écrit). Les entrées, leur ordre et leurs raccourcis du menu ne changent pas.
- **Interfaces produites** : aucune ; seul le libellé affiché change.
- **Ne pas toucher** : le menu Fichier, les entrées du menu, le mot « jeu » ailleurs dans l'app (hors périmètre).
- **Preuve** : la suite existante, `node "C:\Users\<utilisateur>\.spawn\runtime\0.1.0+cd73832\kit\core\src\cli.ts" engine test`, plus la compilation (`engine compile`) ; la capture se fait en fin de feature.

## Tâche 2 : correction de la fusion refusée (tests de capture du kit)

- **Constat** : fusion refusée sur `kit/core/test/contract.test.ts:90` et `kit/engines/node/test/cli.test.ts:215`, deux tests qui capturent le projet d'exemple du kit avec Edge, pas l'app. Le même échec (« Edge n'a pas écrit d'image PNG », Edge sorti en 2 s) s'était produit une fois sur cette branche avant `bde2e68`, puis n'était pas revenu aux relances.
- **Fichiers touchés** : aucun fichier de la branche ; intégration de develop (`git merge develop`, commit `a9bf61c`), pour prouver la branche avec l'outil corrigé.
- **Exigences couvertes** : aucune nouvelle (SGS-31, SGS-32 inchangées).
- **Preuve** : `node "C:\Users\<utilisateur>\.spawn\runtime\0.1.0+bde2e68\kit\core\src\cli.ts" engine test` après l'intégration : 418 tests, 417 passés, 0 échec, 1 sauté.
- **Non corrigé ici** : l'instabilité d'Edge dans ces deux tests du kit. Elle relève de l'outil, pas de cette story.
