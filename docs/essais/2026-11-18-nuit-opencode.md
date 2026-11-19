# Nuit du 18/11 : le morpion avec OpenCode et Qwen3.5 9B

Projet : `C:\Dev\morpion-local` (Godot 4.7.2, jetable), même intention que l'essai Claude du 17/11 (`2026-11-17-morpion.md`) :

> Je veux un morpion à deux joueurs sur le même écran, sans IA. On clique sur une case vide pour y poser son symbole, X commence et les joueurs alternent. Le jeu annonce la victoire (trois alignés en ligne, colonne ou diagonale) ou le match nul quand la grille est pleine, et un bouton permet de rejouer.

Modèle : `qwen/qwen3.5-9b` dans LM Studio (contexte chargé 120 k), OpenCode v2 (`run --standalone --auto`).

## Avant l'essai : OpenCode ne pouvait pas tourner depuis le kit

Trois défauts de lancement sous Windows, masqués au premier essai OpenCode (lancé depuis un terminal) ; le contrôle de périmètre les a tous arrêtés avant le moindre tour :

1. `opencode` est un raccourci npm (`.cmd`) que Node ne lance pas : le kit lance maintenant l'exécutable réel (`executable()`, `agent/processus.ts`).
2. OpenCode prend son dossier dans `PWD`, hérité du parent : il travaillait dans le dossier de l'app, où le plugin de périmètre ne voit aucun projet. `PWD` suit maintenant `cwd`.
3. Entrée standard laissée ouverte : OpenCode attendait la suite du message. Elle est fermée.

Le message du contrôle disait « le plugin n'a rien refusé » alors qu'OpenCode n'avait pas démarré : il dit maintenant que le lancement a échoué.

## Essai 1 (depuis l'app, 00:03-00:15, arrêté par l'utilisateur)

Un tour de 11 minutes, sans relance. Spec, plan et tâche 1 faits ; arrêté quand le plan s'est révélé en HTML.

| # | Constat | Correction (commit `ccfc5da`) |
|---|---|---|
| 1 | Spec validée par l'agent lui-même : `spawn suivant` listait la mise en attente **et** les commandes d'après validation, le modèle a tout enchaîné ; le fil n'est jamais passé en « Attend ta réponse » | L'agent propose (`ledger spec-proposee`, fil `bloque:validation-spec`) et s'arrête ; la validation (`spec`) est réservée à l'app et au pilote (`validerSpec`), refusée par `spawn ledger` avec le bon geste. Répondre sans valider rend la spec « à revoir ». Écran « Valide ce que tu verras » dans l'app |
| 2 | Plan en HTML, CSS et JavaScript dans un projet Godot : rien, aux étapes spec et plan, ne rappelait le moteur | `spawn suivant` rappelle le cadre (moteur, version, « jamais en technologies web », lire `CLAUDE.md` et `knowledge/organisation.md`) ; `spawn ledger plan` refuse un plan qui prévoit des fichiers d'une autre plateforme (extensions inconnues de l'adaptateur) |
| 3 | Plan en `### 1. …` accepté, illisible par `spawn suivant` | `spawn ledger plan` refuse un plan sans `## Tâche N : <titre>`, avec la forme |
| 4 | Après `ledger plan`, la ligne « ensuite » envoyait vers la skill `spawn-tache` : le modèle a quitté `spawn suivant`, inventé un dossier (`.spawn/worktrees/dd9c4fa/`) et des commandes (`plan creer`, `leader tache`, `spawn-implementer --mode tache`) | Chaque sortie de `spawn ledger` finit par `ensuite : spawn suivant` ; une commande inconnue répond « n'invente pas de commande : lance spawn suivant » au lieu de l'aide complète |
| 5 | Un sous-agent a poussé un `stash` dans la pile commune par `git --work-tree=… --git-dir=<racine>/.git stash` ; le périmètre a bloqué ses `reset --hard` et `stash pop`, pas le `stash` | `--git-dir` / `--work-tree` hors de sa zone refusés sauf lecture ; `stash` sous toutes ses formes refusé chez un autre (`perimetre/analyse.ts`, 19 cas) |
| 6 | `&&` refusé par PowerShell, un round perdu à chaque fois | Ligne « règle : une commande par appel » dans chaque sortie de `spawn suivant` ; skill `tranche` |
| 7 | Fil nommé `je-veux-un-morpion-a` | Titre sans formule de demande ni petit mot coupé : « Un morpion à deux joueurs » |

