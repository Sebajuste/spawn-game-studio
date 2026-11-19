# Modèle d'un projet Spawn (modèle validé le 2026-11-18)

Objectif (§0 de `kit-perimetre.md`) : l'utilisateur fixe la vision et décide de l'architecture ; il dit ce qu'il veut, puis juge ce qu'il voit. Le projet ne s'éloigne ni de sa vision ni de son architecture sans qu'il l'ait décidé.

Règle : aucun concept qui n'existe pas dans les outils de suivi courants (GitLab, Jira, GitHub), pour qu'un adaptateur de suivi reste possible (GitLab auto-hébergé d'abord).

## 1. Les objets

Cinq objets ; l'utilisateur en possède deux (vision, décisions d'architecture), l'outil tient le reste.

| Objet | Ce que c'est | Qui l'écrit | GitLab |
|---|---|---|---|
| **Vision** | ce qu'est le projet, pour qui, ce qu'il ne sera jamais | L'utilisateur seul | wiki ou fichier du dépôt |
| **Architecture** | carte du code (composants, dépendances), règles, décisions | carte et règles : l'outil ; décisions : l'utilisateur, sur proposition | fichiers du dépôt |
| **Version** | un numéro, un objectif, un contenu ; remplace le jalon | l'outil (et l'utilisateur pour planifier) | Milestone |
| **Epic** | des stories qui livrent un tout ; peut s'étaler sur plusieurs versions | le cadrage | Epic ou label |
| **Story** | une feature ou un bug, développé, recetté, livré | le cadrage | Issue (label feature / bug) |

La **tâche** reste interne à une story : écrite et menée par les agents, lue seulement. Le **backlog** n'est pas un objet : c'est la vue des stories non livrées.

## 2. Vision

`context/vision.md`, écrit à la création (quelques questions), modifiable par l'utilisateur seul.

- Chaque cadrage s'y confronte et le dit : « dans la vision » ou « hors vision : <ce qui en sort> ». Une feature hors vision est une décision pour l'utilisateur (l'accepter élargit la vision, qu'il réécrit).
- La feuille de route est la liste des versions avec leur objectif.

## 3. Architecture

Trois parties, dans le dépôt du projet (`docs/architecture/`) :

1. **Carte**, relevée depuis le code par l'outil, jamais déclarée par l'agent : composants, dépendances entre eux, état des règles. Nouvelle commande du contrat moteur (`architecture`), car ce qu'est un composant et une dépendance dépend du moteur (Godot : dossier de composant ; dépendance = `preload`, `load`, scène instanciée, classe utilisée). Recalculée à chaque fusion.
2. **Règles**, vérifiées par l'outil comme un test : rangement (déjà vérifié par `compile`), sens des dépendances (ex. Godot : `games` → `actors`, `gui` → `systems` → `libs` ; `libs` ne dépend de rien dans `core`), pas de cycle entre composants. Une règle cassée bloque la fusion.
3. **Décisions**, une par fichier (`decisions/NNN-titre.md`) : contexte, décision, raison, coût si elle est fausse (le format `ruling` du ledger). Proposées au cadrage, validées par le mainteneur, jamais écrites par un agent seul.

Ce qui devient une décision d'architecture, donc un point à valider au cadrage : un nouveau composant, une nouvelle dépendance entre composants, un contrat changé (signaux, API publique d'un composant, format de sauvegarde), une exception à une règle.

La dérive se voit : complexité d'un composant, dépendances qui montent ; l'outil propose alors une story de refactoring, visible dans le backlog.

## 4. Version

- **Numéro** `majeure.mineure.correctif`, **objectif** en une phrase (« Démo jouable »), **état** : prévue, en développement, correctifs, livrée.
- Toujours une version en développement (`0.1.0` à la création). Livrer crée la suivante. Corriger un bug d'une version livrée crée sa version de correctifs (`1.0.1`). L'utilisateur en planifie d'autres, ou valide celle que propose un cadrage.
- Livrer est le geste de l'utilisateur : preuve refaite par l'outil sur toute la version, notes de version tirées des stories, tag posé. Une version livrée ne change plus.
- Un correctif livré dans `1.0.1` est reporté par l'outil dans la version en développement, preuve refaite ; il n'est terminé qu'une fois reporté.

## 5. Story

