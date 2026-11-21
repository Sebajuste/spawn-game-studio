# Navigation de l'app (validé le 2026-11-20)

Maquette cliquable : `docs/maquettes/navigation.html`. Complète `docs/parcours.md` (« Structure de la fenêtre ») en y ajoutant les workspaces (`docs/workspaces.md`, D11) ; une fois validé, ce document remplace la barre de lieux de `docs/maquettes/workspaces.html`.

## 1. Constat (branche `poc/docker-runner`, 2026-11-20)

Quatre manières de naviguer coexistent, et aucune n'est celle de `parcours.md` :

| Écran | Navigation aujourd'hui |
|---|---|
| Accueil | plein écran, sans barre ; projets récents et workspaces en listes |
| Workspace | une barre « workspaces et projets », plus un bouton « ← Retour » dans la page |
| Projet ouvert depuis un workspace | une barre d'onglets en haut (`ws-bar` : ← workspace, projets frères) **et** une barre à gauche (stories par état) |
| Story | des onglets ; on en sort en cliquant ailleurs dans la barre |

Conséquences :

- on ne sait jamais où l'on est : pas de fil d'Ariane, la barre de gauche change de nature d'un écran à l'autre ;
- trois gestes de retour différents (bouton dans la page, bouton de la `ws-bar`, Fichier > Fermer) ;
- le champ « Nouvelle feature » et « Lancer » sont sur chaque écran du projet, contre la règle « une action, un seul niveau » (`parcours.md`) ;
- l'état de navigation est éparpillé (`workspaceId`, `game`, `view`, `tab`) : une seule partie passe dans l'URL, le retour arrière n'existe pas, et l'app ne rouvre que le dernier projet, pas le dernier lieu.

## 2. Principe

**Une seule coque, quel que soit l'écran.** Ce qui change d'un écran à l'autre, c'est la *portée* (un workspace ou un projet) et le *lieu* ouvert dans cette portée ; jamais la forme de la fenêtre.

```
┌ Menus ─────────────────────────────────────────────────────────────┐
├──────────────┬─────────────────────────────────────────────────────┤
│ Portée    ▾  │ Fil d'Ariane : Arena › ar-api › Backlog › …   │
│ (▶ Lancer)   ├─────────────────────────────────────────────────────┤
│──────────────│ En-tête du lieu ou de l'objet (titre, actions)      │
│ Lieux        │                                                     │
│  Accueil   2 │ Contenu                                             │
│  Backlog     │                                                     │
│  …           │                                                     │
├──────────────┴─────────────────────────────────────────────────────┤
│ Barre d'état : agents au travail (clic : la story) · service       │
└────────────────────────────────────────────────────────────────────┘
```

## 3. La portée

En haut de la barre de gauche, un bloc unique : le nom de la portée et sa nature (« workspace · 3 projets » ou « node 24 »). Pour un projet, ▶ Lancer à côté.

Un clic ouvre le **sélecteur de portée** (aussi Ctrl+P) : une recherche, puis les workspaces avec leurs projets en retrait, puis les projets hors workspace, puis « + Nouveau projet », « Ouvrir un projet… », « + Nouveau workspace ». Il remplace l'accueil, la `ws-bar`, la barre « workspaces et projets » et les sous-menus Fichier > Projets récents et Fichier > Workspaces (gardés comme raccourcis vers le même choix).

- Choisir un projet **depuis un workspace** garde le workspace comme parent : le fil d'Ariane commence par lui.
- Choisir un projet hors workspace, ou depuis la liste « hors workspace », n'a pas de parent.
- Un projet qui figure dans deux workspaces garde le parent par lequel on est arrivé.

L'accueil plein écran ne reste que quand **aucun projet ni workspace** n'existe (premier lancement) : Nouveau projet, Ouvrir un projet.

## 4. Les lieux

Les lieux dépendent de la portée et ne changent pas d'ordre. **Un lieu n'apparaît que s'il a quelque chose à montrer dans l'app actuelle** (pas de lieu vide) ; Versions, Architecture et Vision s'ajouteront à leur place quand ils seront codés.