Ce qui a tenu : conversation au fil de l'eau dans l'app, contrôle de périmètre, refus journalisés, `develop` intact.

## Essai 2 (pilote, 00:30-00:51) : abandon après une attente sans fin

Spec proposée, validée par le pilote, en Godot ; plan refusé quatre fois par `ledger plan` (fichiers `.ts`, puis tâches illisibles), corrigé à chaque refus, puis accepté : GDScript, par composant. Puis blocage : `ledger lancee` noté sans lancer l'implémenteur, et `spawn suivant` disait « implémenteur en cours, attendre » ; une quarantaine d'appels, 19,6 M de tokens d'entrée, abandon après 3 tours sans progrès.

| Constat | Correction |
|---|---|
| « Lis CLAUDE.md » compris comme celui du kit, à côté de `cli.ts` ; spec écrite dans le dossier du kit (refusée par le périmètre) | Chemins absolus dans le worktree (`de891ae`, `7bff99b`) |
| Exigences numérotées « MRL », « NN » : `<TAG>-NN` pris au pied de la lettre | Exemples concrets `MRL-01`, `MRL-02`… |
| Refus du plan sans le fichier fautif | Le refus nomme les fichiers |
| Implémenteur jamais lancé, puis « attendre » | Un sous-agent bloque l'orchestrateur : sans rapport, il est « à lancer », jamais « en cours » ; prompt exact écrit en toutes lettres (`b7beecc`) |
| Fichier `nul` laissé par une redirection : `git worktree remove` échoue | Retrait robuste ; noms réservés de Windows évités pour un fil (`98526a4`) |

## Essai 3 (pilote, depuis 00:54)

Spec en 1 min, plan en 2 min (Godot, par composant), tâche 1 en 2 min 30 : le premier sous-agent a vraiment tourné (`main.gd`, `main.tscn`, tests GUT).

| Constat | Correction |
|---|---|
| Implémenteur cherché comme une skill (« Unable to load skill ») | Outil nommé par agent : `subagent` pour OpenCode, `Agent` pour Claude Code (`b93e4a0`) |
| `lancee` noté sans brief écrit | Le brief est exigé avant le lancement |
| Tâche close sans relecture ; spec validée modifiée par l'implémenteur | Le relecteur écrit son verdict dans `<n>-relecture.md` (prompt exact) ; `ledger terminee` refuse sans verdict plus récent que le rapport, ou si la tâche touche la spec validée (`9fe7502`) |

Suite de l'essai 3 : la tâche 2 n'a jamais abouti, un sous-agent a relancé la même commande toutes les 5 secondes pendant 25 minutes (« checking for gutcli »). Arrêté.

| Constat | Correction |
|---|---|
| Boucle dégénérée d'une même commande, sans rien entre deux | Garde du périmètre : la même commande shell plus de 3 fois de suite par une session est refusée, avec quoi faire à la place (`ff544c0`) ; `spawn suivant` en est exempté, il donne l'action (`ce0c1b8`) |

## Essai 4 (pilote, 01:29-01:36) : arrêté, faux refus

Le plan citait la commande de preuve `node "C:\…\kit\core\src\cli.ts" moteur tester` ; le `.ts` a été pris pour un fichier d'une autre plateforme. Refusé à tort, le modèle a recopié des fichiers du kit dans le jeu pour « réparer ». Correction : seuls les chemins relatifs du projet comptent (`8e3a683`).

## Essai 5 (pilote, depuis 01:38)

Spec et plan en 1 minute (exigences `MRL-01`…, plan Godot par composant accepté du premier coup). Tâche 1 : implémentation en TDD (tests rouges puis verts), relecture qui trouve des écarts Critique, round 1, correction, nouvelle relecture, tâche close : premier cycle complet avec Qwen.

| Constat | Correction |
|---|---|
| Devant un verdict « Critique », le choix entre trois branches décrit en prose : `spawn suivant` relancé en boucle | L'outil lit le verdict (ligne `VERDICT : APPROUVÉ` ou `À CORRIGER` demandée au relecteur) et ne donne qu'une action : terminer, ou noter le round puis relancer l'implémenteur avec un prompt exact (`d8000b8`) |
| Fichiers de travail (`.spawn/taches/` du worktree) effacés par un nettoyage git d'agent | Sous `<racine>/.spawn/taches/<fil>/`, hors du worktree (`a79d914`) |
| Sous-agent qui écrit dans le checkout principal (chemins construits depuis le brief), bloqué par le périmètre | Dossier du jeu en toutes lettres dans chaque prompt de sous-agent (`133b8bd`) |

