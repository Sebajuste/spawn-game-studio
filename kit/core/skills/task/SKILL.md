---
name: task
description: Exécute une tâche d'un plan de feature par délégation - brief, implémenteur, relecture, rounds de correction bornés, ledger. À utiliser pour chaque tâche d'un plan sous docs/plans/, appelée par la skill story ou pour reprendre une tâche interrompue.
---

# Tâche

Tu orchestres, tu ne codes pas. Tu ne corriges jamais toi-même : tout changement passe par un implémenteur.

`spawn next` donne l'étape exacte de la tâche en cours (lancer, attendre, relire, round, parquer) avec ses commandes : la suivre, puis le relancer. Ce qui suit en est le détail.

Chaque commande `spawn …` ci-dessous se copie telle quelle et se lance depuis le worktree du fil. Fichiers de travail : `<racine>/.spawn/tasks/<fil>/`, hors du worktree (chemins exacts donnés par `spawn next`).

Plafonds : `spawn limits` (JSON). `rounds` borne les rounds de correction, `model` est le modèle par défaut des agents, `escalation_model` celui de l'escalade. Ne jamais les supposer : les lire.

**La relecture par tâche n'est jamais supprimée**, quelle que soit la consigne sur le nombre d'agents. Cette skill ne fait tourner qu'un implémenteur et un relecteur à la fois (en pratique l'un après l'autre) : elle tient dans toute limite d'agents en parallèle (`parallel_agents`). Une limite d'agents se lit comme un parallélisme, pas comme un total pour la feature : ne jamais regrouper des tâches ni reporter leur relecture sur la relecture finale pour la respecter.

## Avant

Lire `spawn ledger`. Une tâche déjà terminée ne se relance pas. Une tâche lancée sans fin : lire son rapport s'il existe et reprendre à l'étape suivante ; sinon reprendre au dernier round noté. Le ledger et `git log` priment sur la mémoire.

## 1. Lancer

1. `spawn ledger task-started --task N` : l'outil note la base (tête du worktree) et écrit `N-brief.md` (section de la tâche dans le plan, exigences citées recopiées de la spec avec leur preuve, commits des tâches closes, Rulings). Ne pas l'écrire soi-même ; le compléter seulement sur NEEDS_CONTEXT.
2. Agent `spawnstudio:implementer`, modèle `model`. Prompt : une ligne de contexte, le chemin du brief (« lis-le d'abord »), le chemin du rapport `N-report.md`. Jamais d'historique collé ni le plan entier ; jamais deux implémenteurs en même temps.

## 2. Selon le statut

- **DONE** : relecture (étape 3).
- **DONE_WITH_CONCERNS** : lire les doutes. S'ils touchent la justesse, les traiter comme NEEDS_CONTEXT ; sinon les joindre à la relecture.
- **NEEDS_CONTEXT** : compléter le brief, reprendre le même implémenteur (SendMessage).
- **BLOCKED** : plus de contexte, le modèle `escalation_model` ou une découpe de la tâche dans le plan, avec un Ruling (`spawn ledger ruling …`). Un blocage qui demande de désactiver un test ou de relâcher une tolérance signale un code ou une spec faux, jamais un test à contourner.

## 3. Relecture

1. `git diff BASE..HEAD > N-package.diff` et `git log --oneline BASE..HEAD >> N-package.diff`.
2. Agent `spawnstudio:task-reviewer`, modèle `model`, une fois l'implémenteur revenu : chemins du brief, du rapport et du paquet. Jamais `HEAD~1`, jamais « ne signale pas ».
3. Spec KO, ou finding **Critique** ou **Important** : round de correction (étape 4). Finding **Mineur** : `spawn ledger minor --task N --detail "<finding>"`, la relecture finale le reprend.

## 4. Rounds de correction (`rounds` de `spawn limits` au plus)

- Rounds 1 à `rounds` − 2 : reprendre le même implémenteur (SendMessage) avec les findings numérotés.
- Deux derniers rounds : implémenteur neuf, modèle `escalation_model`, avec le brief, les findings et `git log BASE..HEAD`.
- Après chaque round : `spawn ledger round --task N --number R --detail "<findings traités> ; commits a..b"`, puis relecture bornée au diff du round.
- Dernier round encore KO : `spawn ledger task-parked --task N --detail "<ce qui reste>" --ruling "<décision> — <raison> — <coût si faux>"` et passer à la tâche suivante. La relecture finale la reprend.

## 5. Fin

- `spawn ledger task-done --task N --commits <a>..<b>`.
- Exécuter la ligne `ensuite :` qu'elle imprime : `spawn story update --task "Tâche N+1 : <titre>" --first-step "<geste exact>"`. Le premier geste est la commande ou le dispatch qui reprend le travail sans autre lecture, par exemple `skill spawnstudio:task, tâche N+1 de docs/plans/<plan>.md`.