- **Type** feature ou bug ; **titre** ; **demande** (la phrase de l'utilisateur) ; **résultat attendu** ; **critères d'acceptation** (au moins un, vérifiés à la recette) ; **hors périmètre** ; **version** ; **epic** (facultatif) ; **décisions d'architecture** qu'elle porte ; **état**.
- Un bug commence par sa **reproduction** : un test qui échoue, lancé par l'outil.
- Étapes : Cadrage, Conception, Développement, Vérification, Recette, Livraison (Reproduction avant le cadrage pour un bug, Report après la livraison pour un correctif). La planification (version, rang) n'est pas une étape : c'est un réglage, proposé par l'outil, changé par l'utilisateur quand il veut.
- État **brouillon** : créée par un cadrage pas encore validé ; se modifie comme toute story pas commencée, sur sa propre page.

## 6. Le pipeline (validé le 2026-11-18)

| # | Étape | Qui | Arrêt pour l'utilisateur |
|---|---|---|---|
| 1 | Nouvelle feature : une phrase | L'utilisateur | il écrit |
| 2 | **Cadrage** (le quoi) : compris, vision, choix, stories créées en **brouillon** dans le Backlog (résultat attendu, critères) | l'agent | **valider le cadrage** |
| 3 | Planification (quand) : version et rang ; par défaut la fin de la version en développement | l'outil propose | non : il glisse dans le Backlog ou Versions quand il veut |
| 4 | **Conception** (le comment), quand la story démarre : plan technique en tâches, impact sur l'architecture | l'agent | **seulement si l'architecture change** : une décision |
| 5 | Développement | les agents | non |
| 6 | Vérification : compilation, tests, smoke test, règles d'architecture | l'outil | non |
| 7 | **Recette** | L'utilisateur | **oui** |
| 8 | Livraison : fusion dans la branche de la version | l'outil | non |
| 9 | **Livrer la version** | L'utilisateur | quand il veut |

- Le découpage ne se modifie pas dans un formulaire de cadrage : le cadrage crée les stories en brouillon, chacune se corrige sur sa page, comme toute story pas commencée. L'écran de cadrage est un résumé (compris, vision, choix, liste des stories). Valider le cadrage fait passer ses brouillons à « prête ». On peut aussi cadrer soi-même, sans agent.
- L'architecture se décide à la conception, quand l'agent connaît le code : pas de dérangement si elle ne change pas. L'écart entre l'impact annoncé à la conception et la carte relevée après développement reste vérifié par l'outil.
- L'outil refuse qu'une story démarre sans résultat attendu ni critère d'acceptation (Definition of Ready).

## 7. Les gestes de l'utilisateur

Écrire la vision · valider un cadrage · décider d'une architecture (rare) · recetter · livrer une version · signaler un bug. Le reste se fait sans lui.

## 8. Décisions (validées le 2026-11-18, d'après les pratiques établies)

1. **Le périmètre d'une story en cours ne change pas** (Scrum, Kanban : critères fixés une fois le travail commencé). Une précision se dit dans la conversation ; une demande de changements à la recette reste dans les critères de la story. Un vrai changement de besoin passe par **« Ajouter une suite »** (nouvelle story liée) ou **« Abandonner et recadrer »** (fermée avec sa raison, une nouvelle repart au cadrage). Une story n'entre en développement qu'avec un résultat attendu et au moins un critère d'acceptation (Definition of Ready).
2. **Rien ne se supprime : on ferme, avec un motif** (ne sera pas fait, doublon, erreur), comme dans les outils de suivi. Les fermées sont masquées par défaut, l'historique reste.
3. **La carte d'architecture est une commande de l'adaptateur moteur** (`architecture`) : les règles d'architecture sont des fitness functions vérifiées comme des tests ; l'adaptateur s'appuie sur l'outil existant de sa pile (dependency-cruiser pour Node) et n'écrit sa propre analyse que là où rien n'existe (GDScript). Premier périmètre : dépendances entre composants et cycles. Décisions au format ADR.
4. **Règles de dépendance Godot par défaut** (principes de dépendances acycliques et stables ; « call down, signal up ») :
   - `games` assemble : peut dépendre de tout ;
   - `actors` et `gui` dépendent de `systems` et `libs`, pas l'un de l'autre (l'interface apprend ce qui se passe par signal ou par un système) ;
   - `systems` (les règles) ne dépend que de `libs` : testable sans scène ;
   - `libs` ne dépend de rien dans `core` ;
   - aucun cycle ; toute exception est une décision enregistrée.
   La règle « un enfant ne connaît pas son parent » (dans les scènes) attend une mesure qui la justifie.
