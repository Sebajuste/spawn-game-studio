# Conversation de portée : plan d'implémentation

> Spec : `docs/conversation.md` (validée le 2026-11-20). Navigation : `docs/navigation.md` §4, §9, §10.

**But :** l'Accueil de chaque portée (projet, workspace) est une conversation continue avec un agent, qui crée stories et epics par le service ; À juger à côté.

**Architecture :** un module de service `talk` (un dossier, un fichier par responsabilité) fait tourner l'agent dans un worktree détaché remis à `develop` avant chaque tour, lit les blocs ```` ```spawn ```` de sa réponse et exécute les actions (création de story extraite du module backlog, epics du kit). L'app remplace le lieu À traiter par Accueil : la conversation (composants de `src/story/conversation/` réutilisés) et la colonne À juger.

**Contraintes :** cœur du kit intouché (voir CLAUDE.md) ; noms techniques en anglais, textes et commentaires en français ; TypeScript exécuté par Node (ni `enum` ni `namespace`) ; un fichier = une responsabilité, regroupés par thème ; aucune attribution IA dans les commits.

## Fichiers

| Fichier | Responsabilité |
|---|---|
| `service/src/modules/talk/actions.ts` | lire et valider les blocs ```` ```spawn ```` d'une réponse (pur) |
| `service/src/modules/talk/prompt.ts` | consigne du premier tour d'une session (rôle, protocole, projets, backlog) |
| `service/src/modules/talk/place.ts` | worktree détaché `_talk` : création, remise à `develop` |
| `service/src/modules/talk/store.ts` | `state.json`, `turn-N.jsonl`, tours coupés |
| `service/src/modules/talk/scope.ts` | portée → racine, dossier de stockage, agent, projets |
| `service/src/modules/talk/execute.ts` | exécuter les actions (story, epic) et rendre leurs résultats |
| `service/src/modules/talk/index.ts` | module : routes, tours en cours, événements `talk` / `talk-end` |
| `service/src/modules/backlog.ts` | `requestFeature` extrait (une seule création de feature) |
| `service/src/modules/conversation.ts` | `Tail` exporté |
| `service/src/contract.ts` | `TalkView`, `TalkTurn`, `TalkActionResult`, événements |
| `service/test/talk.test.ts` | parseur ; tour avec faux agent ; story et epic créés ; worktree remis à zéro |
| `src/navigation/route.ts` (+ tests) | lieu `home` au lieu de `inbox` (`inbox` encore lu) |
| `src/talk/Talk.tsx` | la conversation de portée (envoi, Stop, tours) |
| `src/talk/TalkTurn.tsx` | un tour : bulles sans les blocs, résultats des actions avec lien |
| `src/talk/useTalk.ts` | données : vue, flux d'événements, envoi, arrêt |
| `src/talk/strip.ts` (+ test) | retirer les blocs ```` ```spawn ```` d'un texte |
| `src/talk/talk.css` | mise en page Accueil |
| `src/home/Home.tsx` | Accueil : conversation + colonne À juger |
| `src/home/ToJudge.tsx` | la colonne À juger (compacte) ; `src/inbox/` supprimé |
| `src/shell/*` | Accueil par défaut, Ctrl+J, retrait de « + Nouvelle feature » |

## Tâches

1. **Parseur d'actions** : tests (bloc story, story sans projet en workspace refusée, epic avec `after` hors bornes refusé, JSON invalide, plusieurs blocs, doublons ignorés), puis `actions.ts`.
2. **Service** : `requestFeature` extrait du handler `POST /backlog` (tests backlog inchangés et verts) ; `place.ts`, `store.ts`, `scope.ts`, `prompt.ts`, `execute.ts`, `index.ts` ; routes `GET|POST /api/{projects,workspaces}/:id/talk`, `POST …/talk/stop` ; module inscrit dans `modules/index.ts`. Test : un tour au faux agent dont la réponse porte un bloc story crée la story (fiche, worktree, conversation de story lancée) et le tour porte `actions: [{ kind: "story", ok: true, … }]` ; un fichier écrit dans `_talk` disparaît au tour suivant.
3. **Route** : `home` remplace `inbox` dans `ProjectPlace` / `WorkspacePlace`, défaut `home`, `inbox` lu comme `home` ; tests de route, fil d'Ariane, Ctrl+K.
4. **App** : `src/talk/`, `src/home/Home.tsx`, À juger compact, retrait de `NewFeatureForm` du Backlog, Ctrl+J, i18n en et fr.
5. **Vérification** : `npm run typecheck`, `npm run lint`, `npm run test:app`, tests du service ; captures (Accueil projet vide, Accueil avec un tour et une action, Accueil workspace, Backlog sans bouton) comparées à `docs/maquettes/navigation.html`.

## Statut

Tâches 1 à 5 faites (commits « service: conversation de portée… » et « gui: Accueil… »). Vérifié : typecheck, lint, `test:app` (31), tests du service talk, talk-actions et backlog (13) ; captures de l'Accueil projet (tours, action story), de l'Accueil vide, de l'Accueil workspace (action epic, À juger multi-projets), du Backlog sans création, et curseur dans la saisie après Ctrl+J. **Non vérifié** : un vrai agent Claude qui suit le protocole ```` ```spawn ```` (seul un faux agent scripté l'a été).

## Hors de ce plan

Reprise automatique d'un tour coupé ; actions de vision et d'architecture ; choix de l'agent de la conversation dans l'interface (il suit les réglages du projet).
