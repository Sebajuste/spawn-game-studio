# Plan : agir sur une story et suivre son avancement (P11)

**Spec :** docs/specs/2026-11-18-agir-sur-une-story-et.md

Commande de preuve : `node "C:\Users\<utilisateur>\.spawn\runtime\0.1.0+ee9032a\kit\core\src\cli.ts" engine test` (suite complète) ou avec `--filter <motif>`. Compilation : `engine compile`. Aucun fichier du cœur du kit n'est modifié (`next.ts`, `merge.ts`, `acceptance.ts`, `ledger.ts`, `plan.ts`… ; voir CLAUDE.md) : on les lit, on ne les change pas. `kit/core/src/progress.ts` n'est pas du cœur.

**Remise d'un message dans le tour en cours (hors périmètre, constat pour la décision à venir)** : l'adaptateur d'agent (`kit/core/src/agent/`) reçoit un message par tour (`turn({ message, … })`, `claude -p`). Remettre un message pendant le tour demanderait soit `claude -p --input-format stream-json` avec l'entrée standard gardée ouverte (le moment où un message écrit en cours de tour est lu n'est pas documenté), soit l'Agent SDK (mode d'entrée en flux), une dépendance nouvelle. Dans les deux cas, l'interface `AgentAdapter` change (un tour qui accepte des messages en cours) : c'est un changement du contrat des agents, à proposer à part. Ici : remise à la fin du tour.

## Tâche 1 : une seule étape en cours, celle de spawn next

- **Fichiers touchés** : `kit/core/src/progress.ts`, `kit/core/test/progress.test.ts`.
- **Exigences couvertes** : SGS-37, SGS-39, et la part « avancement » de SGS-40 (aucun libellé d'activité dans les étapes).
- **Interfaces produites** :
  - `progress(root, story, step: string | null): { steps: ProgressStep[]; unknownStep: string | null }` ; `step` est l'étape rendue par `nextAction(...).step`.
  - `export function stepIndex(step: string): ProgressStep["id"] | "none" | "finished" | null` : `spec`, `spec à revoir` → `understand` ; `plan`, `plan introuvable`, `plan illisible` → `breakdown` ; `tâche …`, `correction demandée` → `tasks` ; `relecture finale`, `corrections de la relecture finale`, `relecture finale approuvée`, `worktree à commiter`, `preuve et captures`, `compte rendu à juger` → `proof` ; `à juger` → `acceptance` ; `fusion`, `fusion refusée (…)`, `après fusion` → `merge` ; `terminé` → `finished` ; `en attente de l'utilisateur`, `fils en cours`, `aucun fil`, `état absent` → `none` (l'étape reste celle que donne le ledger) ; toute autre chaîne → `null` (non reconnue).
  - Règle : l'étape en cours est celle de `stepIndex(step)` ; les précédentes sont `done`, les suivantes `pending`. Pour `none` ou `step === null`, l'étape en cours est la première que le ledger ne donne pas faite, avec la même règle (jamais une étape faite après une non faite). `finished` ou fusion faite : tout est `done`. Non reconnue : aucune étape `current`, les étapes jusqu'à la première non faite du ledger restent `done`, et `unknownStep` vaut le texte de l'outil. Abandon : inchangé (rien de non fait ne passe pour fait).
  - Les détails d'étape ne décrivent plus une activité : Cadrage n'a plus « en cours d'écriture » (`null` quand la spec n'est ni proposée ni validée ; « à valider » quand elle attend l'utilisateur).
- **Test d'abord** (nom commençant par « progress: ») : adapter les tests existants au nouveau retour ; ajouter (a) une étape par chaîne connue de `stepIndex` donne exactement une `current` à la bonne place ; (b) **contrôle négatif** : le ledger de l'essai du 18/11 (celui de `dans-la-barre-de-menus-2` : `accepted`, puis tâche 2 démarrée et faite, nouvelle relecture, preuve) avec l'étape `fusion refusée (failing)` puis `tâche 3/3 : correction` ne donne jamais deux `current` ni une étape `done` après une non `done` ; (c) `step = "étape inventée"` → aucune `current`, `unknownStep === "étape inventée"` ; une étape connue → `unknownStep === null` ; (d) aucun `detail` ne contient « en cours d'écriture ».
- **Preuve** : `engine test --filter "progress:"`.

## Tâche 2 : l'étape dit pourquoi la story y revient

- **Fichiers touchés** : `kit/core/src/progress.ts`, `kit/core/test/progress.test.ts`.
- **Exigences couvertes** : SGS-38.
- **Interfaces produites** : `detail` de l'étape en cours :
  - « reprise après recette : <message> » quand le dernier `changes-requested` est postérieur au dernier `accepted` (ou sans `accepted`) et que l'étape en cours précède la Recette ;
  - « fusion refusée : <cause> » quand la dernière décision de fusion de la story (`readDecisions(root)`, lue sans modifier `merge.ts`, verdict `refused` ou `error`, postérieure au dernier `accepted`) n'est suivie d'aucun `merged`, que l'étape soit Livraison (`fusion refusée (…)`) ou Développement (tâche de correction ajoutée).
  - Les tâches ajoutées au plan après coup apparaissent à la suite dans `tasks` (déjà lues du plan : le vérifier par le test).
- **Test d'abord** (« progress: ») : redemande après recette → Développement en cours avec « reprise après recette : plus gros » ; décision de fusion refusée écrite dans `.spawn/merge/` (format de `readDecisions`) → Livraison en cours avec « fusion refusée : failing », puis tâche 3 ajoutée au plan → Développement en cours, 3 tâches listées, même motif ; **contrôle négatif** : une story menée sans retour en arrière n'a aucun détail commençant par « reprise » ou « fusion refusée ».
- **Preuve** : `engine test --filter "progress:"`.

## Tâche 3 : le service dit l'action longue et l'issue de la fusion

- **Fichiers touchés** : `service/src/contract.ts`, `kit/core/src/progress.ts` si un type y est partagé, `service/src/contract-check.ts` si les types du kit changent, `service/src/modules/backlog.ts`, `service/src/modules/conversation.ts` (date de début du tour en cours dans `ConversationSummary`), `src/api.ts` et `src/Story.tsx` seulement pour suivre le nouveau retour de `progress` (compilation), `service/test/backlog.test.ts`.
- **Exigences couvertes** : SGS-34, SGS-35.
- **Interfaces produites** :
  - `StoryView.operation: { kind: "merge" | "turn"; since: string } | null` (fusion prioritaire sur le tour) ;
  - `StoryDetail.progress` = `steps`, `StoryDetail.unknownStep: string | null`, `StoryDetail.lastMerge: { verdict: "merged" | "refused" | "error"; cause: string | null; commit: string | null; date: string } | null` (dernière issue connue : ledger `merged`, décisions de `readDecisions`, ou erreur gardée en mémoire par le module) ;
  - `POST …/:story/accept` pendant une fusion : 200 `{ merge: "running", since }` au lieu du 409 ; hors fusion, la story pas à juger reste refusée en 409 avec sa raison ;
  - le backlog passe à `progress` l'étape de `nextAction` (celle déjà calculée dans `view`).
- **Test d'abord** (« backlog: ») : dans le test de bout en bout du backlog (fusion réelle sur le projet factice), un second `accept` pendant la fusion rend `merge: "running"` et la même `since` que `operation.since` du détail ; après la fusion, `lastMerge.verdict === "merged"` avec le commit, `operation === null` ; **contrôle négatif** : `accept` sur une story non à juger → 409 avec la raison ; story au repos → `operation === null`.
- **Preuve** : `engine test --filter "backlog:"`, puis la suite complète (le contrat est partagé).

## Tâche 4 : à toi, en pause, arrêtée, et Reprendre

- **Fichiers touchés** : `service/src/contract.ts`, `service/src/modules/backlog.ts`, `service/src/modules/conversation.ts`, `service/test/conversation.test.ts` (ou `backlog.test.ts`).
- **Exigences couvertes** : SGS-40 (service).
- **Interfaces produites** :
  - `StoryView.waiting.reason` gagne `"paused"` (dernier tour arrêté par Stop) ; `"stopped"` garde la dernière phrase de l'agent en `text` ;
  - `group` : `paused` et `stopped` restent `active` (ils n'arrivent pas dans ce qui attend l'utilisateur) ; `spec-approval`, `question`, `interrupted` restent `blocked` ;
  - `POST …/conversation/resume` accepte un dernier tour coupé, arrêté par Stop ou fini sans point d'arrêt : coupé → `resumeMessage` comme aujourd'hui ; arrêté ou en pause → `RESTART_MESSAGE` ; refusé en 409 pendant un tour, et quand rien n'est à reprendre.
- **Test d'abord** (« conversation: ») : faux agent bloquant, Stop → vue `waiting.reason === "paused"`, `group === "active"`, `running === false` ; Reprendre → un tour démarre ; tour fini sans point d'arrêt (sans relance automatique) → `stopped` avec la dernière phrase du flux rejoué ; **contrôle négatif** : Reprendre pendant un tour → 409.
- **Preuve** : `engine test --filter "conversation:"`.

## Tâche 5 : messages en file

- **Fichiers touchés** : `service/src/contract.ts`, `service/src/modules/conversation.ts`, `service/src/modules/backlog.ts` (la fusion retient la file), `service/test/conversation.test.ts`.
- **Exigences couvertes** : SGS-41, SGS-42.
- **Interfaces produites** :
  - état de conversation persistant `queued: { id: string; message: string; date: string }[]`, exposé dans `ConversationView.queued` ;
  - `POST …/conversation` pendant un tour ou une fusion : 200 `{ queued: <id> }` au lieu du 409 ;
  - `DELETE …/conversation/queue/:qid` : retire ; 409 « déjà parti » si le message n'est plus en file ;
  - fin d'un tour (hors Stop et hors fermeture) : la file non vide part en un seul nouveau tour, messages dans l'ordre, séparés par une ligne vide ; elle passe avant la relance automatique. Après un Stop, la file reste et part avec Reprendre ou le prochain message ;
  - `ConversationModule.hold(projectId, story, work: Promise<unknown>)` : pendant une fusion, `send` met en file ; à la fin de `work`, la file part ; si la fusion est refusée, le rappel de l'agent (`send` du backlog) part en tête avec les messages en file, en un seul tour.
- **Test d'abord** (« conversation: ») : faux agent bloquant ; deux messages envoyés pendant le tour → `{ queued }` et visibles dans `queued` ; fin du tour → un seul nouveau tour dont le message contient les deux, dans l'ordre ; pendant un `hold`, un message part à la fin du `hold` ; **contrôles négatifs** : un message retiré ne part pas ; retirer un message déjà parti → 409.
- **Preuve** : `engine test --filter "conversation:"`, puis la suite complète.

## Tâche 6 : une action, un retour (interface)

- **Fichiers touchés** : `src/action.ts` (nouveau : petit hook `useAction`), `src/Story.tsx`, `src/Conversation.tsx`, `src/Home.tsx`, `src/App.tsx` si la nouvelle feature y est lancée, `src/App.css`.
- **Exigences couvertes** : SGS-33.
- **Interfaces produites** : `useAction()` rend `{ pending: string | null; refusal: { key: string; text: string } | null; run(key, f) }` : `pending` porte la clé du bouton cliqué ; la carte grise ses autres gestes tant que `pending` n'est pas nul ; un refus (erreur HTTP) s'affiche à côté du bouton de la clé, en mots simples (le message du service), et les gestes redeviennent actifs. Libellés en attente : « Validation… », « Envoi… », « Abandon… », « Pause… », « Reprise… », « Création… », « Renommage… ». Appliqué à : valider la spec, répondre, valider la recette, demander des changements, abandonner, pause, reprendre, envoyer un message, nouvelle feature, renommer. `{ merge: "running" }` n'est pas un refus : la carte passe au bandeau (tâche 7).
- **Test** : aucun (preuve « aucune » ; outillage de rendu React absent).
- **Preuve** : `engine compile`, puis `engine test`.

## Tâche 7 : bandeau d'action longue, frise et « qui travaille » (interface)

- **Fichiers touchés** : `src/Story.tsx`, `src/App.css`, éventuellement `src/Home.tsx` (libellés d'état dans la liste).
- **Exigences couvertes** : SGS-36, SGS-40 (interface), et l'affichage de SGS-37 à SGS-39.
- **Interfaces produites** :
  - `operation` non nul : la carte des gestes est remplacée par un bandeau « Fusion en cours : intégration à develop, suite complète des tests — <durée> » (durée recalculée chaque seconde depuis `since`) ou, pour un tour, « L'agent travaille… — <durée> » avec le point vivant ; aucun bouton Valider ;
  - issue dans le même bandeau, d'après `lastMerge` : « Livrée dans develop (abc1234) » ; « Fusion refusée : <cause>. L'agent corrige, puis réinscrit ; rien à faire pour toi. » ; erreur : « Fusion en erreur : <cause> » ;
  - sans tour en cours, plus de libellé d'activité : « à toi : <texte> » (spec, question, coupure), « en pause » avec **Reprendre**, « arrêtée : <dernière phrase> » avec **Reprendre** ;
  - frise : `unknownStep` non nul → une ligne « Étape non reconnue : <texte> » à la place de l'étape en cours.
- **Test** : aucun (preuves « aucune » et tests déjà faits côté service).
- **Preuve** : `engine compile`, puis `engine test`.

## Tâche 8 : messages en file dans la conversation (interface)

- **Fichiers touchés** : `src/Conversation.tsx`, `src/App.css`.
- **Exigences couvertes** : SGS-43.
- **Interfaces produites** : la zone d'écriture reste active pendant un tour ou une fusion ; un message envoyé et mis en file s'affiche aussitôt à la suite, marqué « en attente », avec « Retirer » (`DELETE …/queue/:qid`) ; il disparaît de la file quand il part (vue rechargée sur `conversation`).
- **Test** : aucun (preuve « aucune »).
- **Preuve** : `engine compile`, puis `engine test`.
