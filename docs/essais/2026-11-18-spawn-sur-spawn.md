# Essai du 18/11 : Spawn sur Spawn (story 4)

Feature : renommer le menu « Jeu » en « Projet » dans la barre de menus de l'app, menée par l'app du runtime sur le dépôt de Spawn lui-même. Agent : Claude Code, orchestrateur sur opus (modèle par défaut de la session), implémenteur et relecteur sur sonnet (`spawn.json`).

**Verdict : livrée et acceptée, mais au deuxième essai, avec 7 interventions de l'utilisateur et deux corrections de l'outil faites à la main pendant l'essai.** Pour une ligne changée, l'essai 2 a demandé 37 minutes de travail d'agent et 4,54 $.

## Essai 1 (arrêté)

- 13:35 : tour refusé à l'ouverture, plugin `spawnstudio` inactif dans le projet (un `.claude/settings.local.json` le masquait). Corrigé à la main.
- 13:37 à 13:45 : spec écrite et validée, puis l'agent part bâtir un pilote d'Edge pour tester un libellé. Arrêté par l'utilisateur.
- Cause : aucune preuve fixée par exigence, et une consigne qui imposait un test de bout en bout en dernière tâche. Corrigé (commit `6c47bdc`) : chaque exigence porte sa preuve (`test`, `bout en bout`, `capture`, `aucune`), validée au cadrage ; un plan qui écrit un test non prévu est refusé.
- Coût : 0,39 $ mesuré sur le tour 2 ; le tour 3, interrompu, n'a pas rendu de coût.

## Essai 2 (livré)

Heures UTC.

| Tour | Déclencheur | Durée | Appels de l'orchestrateur | Appels des sous-agents |
|---|---|---|---|---|
| 1 | demande de la feature | 0,7 min | 9 | 0 |
| 2 | spec validée | 13,1 min | 37 | 18 |
| 3 | « reteste », après correction de l'outil | 2,8 min | 9 | 0 |
| 4 | fusion refusée (rappel automatique) | 9,2 min | 29 | 5 |
| 5 | « redémarré l'app, refais un test Edge » | 0,3 min | 3 | 0 |
| 6 | « continue » | 4,1 min | 14 | 20 |
| 7 | « ok pour 2 » (preuve de SGS-32) | 7,0 min | 25 | 20 |
| **Total** | | **37,2 min** | **126** | **63** |

- Coût : 4,54 $, dont 4,25 $ pour l'orchestrateur opus et 0,28 $ pour les sous-agents sonnet. 8,5 millions de tokens relus depuis le cache (environ 68 000 par appel de l'orchestrateur), 43 000 écrits.
- Commandes de l'orchestrateur : 24 `spawn next`, 16 `spawn ledger`, 14 `spawn engine`, 10 `git`, 7 `spawn story`, et environ 30 commandes de diagnostic (Edge, journaux, lecture de `scripts/launch.mjs`).
- Rounds de relecture : 0. Relecture finale : 1 round (« À CORRIGER », preuve de SGS-32 impossible à capturer).

### Interventions de l'utilisateur

1. Demande de la feature.
2. Validation de la spec.
3. Relance après la correction de la capture (« reteste »).
4. Acceptation (deux clics, aucun retour visuel ; le second a été refusé avec « fusion déjà en cours »).
5. Redémarrage de l'app pour remettre Edge en état.
6. « Continue ».
7. Décision sur la preuve de SGS-32 (« ok pour 2 »).

Les interventions 3, 5 et 7 viennent de défauts de l'outil ; la 6 d'un agent qui s'est arrêté pour rendre compte, à juste titre.

### Corrigé à la main pendant l'essai

Lot 1 (commit `bde2e68`) :
- capture bloquée sur une app qui garde une connexion ouverte : `--timeout` au lieu de `--virtual-time-budget` ;
- relecteur sans droit d'écrire son verdict ;
- attribution IA dans un commit de tâche (`Co-Authored-By`) : refusée à `task-done`, avec la commande qui la retire ;
- commande de capture à trous (`--scene <scène>` pour une app sans scènes) : remplie par l'outil ;
- preuve faite deux fois (par l'agent, puis par `ledger captures`) : laissée à l'outil ;
- story d'une seule tâche relue deux fois : la relecture de la tâche tient lieu de relecture finale.

Lot 2 (commit `13c3161`) :
- journal d'un refus de fusion effacé avec le dossier d'intégration : gardé dans `.spawn/merge/logs/` ;
- capture ratée sans raison : code de sortie, durée et sortie d'Edge dans l'erreur ;
- spec qui promet une capture impossible (menu déplié) : la consigne du cadrage dit qu'une capture montre l'état au lancement, sans action ;
- captures non confrontées aux exigences : une capture nommée par exigence « Preuve : capture », exigée par `ledger captures` ;
- refus du périmètre qui disait « le dossier temporaire » sans le nommer (l'agent a écrit dans `C:\tmp`) : il nomme les dossiers permis.

### Non résolu

- **Panne d'Edge dans les processus de l'app**, entre 14:49 et 14:52 : Edge s'arrêtait en 68 ms sans image, alors qu'il marchait dans une autre session au même moment. Un redémarrage de l'app l'a réglée. Cause inconnue ; la prochaine fois, l'erreur de capture donnera le code et la sortie d'Edge.
- **Interface** : aucune action ne montre qu'elle est prise en compte ; l'avancement se contredit après un retour en arrière (fusion refusée, nouvelle tâche après la recette) ; le libellé « en cours d'écriture » s'affiche sans agent. Story à mener par Spawn.

## Ce qui a marché

- La spec a fixé la preuve de chaque exigence, et le plan a tenu en une tâche, sans test inventé.
- L'agent s'est arrêté honnêtement chaque fois qu'il ne pouvait pas prouver (capture bloquée, Edge en panne, SGS-32), sans bricoler de contournement, et a corrigé de lui-même une erreur de son compte rendu.
- La relecture finale a attrapé une preuve promise et non faite.
- La fusion a refusé une suite rouge, et le squash a laissé hors de `develop` l'attribution IA du commit de tâche.
