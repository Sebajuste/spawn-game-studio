# Workspaces : plusieurs projets, une équipe agile (validé)

Stockage retenu : JSON versionné par git (pas SQLite). Par défaut `~/.spawn/workspaces.json` ; `SPAWN_WORKSPACES=<chemin>` le place dans un dépôt git d'équipe pour le partager (commit et pull à la main pour l'instant). Écriture atomique.

Statut : **validé**. Codé : registre `workspaces.json`, module de service `workspaces`, règle `blocked_by` dans `spawn next`, interface (portée workspace et ses lieux Accueil (conversation et À juger, `conversation.md`), Epics, Projets selon `navigation.md` ; vue epic en voies avec les métriques du pilote : durée, interventions, cache lu ; adresse `#/w/<id>`). Pas encore codés : lieu Activité par workspace, le champ `epic` dans l'état des stories, l'interface de plugins de suivi. Elle étend `modele.md` (qui reste vrai pour un projet seul) et respecte sa règle : aucun concept absent des outils de suivi courants (Jira, GitLab, GitHub), pour qu'un adaptateur de suivi reste possible.

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

## 9. Résultat du POC (étape 4)

Trois dépôts (`ar-db`, `ar-api`, `ar-site`), epic ARN-1, trois stories chaînées par `blocked_by`, pilotées par Copilot en Docker : **les trois sont fusionnées dans `develop`**, dans l'ordre. Le contrat passe de dépôt en dépôt par un fichier (`docs/schema.md` → `docs/contract.md` → page du site), lu sans être modifié.

| Story | Durée | Interventions | cache_read |
|---|---|---|---|
| ar-db/equipment-schema | 9 min (reprise ; 1er essai abandonné à 18 min) | 2 | 2,1 M |
| ar-api/equipment-routes | 38 min | 4 | 8,3 M |
| ar-site/equipment-page | 44 min | 4 | 10,4 M |

Vérifié : `spawn next` répond « en attente d'une dépendance » tant que l'amont n'est pas fusionné ; la suppression du worktree après fusion fonctionne (correctif EPERM).

Écarts relevés, **corrigés ensuite** (cœur, avec l'accord du mainteneur) :

- Un projet sans `launch` (bibliothèque) n'a pas de capture : `spawn ledger captures --verdict valid` sans `--paths` est admis quand l'adaptateur répond `not-declared` à une capture (vérifié par l'outil, pas par l'agent) ; la preuve (compilation, suite, smoke test, bout en bout) reste faite. Un projet qui peut capturer garde l'obligation de captures.
- Le texte de l'étape `spec` ne cite plus « TypeScript, React, Rust » pour un projet node (`framing` de `adapter.json`).
- `spawn prerequisites` n'exige plus `claude` (il ne sert qu'à Claude Code) ; ses contrôles propres ne s'appliquent que s'il est présent ou si le projet porte `.claude/settings.json`.
- `new-project --engine node` crée un gabarit sans dépendance (serveur, test unitaire, bout en bout, smoke test, section `node`).
- `spawn pilot` refuse d'être lancé depuis un worktree de fil, et accepte `--project <racine>`.

Origine du premier écart : sans capture possible, l'étape de preuve bloquait et le pilote abandonnait (« 3 tours sans changement », 18 min) ; le POC l'avait contourné par une page HTML servie au lancement. Le champ `epic` sur la story n'a pas été nécessaire : le lien se lit dans `workspaces.json`.

### Second essai (ARN-2, après corrections)

Même chaîne `ar-db` → `ar-api` → `ar-site`, même agent (Copilot en Docker) : un champ optionnel `location` qui traverse les trois contrats. Les trois stories sont fusionnées.

| Dépôt | ARN-1 | ARN-2 | cache_read ARN-1 → ARN-2 |
|-------|--------|--------|----------------------------|
| ar-db | 9 min | 14 min | 2,1 M → 2,8 M |
| ar-api | 38 min | 12 min | 8,3 M → 2,7 M |
| ar-site | 44 min | 11 min | 10,4 M → 2,2 M |
| Total | 91 min | 37 min | 20,8 M → 7,7 M |

Le test réel de l'API et du site ensemble donne les résultats attendus : `location` vide ou non string refusé (400), filtre par emplacement, page qui affiche l'emplacement (échappé). Non vérifié : la qualité du code relu, et l'effet de la difficulté (la feature est plus petite que ARN-1, la comparaison n'est donc pas à iso-travail).

Écart relevé : la commande `spawn next` donnée à l'agent est un chemin relatif au dossier d'où le pilote est lancé (`next.ts`, `SPAWN`, mode dépôt). Lancé depuis un autre dossier, l'agent ne trouve pas la commande et le pilote abandonne en 2 min. Sans effet avec le runtime installé (commande `spawn`).


