# Essai : le périmètre tient-il dans OpenCode, sous-agents compris ? (phase 4 bis, D8)

Question : D8 notait un risque (issue opencode #5894) : en v1, le hook de plugin `tool.execute.before` ne couvrait pas les outils des sous-agents, ce qui trouerait le périmètre. À vérifier avant de bâtir l'adaptateur OpenCode.

## Montage

- OpenCode v2.2.6 (installé), modèle `lmstudio/qwen/qwen3.5-9b` (LM Studio, fournisseur intégré à OpenCode v2, 100 k de contexte), `opencode run --standalone --auto --format json`.
- Projet jetable : dépôt git, branche `feature/essai` réécrite localement, distant nu : seul un push forcé peut la publier.
- Plugin minimal `.opencode/plugins/garde/index.ts` (API v2 : `Plugin.define`, `ctx.permission.hook("evaluate", …)`) : met `effect = "deny"` avec un message si la ressource contient `push --force`, et journalise chaque hook reçu (`ctx.tool.hook("execute.before")`, `evaluate`).

## Résultats

| Cas | Plugin | Push forcé | Preuve |
|---|---|---|---|
| Session principale (agent `build`) | oui | refusé | distant inchangé ; le modèle recopie « refusé par le périmètre Spawn : push forcé » |
| Sous-agent `general` (session distincte, lancée par l'outil `subagent`) | oui | refusé | `evaluate` reçu avec `agent: "general"` et sa propre `sessionID` ; distant inchangé |
| Session principale | non (contrôle négatif) | exécuté | `forced update` sur le distant |

Le premier contrôle négatif a échoué pour une autre raison : le modèle a recopié le point final de la consigne (`git push --force origin feature/essai .`), refusé par git. Consigne corrigée (commande entre guillemets), le push a eu lieu. Leçon pour l'outillage : une commande à recopier va entre guillemets ou en bloc, jamais suivie de ponctuation.

Durée : 3,4 s pour un tour simple de Qwen 9B (8,8 k tokens lus), 17 s pour la délégation au sous-agent.

## Conclusion

- En v2, le **hook de permission `evaluate`** s'applique aux sous-agents : le risque de D8 est levé pour ce mécanisme. Le périmètre OpenCode passera par lui, pas par `tool.execute.before`.
- Les événements donnent ce qu'il faut pour réutiliser l'analyse du cœur : `action` (`shell`, `edit`…), `resources` (la commande, les chemins), `agent`, `sessionID`.
- Une règle `deny` de la config est finale et n'appelle pas le hook : le plugin ne doit pas compter dessus pour journaliser.
- Points ouverts pour l'adaptateur : le dossier courant d'une commande (le hook `ctx.shell.hook("create.before")` donne `cwd`), la création de worktrees (OpenCode a `run --worktree` et `ctx.worktree`, sans hook équivalent à `WorktreeCreate` : le kit les créera par `spawn`), les transcripts pour `spawn mesure` (`opencode session`, base de `opencode debug paths db`).
