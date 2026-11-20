# Workspaces : plusieurs projets, une équipe agile (validé)

Stockage retenu : JSON versionné par git (pas SQLite). Par défaut `~/.spawn/workspaces.json` ; `SPAWN_WORKSPACES=<chemin>` le place dans un dépôt git d'équipe pour le partager (commit et pull à la main pour l'instant). Écriture atomique.

Statut : **validé**. Codé : registre `workspaces.json`, module de service `workspaces`, règle `blocked_by` dans `spawn next`. Pas encore codés : l'interface, le champ `epic` dans l'état des stories, l'interface de plugins de suivi. Elle étend `modele.md` (qui reste vrai pour un projet seul) et respecte sa règle : aucun concept absent des outils de suivi courants (Jira, GitLab, GitHub), pour qu'un adaptateur de suivi reste possible.

## 1. Le besoin

Un produit se fait souvent en plusieurs dépôts (site, API, base de données), chacun avec son git. Une feature peut toucher plusieurs d'entre eux, et un dépôt peut servir plusieurs produits. L'équipe travaille en agile (backlog, epics, stories, recette) et suit son travail dans Jira ; on ne sait pas encore si l'outil pourra s'y brancher.

## 2. Le modèle

| Objet | Ce que c'est | Équivalent Jira |
|---|---|---|
| **Projet** | un dépôt git + un moteur (inchangé, `modele.md`) | composant ou dépôt |
| **Workspace** | un ensemble nommé de projets, qui forme un produit | projet / board |
| **Epic** | des stories qui livrent un tout, **qui peuvent viser plusieurs projets** | Epic |
| **Story** | un livrable dans **un seul projet** : une branche, un jugement, une fusion | Story / Task |

- Un projet peut figurer dans plusieurs workspaces. Le workspace n'est qu'une liste : il ne possède pas le dépôt.
- Une feature qui touche trois dépôts est un **epic de trois stories**, une par dépôt. Il n'y a pas de story multi-dépôts : chaque story est jugée et fusionnée seule, comme aujourd'hui. Pas de fusion groupée ni de retour en arrière.
- `modele.md` §1 définit déjà l'epic (« des stories qui livrent un tout ») : ce qui change, c'est qu'il peut sortir d'un projet. Version, vision et architecture restent propres à chaque projet.

## 3. Ordre et contrat

- Une story peut **dépendre** d'une autre (`blocked_by`), dans le même projet ou dans un autre : base de données → API → site.
- Une story n'est proposée au démarrage que quand ses dépendances sont **fusionnées** dans leur projet.
- La première story de l'ordre fixe le **contrat** entre les projets (schéma d'API, migration). Il est écrit dans le dépôt qui le porte (celui de l'API), pas ailleurs : les stories suivantes le lisent dans le dépôt, à la version fusionnée.
- Le cadrage d'un epic nomme les projets touchés, l'ordre et le contrat. Valider le cadrage crée les stories en brouillon, une par projet.

## 4. Stockage

- **Un fichier local `~/.spawn/workspaces.json`**, comme le registre des projets (`registry.ts`). Pas de git propre au workspace : il n'a pas de contenu à versionner, seulement une liste et des références.

```json
{
  "workspaces": [
    {
      "id": "arena",
      "name": "Arena",
      "projects": ["site", "api", "db"],
      "epics": [
        {
          "id": "ARN-12",
          "title": "Intégration d'un fournisseur",
          "acceptance": ["l'état d'un équipement est visible dans le site"],
          "stories": [
            { "project": "db", "story": "equipment-table" },
            { "project": "api", "story": "equipment-state", "blocked_by": [{ "project": "db", "story": "equipment-table" }] },
            { "project": "site", "story": "equipment-view", "blocked_by": [{ "project": "api", "story": "equipment-state" }] }
          ]
        }
      ]
    }
  ]
}
```

- La story reste **dans son projet** (`.spawn/stories/`, inchangé) et porte en plus l'identifiant de l'epic. Les projets ne connaissent pas le workspace : un projet dans deux workspaces ne change rien chez lui.
- Les identifiants d'epic sont locaux (`ARN-12`). Un plugin de suivi pourra les faire correspondre aux clés du tracker externe.

## 5. Plugins de suivi

Le service a déjà des modules activables (`ServiceModule`). Une petite interface :

- `list()` : features et stories avec leur état ;
- `update(ref, état)` : écrire un changement d'état ;
- `create(story)` : créer une story à partir d'un cadrage.

Le suivi **local** (`workspaces.json`) en est l'implémentation par défaut. Un plugin Jira, GitHub Issues ou GitLab viendra plus tard, sans toucher au reste. Rien n'est supposé sur l'accès à Jira : à établir avec l'équipe concernée avant tout plugin.

## 6. Ce que ça change dans l'outil

| Zone | Changement | Cœur du kit ? |
|---|---|---|
| Registre | `workspaces.json`, lecture/écriture, validation (projets connus, pas de cycle de dépendance) | non (service) |
| Story | champ `epic` (référence), `blocked_by` | oui (`stories.ts`, schéma) |
| `spawn next` | ne propose pas une story dont une dépendance n'est pas fusionnée | oui (`next.ts`) |
| Périmètre | un agent ne touche que le projet de sa story | non (déjà par projet) |
| Service / app | vue « epic » : stories par projet, ordre, avancement ; barre latérale groupée par workspace | non |
| Cadrage | l'agent propose les stories par projet et l'ordre, l'utilisateur valide | skill `story` |

Le cœur du kit ne change qu'avec le mainteneur, hors d'une story (`CLAUDE.md`) : deux fichiers sont concernés (`stories.ts` et `next.ts`).

## 7. Ouvert

- Un projet dans deux workspaces : une story est identifiée par son projet et son nom, jamais par le workspace ; deux epics peuvent donc viser le même projet sans collision de branches. À vérifier dans le code du registre et du backlog.
- Équipe : `workspaces.json` est local. Le partager entre personnes demande un autre support (un dépôt, ou le tracker externe) : pas avant d'en avoir besoin.
- Pull requests à la place de la fusion locale, si l'équipe les impose.
- Qui joue le Product Owner (la recette) quand plusieurs personnes travaillent sur un epic.

## 8. Étapes proposées

1. Valider ce document (D11 dans `kit-perimetre.md`).
2. Fichier `workspaces.json` et vue epic dans l'app, sans toucher au cœur : on y lit les stories existantes de plusieurs projets.
3. `blocked_by` et ordre dans `spawn next` (cœur, par le mainteneur).
4. POC : trois dépôts (base, API, site) sur le projet Arena, un epic de trois stories.
5. Interface de suivi et plugins, quand l'accès à Jira est clarifié.
