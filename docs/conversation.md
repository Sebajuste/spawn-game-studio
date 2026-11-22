# Conversation de portée (validé le 2026-11-20)

L'objectif (§0 de `kit-perimetre.md`) : l'utilisateur **dit** ce qu'il veut et **juge** ce qu'il voit ; tout le reste se fait sans lui. L'app avait deux gestes pour « dire » (le champ « + Nouvelle feature », la création d'epic) et aucun pour réfléchir à voix haute. Elle a désormais un seul lieu pour dire, la conversation, et un seul pour juger, la colonne « À juger » à côté.

## 1. Le principe

Chaque portée (un projet, un workspace) a **une conversation continue** avec son agent. On y parle librement : une idée, un doute, un bug vu en recette, une question sur le code. La discussion aboutit à ce qu'elle aboutit :

- **rien** : on a juste parlé, l'agent a répondu (il lit le code, le backlog, la vision) ;
- **une story** : l'agent la crée par le service ; elle part tout de suite (cadrage puis spec) ;
- **un fix** : c'est une story, petite ; l'agent l'écrit comme telle (« Corrige… ») ;
- **un epic** (workspace) : l'agent le crée avec ses stories par projet et leur ordre.

Pas de carte de proposition, pas de bouton « Créer » : l'utilisateur ne juge pas une intention, il juge le résultat. Les gardes existent déjà : une story créée s'arrête à la spec (« Valider la spec » dans À juger) avant toute ligne de code, et une story d'epic attend ses dépendances après sa spec (`next.ts`). Ce que l'agent a créé s'affiche dans la conversation, vérifié par le service, avec un lien vers la story ou l'epic.

## 2. L'écran

La conversation devient le lieu par défaut de la portée, **Accueil** (Ctrl+1), à la place d'« À traiter » :

```
┌ Portée ──────┬───────────────────────────────────────┬─ À juger (2) ─────────┐
│ ▸ Accueil  2 │  toi : les joueurs perdent leur score │  Valider la spec      │
│   Backlog    │  agent : c'est la page Rejouer qui…   │  score-par-joueur     │
│              │  ✓ Story créée : Garder le score →    │  Recetter             │
│              │                                       │  menu-principal       │
│              │  [ Dis ce que tu veux…        ] Envoyer│                       │
└──────────────┴───────────────────────────────────────┴───────────────────────┘
```

- Au centre, la conversation : les mêmes bulles et lignes d'outil que celle d'une story (`src/story/conversation/`), Envoyer, Stop.
- À droite, **À juger** : les cartes d'À traiter (décision, recette), et ce qui tourne quand il n'y a rien. Le badge du lieu compte ces cartes.
- Le lieu Backlog garde la liste et ses filtres ; il perd « + Nouvelle feature » (dire passe par la conversation).
- Ctrl+J met le curseur dans la conversation, de partout dans la portée (y revient d'abord si l'on est ailleurs).

## 3. L'agent de la conversation

- **Agent** : celui des réglages du projet (le premier projet du workspace pour un workspace), Claude Code par défaut ; une session reprise d'un message à l'autre.
- **Où il tourne** : dans un worktree détaché de `develop`, `.claude/worktrees/_talk` (`_talk-<workspace>` pour un workspace, dans son premier projet). Le `_` rend le nom impossible pour une story (`createWorktree` ne garde que `[a-z0-9-]`). Avant chaque tour, le service le remet sur `develop` (`checkout --detach --force`, `clean -fd`) : ce que l'agent y écrirait ne survit pas et ne touche ni le checkout de l'utilisateur ni les fils. Le guard confine ses écritures à ce worktree.
- **Ce qu'il sait** : au premier tour d'une session, le service lui donne son rôle, le protocole d'action, les projets de la portée (chemins, pour la lecture) et les titres du backlog en cours.
- **Comment il agit** : il termine sa réponse par un bloc ```` ```spawn ```` contenant un objet JSON par action. Le service lit les blocs à la fin du tour et exécute :
  - `{"create": "story", "request": "…"}` (projet) ou `{"create": "story", "project": "<id>", "request": "…"}` (workspace) : la même création que l'ancien champ (titre, nom, worktree, premier message à l'agent de la story) ;
  - `{"create": "epic", "title": "…", "acceptance": ["…"], "stories": [{"project": "<id>", "request": "…", "after": [0]}]}` (workspace) : l'epic, puis ses stories dans l'ordre, chacune bloquée par celles d'`after` (indices dans la liste).
  Une action invalide n'est pas exécutée ; la raison s'affiche dans la conversation.
- **Ce qu'il ne fait pas** : coder, fusionner, juger à la place de l'utilisateur. Une décision de vision ou d'architecture passe par une story (la spec la montre à l'utilisateur).

## 4. Stockage et service

- Projet : `<racine>/.spawn/talk/` (`state.json`, `turn-N.jsonl`). Workspace : `~/.spawn/talk/<workspace>/` (jamais dans le dépôt d'équipe de `SPAWN_WORKSPACES`).
- Routes : `GET|POST /api/projects/:id/talk`, `POST /api/projects/:id/talk/stop`, et les mêmes sous `/api/workspaces/:id/talk`. Événements : `talk` (au fil du tour), `talk-end`.
- Vue : celle d'une conversation de story, chaque tour portant en plus ses `actions` (`{ kind, ok, project?, story?, epic?, title?, error? }`).
- La création de story est extraite du module backlog (`requestFeature`) : un seul chemin pour créer une feature.

## 5. Hypothèses et non vérifié

- Le guard laisse l'agent lire hors de son worktree (autres projets d'un workspace) : vérifié par la lecture de `guard/analysis.ts` pour l'écriture seulement ; la lecture hors projet n'est pas testée ici.
- Un tour coupé (app fermée) est marqué interrompu ; il n'est pas repris tout seul : on reprend en écrivant.
- Le bloc ```` ```spawn ```` dépend du respect de la consigne par l'agent ; un bloc mal formé est montré comme refusé, jamais deviné.

## 6. Écarté

- Une page « Discussions » séparée, avec des cartes « Créer » (première version de cette proposition) : un lieu de plus et un geste de validation qui doublonne la spec.
- Faire appeler `spawn` par l'agent pour créer : le CLI ne crée pas le worktree ni ne lance l'agent de la story ; le service le fait déjà.
- Faire tourner l'agent à la racine du projet : ses écritures toucheraient le checkout de l'utilisateur.