# Discussions : parler librement avec un agent

Statut : **proposition, à valider** (2026-11-20). Rien n'est codé. Étend `navigation.md` (un lieu de plus) et `modele.md` (aucun objet nouveau côté suivi : une discussion produit des stories et des epics existants, ou rien).

## 1. Besoin

Réfléchir à voix haute avec un agent qui connaît le projet, sans savoir d'avance ce qui en sortira : une idée qu'on abandonne, une question sur le code, un bug à corriger, une feature, un epic sur plusieurs dépôts. Aujourd'hui, la seule entrée est « + Nouvelle feature » : elle crée une story tout de suite, avant d'avoir réfléchi.

## 2. Principe

- Une **discussion** est une conversation ouverte avec un agent, dans une portée (un projet ou un workspace).
- L'agent **lit** tout ce que la portée contient (code de `develop`, backlog, epics, docs, vision) et **n'écrit rien** : ni code, ni story, ni epic. Il tourne hors de tout worktree de story, lancé en lecture seule par l'adaptateur d'agent (outils d'écriture retirés). Non vérifié : que le périmètre du kit (`guard/`) refuse aussi seul une écriture à la racine sur `develop` ; à prouver par un test avant de coder. S'il faut le changer, c'est le cœur : décision du mainteneur.
- Quand la discussion mène à quelque chose, l'agent écrit une **proposition** dans un bloc structuré de sa réponse ; l'app la montre en carte modifiable dans le fil.
- **Seul le clic de l'utilisateur crée** (§0 : maîtrisé). L'app crée par les commandes existantes du kit, puis la carte devient un lien vers l'objet créé.

## 3. Ce qu'une discussion peut produire

| Issue | Carte proposée | Création (au clic) |
|---|---|---|
| Rien | aucune | la discussion reste dans l'historique |
| Un correctif | story **bug** : titre, demande, reproduction attendue, critères | `spawn story create` (type bug) ; elle commence par sa reproduction (`modele.md`) |
| Une feature | story **feature** : titre, demande, résultat attendu, critères, hors périmètre | `spawn story create` (type feature) |
| Un epic (workspace) | epic : titre, critères ; une story par projet touché, ordre (`blocked_by`) | registre des workspaces, puis une story par projet, rattachées à l'epic |

Un « simple fix » reste une story : tout changement de code passe par un fil, une preuve et une recette (`modele.md`, règle 1 ; « vérifié » du §0). La discussion le rend seulement rapide à lancer.

Plusieurs propositions peuvent sortir d'une même discussion ; chacune se crée ou s'écarte séparément.

## 4. Place dans la navigation

- Nouveau lieu **Discussions**, premier de chaque portée (projet : Discussions, À traiter, Backlog ; workspace : Discussions, À traiter, Epics, Projets). Ctrl+1..4 suivent l'ordre.
- Le lieu liste les discussions de la portée (titre tiré du premier message, date, ce qu'elles ont produit) ; « + Nouvelle discussion » en tête.
- Une discussion a son adresse : `#/p/<projet>/talk/<id>`, `#/w/<ws>/talk/<id>` ; fil d'Ariane `Shop › Discussions › <titre>`.
- **Ctrl+J** ouvre une nouvelle discussion dans la portée courante, de partout.
- Depuis une story ou un epic, « Discuter » ouvre une discussion qui part de cet objet (son titre et son état sont donnés à l'agent).

## 5. Service

- Nouveau module `discussions` (service, hors cœur) : `GET/POST /api/{projects|workspaces}/:id/discussions`, `POST …/:did/messages`, `POST …/:did/stop`, `POST …/:did/proposals/:pid/create`.
- Les tours réutilisent les adaptateurs d'agent du kit (`kit/core/src/agent/`, importés, non modifiés) et l'événement de flux déjà poussé à l'app.
- Stockage : `.spawn/discussions/<id>.json` dans le projet ; pour un workspace, à côté de son registre. Une coupure ne perd rien (même règle que `conversation.ts`).
- La proposition est un bloc JSON balisé dans la réponse de l'agent, validé par le service (forme d'une story, `modele.md`) ; une forme invalide est montrée comme texte, jamais créée.

## 6. Interface

- Fil de messages au centre, saisie en bas ; à droite, les **propositions** de la discussion (cartes modifiables : Créer, Écarter).
- Réutilise les composants de la conversation de story (`src/story/conversation/`) ; nouveau dossier `src/discussion/` (un fichier par responsabilité).

## 7. Décisions à prendre

1. Placement : lieu « Discussions » (proposé) plutôt qu'un panneau global ou un remplacement de « + Nouvelle feature ».
2. Agent : celui configuré pour le projet (comme les stories) ; pour un workspace, celui du premier projet, réglable.
3. « + Nouvelle feature » reste (création directe quand on sait déjà) ou disparaît au profit d'une discussion.
