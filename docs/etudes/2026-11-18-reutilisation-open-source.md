# Étude du 18/11 : ce que Spawn peut reprendre de l'open source

Question du mainteneur : réinvente-t-on la roue, et peut-on prendre directement des parties qui marchent ? Trois études en lecture seule (dépôts clonés et lus, licences lues dans leur fichier LICENSE, rien exécuté). Spawn ne déclare pas de licence : seul du code MIT, Apache-2.0 ou BSD peut y être recopié, avec ses mentions.

**Verdict : aucun outil ne fait ce que Spawn fait de propre, la vérification imposée par l'outil.** Les plus proches (GSD, Superpowers, Taskmaster) se fient à un statut ou à des résultats de test fournis par l'agent ; aucun ne rejoue une preuve validée par l'utilisateur, exigence par exigence. En revanche, trois mécanismes existent ailleurs et méritent d'être repris.

## À reprendre (chacun change le cœur du kit ou ajoute un composant : décision du mainteneur)

1. **Un enchaîneur d'étapes sans orchestrateur** (idée, pas de code repris). Spec Kit (`src/specify_cli/workflows/engine.py`, MIT, Python) et GSD (`sdk/src/phase-runner.ts`, MIT) lancent chaque étape en mode non interactif (`claude -p`, `opencode run`) et n'avancent que sur un code de sortie ou un verdict. Pour Spawn : un programme qui lance implémenteur et relecteur, note au ledger lui-même, et ne réveille l'orchestrateur que sur un refus ou un BLOCKED. Cible : 94 % du coût de l'essai 2 (orchestrateur opus). Estimé 400 à 700 lignes dans le cœur. Gain à mesurer : chaque session non interactive relit son contexte.
2. **Capture après action pour Godot** (copie, Apache-2.0). `command_handler.gd` de godot-e2e (github.com/RandallLiuXin/godot-e2e) envoie touches, actions et clics (`Input.parse_input_event`), attend des images ou des signaux, lit les propriétés des nœuds et capture l'écran ; CI sous Windows. Repris dans `kit/engines/godot/tools/capture.gd` avec un scénario JSON (appuyer, attendre, capturer sous le nom de l'exigence, vérifier une propriété) et `--fixed-fps` (idée de Godogen, MIT), une capture prouverait enfin un comportement, pas seulement l'écran de lancement. Estimé 300 à 500 lignes. Change le contrat des adaptateurs.
3. **Une conversation par story dans un processus Claude qui reste ouvert** (protocole de la ligne de commande, sans dépendance). `claude -p --input-format stream-json --output-format stream-json` gardé ouvert : message remis dans le tour en cours, arrêt (`interrupt`), reprise après redémarrage. L'Agent SDK (licence commerciale d'Anthropic, pas open source) documente ce fonctionnement (`priority: 'now'`, `streamInput`) ; Kandev l'a vérifié par une sonde (ADR `2026-08-04-mid-turn-steering.md`) et prévient que, côté ligne de commande, c'est non documenté et peut régresser : la remise dans le tour reste opportuniste, « remis » et non « pris en compte ». Modèles de conception : Orchestra (`src/main/agent-sdk.ts`, Apache-2.0). Estimé une à deux semaines sur le service.

## Peu utile ici

- Validateur de spec d'OpenSpec (MIT) : `specDefects` couvre déjà le besoin.
- `review-package` de Superpowers (MIT) : le relecteur reçoit déjà un paquet de diff.
- Worktrees de Cline Kanban (`src/workspace/task-worktree.ts`, Apache-2.0) : les nôtres marchent ; à relire seulement si un défaut Windows apparaît.
- Serveurs MCP Godot (Beckett Lite, Godot AI, Coding-Solo) : pas d'entrée, ou l'éditeur doit tourner.

## À ne jamais recopier

- **GodotMaker** : BSL 1.1, interdit les produits concurrents de « développement Godot piloté par agents ».
- **Kandev, Kangentic, Claude Squad** : AGPL-3.0.
- **Taskmaster** : Commons Clause (vente interdite).
- **BMAD** : nom déposé.
- **Agent SDK** : utilisable comme dépendance seulement, sous conditions commerciales.

## Limites de l'étude

Rien n'a été exécuté : le fonctionnement sous Windows et la remise d'un message en plein tour par la ligne de commande ne sont pas vérifiés. Projets récents, souvent tenus par une seule personne (godot-e2e : aucun commit depuis quatre mois).
