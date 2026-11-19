---
name: review
description: Relecture finale d'une feature entière (MERGE_BASE..HEAD) par le modèle le plus capable, avec les mineurs reportés et les tâches parquées, puis une seule correction et une seule re-relecture. À utiliser quand toutes les tâches du plan sont terminées ou parquées, avant finish-story.
---

# Relecture finale

Chaque commande `spawn …` ci-dessous se copie telle quelle et se lance depuis le worktree du fil. Fichiers de travail : `<racine>/.spawn/tasks/<fil>/`, hors du worktree (chemins exacts donnés par `spawn next`).

1. `MERGE_BASE=$(git merge-base develop HEAD)`. Écrire `final-package.diff` : `git diff MERGE_BASE..HEAD` puis `git log --oneline MERGE_BASE..HEAD`.
2. Écrire `final-remaining.md` : les lignes `mineur reporté` et `parquée` de `spawn ledger`, telles quelles.
3. `spawn story update --task "relecture finale" --first-step "skill spawnstudio:review"`.
4. Agent `spawnstudio:task-reviewer`, modèle `escalation_model` de `spawn limits`. Prompt : chemins de la spec, du plan, du paquet et du reste ; consigne de relire la feature comme un tout (cohérence entre tâches, exigences couvertes, contrôles négatifs présents) et de statuer sur chaque ligne du reste.
5. Aucun finding : `spawn ledger final-review --verdict clean`, puis finish-story.
6. Sinon, **un seul** correcteur pour toute la liste : agent `spawnstudio:implementer` neuf, modèle `escalation_model`, avec la spec, le paquet et la liste des findings (rapport `final-report.md`). Puis `spawn ledger final-review --verdict changes --detail "<findings corrigés> ; commits a..b"` (compté comme un round par `spawn metrics`).
7. **Une seule** re-relecture, `spawnstudio:task-reviewer` modèle `escalation_model`, bornée au diff de la correction et à la liste.
8. Ce qui reste après la re-relecture :
   - Critique ou Important : la feature n'est pas prête. `spawn story update --status blocked:<raison>` et le dire à l'utilisateur ; ne pas lancer finish-story.
   - Mineur : `spawn ledger ruling --decision "reporter : <finding>" --reason "<raison>" --cost "<coût si faux>"`. Il figurera au rapport final comme dette : rien n'est caché.
