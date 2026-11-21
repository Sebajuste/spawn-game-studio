# Réglages et actions sur les objets (validé le 2026-11-21)

> Complète `navigation.md` (§9, §10). Maquette : `docs/maquettes/reglages.html`. Adoption d'un projet existant : `adoption.md`.

## 1. Constat (branche `poc/docker-runner`, 2026-11-21)

- La langue et les modules sont dans le menu Affichage ; la suppression du workspace est un bouton au milieu du lieu Projets.
- Seul le projet a une fenêtre de réglages ; rien pour l'application ni pour le workspace.
- Un workspace ne se renomme pas, un projet n'en sort pas ; un projet ne quitte pas Spawn (la route existe, pas l'interface).
- Un epic ne se renomme ni ne se supprime ; « Abandonner » est un bouton posé dans l'en-tête de la story.
- Une confirmation passe par `window.confirm`, l'autre par un bandeau dans la page.

## 2. La règle

| Geste | Où |
|---|---|
| Un **réglage durable** | la fenêtre **Réglages**, une section par portée |
| Une **action sur un objet** (renommer, supprimer, retirer, abandonner) | le **menu ⋯** de l'en-tête de l'objet |
| Une **création** | un court dialogue (inchangés) |
| **Travailler** | les lieux : ils montrent et font travailler, ils ne gèrent rien |

Toute suppression passe par la même **confirmation**, qui dit la conséquence (« les projets restent sur le disque »).

## 3. La fenêtre Réglages

Ctrl+, ou Fichier > Réglages. À gauche les sections, à droite leur contenu ; chaque changement s'enregistre aussitôt (pas de bouton Enregistrer), sauf les champs texte, enregistrés à la sortie du champ.

| Section | Contenu |
|---|---|
| **Application** | Langue ; fonctions facultatives (les modules non socle, avec leur description et la raison d'un module indisponible) |
| **Workspace « nom »** (si la portée est un workspace, ou un projet dans un workspace) | Nom ; Projets : la liste, « Retirer » sur chacun, « Ajouter » (projets connus, « Ajouter un projet existant… », « Nouveau projet… ») ; Zone dangereuse : Supprimer le workspace (ses projets restent) |
| **Projet « nom »** (si la portée est un projet) | Agent, modèle local, contexte (les réglages machine d'aujourd'hui) ; Projet : moteur, version, préfixe d'exigences et dossier, en lecture ; Zone dangereuse : Retirer de Spawn (le dossier reste, il se rouvre par « Ajouter un projet existant ») |

On y entre aussi par :

- le **menu ▾ du bloc de portée** : « Réglages du workspace… » ou « Réglages du projet… » ouvrent la fenêtre sur la bonne section ;
- le menu Workspace ou Projet > Réglages.

## 4. Les menus

| Menu | Entrées |
|---|---|
| Fichier | Nouveau projet (Ctrl+N), Ajouter un projet existant (Ctrl+O), Changer de portée (Ctrl+P), Projets récents, Nouveau workspace, Workspaces, Réglages (Ctrl+,), Fermer la portée (Ctrl+W) |
| Workspace ou Projet (selon la portée ; absent hors portée) | Parler (Ctrl+J), Lancer (F5, projet), Ouvrir le dossier (projet), Réglages |
| Affichage | Aller à (Ctrl+K), les lieux (Ctrl+1…) |
| Aide | inchangé |

La langue et les modules quittent Affichage.

## 5. Le menu ⋯ des objets

Un bouton ⋯ à droite de l'en-tête de l'objet ; il s'ouvre au clic, se ferme sur Échap ou en dehors, se parcourt au clavier.

| Objet | Entrées |
|---|---|
| Story | Renommer (F2), Abandonner (confirmation partagée) |
| Epic | Renommer, Supprimer (confirmation : les stories restent dans leurs projets) |

Le bloc de portée a son menu ▾ : Changer de portée (Ctrl+P), Réglages du workspace ou du projet.

## 6. Les fenêtres

| Fenêtre | Rôle |
|---|---|
| La coque | menus, barre latérale, fil d'Ariane, lieu, barre d'état |
| Sélecteur de portée (Ctrl+P), Aller à (Ctrl+K) | inchangés |
| Dialogues de création | Nouveau projet, Nouveau workspace, Nouvel epic, + Story (epic) |
| **Ajouter un projet existant** | diagnostic puis adoption (`adoption.md`) ; remplace « Ouvrir » |
| **Réglages** | §3 ; remplace la fenêtre de réglages du projet |
| **Confirmation** | une seule, pour toute suppression ou abandon |

## 7. Service

Routes ajoutées (module `workspaces`, fonctions dans `kit/core/src/workspaces.ts`, hors cœur) :

- `PATCH /api/workspaces/:id` `{ name }` : renommer (l'identifiant ne change pas) ;
- `DELETE /api/workspaces/:id/projects/:project` : retirer un projet (refusé s'il porte une story d'un epic du workspace : la retirer d'abord de l'epic) ;
- `PATCH /api/workspaces/:id/epics/:epic` `{ title }` : renommer ;
- `DELETE /api/workspaces/:id/epics/:epic` : supprimer l'epic (les stories restent dans leurs projets).

`DELETE /api/projects/:id` existe : il retire aussi le projet des workspaces qui le citaient.

## 8. Décisions (2026-11-21)

1. Une seule fenêtre Réglages, une section par portée ; les actions sur un objet dans son menu ⋯ ; une seule confirmation.
2. « Ouvrir un projet » devient « Ajouter un projet existant » et adopte le dossier s'il n'est pas encore un projet Spawn (`adoption.md`).
3. Pas de réglage de thème ni de préférences d'affichage : rien ne les demande.