| Portée | Lieu | Contenu | Création dans ce lieu |
|---|---|---|---|
| Projet | **Accueil** (Ctrl+1) | la conversation avec l'agent du projet, et à droite **À juger** : les stories qui attendent l'utilisateur (décision, recette), sinon ce qui tourne (`conversation.md`) | dire, dans la conversation (Ctrl+J) |
| Projet | **Backlog** (Ctrl+2) | les stories en cours et à venir ; filtres « Livrées » et « Fermées » (remplace l'Historique) | aucune : une feature se demande dans la conversation |
| Workspace | **Accueil** (Ctrl+1) | la même chose pour le workspace : sa conversation, et À juger pour tous ses projets, chaque carte avec son projet | dire, dans la conversation (Ctrl+J) |
| Workspace | **Epics** (Ctrl+2) | les epics en voies par projet (vue actuelle) | + Epic |
| Workspace | **Projets** (Ctrl+3) | les projets du workspace, état en une ligne ; clic : le projet, avec ce workspace pour parent | + Ajouter un projet (Retirer viendra avec sa route dans le service) |

Le badge à droite d'Accueil compte les cartes d'À juger. Le lieu par défaut d'une portée est Accueil.

## 5. Le fil d'Ariane

Toujours en tête de la zone principale, chaque segment cliquable sauf le dernier :

- `ar-api › Backlog`
- `Arena › ar-api › Accueil › equipment-routes`
- `Arena › Epics › ARN-2 Emplacement des équipements`

Il est le seul geste de retour : les boutons « ← Retour » et la `ws-bar` disparaissent. Alt+← et Alt+→ (et les boutons de la souris) parcourent l'historique de navigation.

## 6. Une page par objet

Une story s'ouvre sur la même page quel que soit le chemin (Accueil, Backlog, epic, barre d'état, Ctrl+K) ; le fil d'Ariane garde le lieu d'où l'on vient. Une story d'un epic, ouverte depuis le workspace, se montre dans la portée de son projet : `Arena › ar-db › Backlog › equipment-table`. Les onglets de la story font partie de la page, pas de la navigation (ils ne sont pas dans le fil d'Ariane).

Un epic a sa page (`Arena › Epics › ARN-2`) : critères, voies par projet, + Story.

## 7. Barre d'état

En bas, toujours : les agents au travail **dans la portée** (« 2 agents : ar-api/equipment-routes, tâche 2/4 · ar-site/… »), un clic ouvre la story ; à droite, l'état du service. Sans agent : « Aucun agent au travail ».

## 8. Une route, une adresse

Toute la navigation tient dans une seule valeur, écrite dans l'URL :

| Adresse | Écran |
|---|---|
| `#/p/hello-web` | projet hors workspace, Accueil |
| `#/p/hello-web/backlog` | son Backlog |
| `#/p/hello-web/backlog/s/greeting` | une story, ouverte depuis le Backlog |
| `#/w/arena` | workspace, Accueil |
| `#/w/arena/epics/ARN-2` | un epic |
| `#/w/arena/p/ar-api/home/s/equipment-routes` | une story de ar-api, ouverte depuis Accueil, avec Arena pour parent (`inbox`, l'ancien nom du lieu, est encore lu) |

- Un lien ou une capture de recette ouvre l'écran exact (remplace `#workspace=…&project=…`, encore lu une fois pour les liens existants).
- Au démarrage, l'app rouvre la dernière adresse (remplace la clé `spawn.game`) ; une adresse dont le projet ou le workspace a disparu ramène au sélecteur de portée.
- L'historique du navigateur porte le retour arrière.

## 9. Actions à leur niveau

| Niveau | Où | Actions |
|---|---|---|
| Application | menu Fichier, sélecteur de portée | nouveau projet, ajouter un projet existant ; nouveau workspace ; changer de portée ; Réglages (`reglages.md`) |
| Portée | bloc de portée (menu ▾), menu Workspace ou Projet | ▶ Lancer, ouvrir le dossier, réglages de la portée |
| Portée | Accueil | dire : la conversation (une story, un fix, un epic ou rien) |
| Lieu | en-tête du lieu | + Epic (Epics) ; la composition d'un workspace et sa suppression sont dans les Réglages |
| Objet | en-tête de la story ou de l'epic, menu ⋯ | gestes de la story, + Story (epic) ; renommer, abandonner ou supprimer dans le menu ⋯ |
| Activité | barre d'état | ouvrir la story au travail |

Le champ « Que veux-tu ? » permanent disparaît, et « + Nouvelle feature » aussi : dire passe par la conversation de l'Accueil (Ctrl+J y mène de partout dans la portée).

## 10. Raccourcis

| Raccourci | Effet |
|---|---|
| Ctrl+P | sélecteur de portée |
| Ctrl+1, Ctrl+2, Ctrl+3 | lieux de la portée, dans l'ordre |
| Ctrl+K | aller à un objet de la portée (stories ; epics dans un workspace) |
| Alt+←, Alt+→ | retour, avance |
| Ctrl+J | la conversation de la portée, curseur dans le champ |
| F5 | lancer le projet, ou la version de la story ouverte |
| Ctrl+W | fermer la portée : revient au parent (workspace) ou au sélecteur |
| Ctrl+, | Réglages (`reglages.md`) |
| Ctrl+O | ajouter un projet existant (`adoption.md`) |

## 11. Ce qui ne change pas

Le contrat du kit : chaque lieu se lit dans les données déjà servies (`/api/projects/:id/backlog`, `/api/workspaces`), plus la conversation de portée (`/api/…/talk`, `conversation.md`). À juger d'un workspace agrège les backlogs de ses projets côté app. Le contenu de la page d'une story et de ses onglets ne change pas.

## 12. Écarté

- **Arbre unique** (workspaces › projets › stories, comme un explorateur de fichiers) : simple, mais mêle lieux et objets dans la même barre, ce que `parcours.md` a corrigé.
- **Deux niveaux d'onglets** (workspace et projet en haut, lieux à gauche) : deux axes de navigation et plus de chrome pour le même contenu.

## 13. Décisions (2026-11-20)

1. Le modèle est retenu : une coque, une portée, des lieux, le fil d'Ariane, une adresse.
2. Seuls les lieux qui ont du contenu sont livrés sur cette branche ; Versions, Architecture et Vision viendront avec leur contenu.
3. Le champ « Que veux-tu ? » permanent est retiré. Remplacé d'abord par « + Nouvelle feature » dans le Backlog, puis (même jour) par la conversation de portée : l'Accueil remplace À traiter (`conversation.md`).
4. Le code de l'interface est organisé en composants : un fichier, une responsabilité ; les fichiers d'un même thème sont regroupés dans un dossier (`src/navigation/`, `src/shell/`, `src/project/`, `src/workspace/`, `src/story/`, `src/data/`, `src/shared/`, `src/i18n/`, `src/styles/`).
