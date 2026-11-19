# Spawn Game Studio

Un kit (`kit/core`, adaptateurs de moteur dans `kit/engines/`), un service Node (`service/`) et une app Tauri et React (`src/`, `src-tauri/`) pour faire des projets complets avec des agents. Spawn est développé avec Spawn : ce dépôt est un projet Spawn (moteur `node`, `spawn.json`).

Références : objectif et décisions `docs/kit-perimetre.md` ; modèle `docs/modele.md` ; parcours `docs/parcours.md` ; maquette `docs/maquettes/app.html` ; nommage `docs/nommage.md` ; contrat des adaptateurs `kit/engine-contract.md` ; plan `docs/plan-implementation.md`.

## Décider par l'objectif

L'utilisateur fixe la vision et décide de l'architecture ; il dit ce qu'il veut, puis juge ce qu'il voit. Tout le reste se fait sans lui, et tout ce qu'on lui montre a été vérifié. Le projet ne s'éloigne ni de sa vision ni de son architecture sans qu'il l'ait décidé.

Avant de trancher un problème technique, remonter à cet objectif (§0 de `docs/kit-perimetre.md`) et retenir la solution qui le sert le plus simplement :

- **Sans lui** : ni permission, ni arbitrage, ni surveillance demandés.
- **Vérifié** : rien n'est déclaré fait, vert ou relu sans une vérification de l'outil ; ce qui n'est pas vérifié est dit non vérifié. Aucune dette cachée.
- **Maîtrisé** : un nouveau composant, une nouvelle dépendance ou un contrat changé se proposent, jamais en douce.
- **Petit** : à la taille du besoin ; pas d'outillage que rien ne mesure.

## Règle propre à ce dépôt : le cœur du kit

Le cœur du kit n'est **jamais** modifié dans une story : il n'est changé que par le mainteneur et Claude, hors de Spawn. Une story qui en aurait besoin s'arrête et le dit (`spawn story update --status blocked:decision`). Sont le cœur :

- le périmètre et les hooks : `kit/core/src/guard/`, `kit/core/src/hooks/`, `kit/core/hooks/` ;
- les vérifications et la suite : `kit/core/src/next.ts`, `kit/core/src/cli.ts`, `kit/core/src/ledger.ts`, `kit/core/src/plan.ts` ;
- la fusion, le jugement et le runtime : `kit/core/src/merge.ts`, `kit/core/src/acceptance.ts`, `kit/core/src/runtime.ts`, `kit/core/src/location.ts`, `kit/core/src/activity.ts` ;
- le contrat des adaptateurs : `kit/core/src/adapter/`, `kit/engine-contract.md`, `kit/core/schemas/`.

Les agents travaillent avec une version figée de Spawn (le runtime, `~/.spawn/runtime/`), jamais avec le code de ce dépôt.

## Conventions

- **Noms techniques en anglais** (fichiers, dossiers, identifiants, commandes, champs, routes, classes CSS) ; **commentaires et textes lus par une personne en français** (interface, messages, consignes aux agents). Table de correspondance : `docs/nommage.md`.
- Commentaires : le pourquoi et le piège, pas la paraphrase du code.
- TypeScript strict, exécuté par Node (retrait des types) : pas d'étape de compilation, pas de syntaxe qui en demande une (pas d'`enum`, pas de `namespace`).
- Une interface se conçoit par son parcours et sa maquette avant le code ; un écran se vérifie en capture, pas seulement à la compilation.
- Aucune attribution IA dans les commits.

## Travailler

- Toute feature passe par la skill `story` du kit (`spawnstudio:story` sous Claude Code, `spawn-story` sous OpenCode), dans le worktree de son fil. À tout moment, `spawn next` donne l'action exacte à faire.
- Exigences : `SGS-NN`, dans `docs/specs/`. Plans : `docs/plans/`.
- Moteur : node 24. Compiler, tester, lancer et capturer passent par `spawn engine`, jamais en direct : seule la sortie relue fait foi. Les commandes réelles sont déclarées dans `spawn.json` (section `node`) et dans `scripts/`.
- Les tests des adaptateurs qui demandent un moteur (Godot) ne font pas partie de la vérification d'une story.