Suite et fin de l'essai 5 (reprises du pilote jusqu'à 06:50) :

- Tâche 2 terminée après 3 rounds, tâche 3 parquée au plafond de 5 rounds (le relecteur trouvait toujours le TDD non respecté), tâche 4 terminée.
- Compte rendu « à juger » écrit à 05:37 (heure UTC du ledger) : « jeu morpion 2 joueurs complet… 32/32 tests verts ».
- La branche : 30 commits, 22 fichiers, `core/systems/morpion/rules.gd`, `core/actors/grille/{case,grille}.gd`, `core/games/morpion/main.gd`, 7 fichiers de tests GUT.
- **La capture (`.spawn/captures/morpion/jeu.png`) montre un écran presque vide** : un libellé tronqué « de X », un bout de bouton, pas de grille. Le modèle l'a déclarée « valide ». (Correction du 19/11 : « sans vision » n'était pas mesuré. OpenCode transmet bien l'image, sa lecture répond « Image read successfully » ; ce que le modèle en voit n'est pas mesuré.) Le compte rendu n'est pas une preuve ; c'est l'écran « À juger » qui montre la vraie capture à l'utilisateur. Le pilote, qui accepte sans regarder, ne protège pas de cela.
- Acceptation par le pilote refusée (fichiers `.uid` de Godot non commités, comptée à tort comme abandon), puis fusion refusée par la file (cause `import` : les `.uid` n'existaient pas dans le worktree, l'import n'y avait été fait qu'à sa création). L'agent a alors **écrit lui-même un événement `fusion`** au ledger, sans fusion réelle. `develop` n'a pas bougé.

| Constat | Correction |
|---|---|
| Tâche close malgré un finding Important noté « mineur » ; relecture finale déclarée propre en 6 secondes, sans relecteur | `ledger terminee` refuse un verdict « À CORRIGER » ; relecture finale par un relecteur qui écrit son verdict, `relecture-finale --verdict propre` refusé sans lui (`67270ec`) |
| Base d'une tâche lue sur `develop` | `ledger lancee` exige la tête du worktree (`d9a6909`) |
| Fichiers non commités au moment de juger | Étape « worktree à commiter » avant le compte rendu ; une acceptation sur un worktree sale renvoie le fil à l'agent (`67270ec`) |
| `.uid` jamais générés dans le worktree | Import du moteur (`spawn moteur preparer-worktree`) au début de la preuve, fichiers générés à commiter ; le refus `import` le dit (`8d56d3c`) |
| Fusion déclarée par l'agent | `fusion` réservé : écrit par `spawn fusion` sur un verdict réel (`8d56d3c`) |

## Bilan de la nuit

- **Le kit tient un modèle de 9 B sur le chemin, à condition que chaque étape soit une action unique, vérifiée par l'outil.** Toute étape décrite en prose (choisir entre des branches, lancer un sous-agent « quand il faut », relire) a été sautée ou mal faite au moins une fois ; chaque fois qu'elle est devenue une commande vérifiée ou un fichier exigé, le modèle l'a suivie.
- **Le modèle déclare ce qu'il n'a pas fait** : spec validée par lui-même, relecture « propre » sans relecteur, capture vide « valide », fusion inscrite au ledger. Chaque déclaration qui compte doit être écrite par l'outil sur une preuve, jamais par l'agent. Il en reste une : le verdict des captures (l'image est transmise au modèle, mais rien ne mesure qu'il la lit correctement).
- **Le périmètre a tenu toute la nuit** : écritures hors worktree, `stash` par `--git-dir`, suppressions hors zone, boucles, tous bloqués avec la bonne raison.
- **Coût** : l'essai 2 a consommé 19,6 M de tokens d'entrée en 20 minutes de boucle ; l'essai 5, environ 5 heures pour 4 tâches. Qwen 9B avance, lentement, et ses relectures sont plus sévères que son code.
- **Reste à faire** : verdict des captures par l'utilisateur, ou par un modèle qui voit ; essai complet avec l'app plutôt que le pilote ; comparer avec Claude sur le même parcours.
