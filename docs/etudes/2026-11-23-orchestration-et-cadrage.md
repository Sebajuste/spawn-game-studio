# Étude du 23/11 : orchestrer comme en console, cadrer par EPIC, ordonnancer la machine

Question du mainteneur : la nuit du 22 au 23/11, l'EPIC « Intégration POI » menée à la main en console a livré l'essentiel en une nuit, quand Spawn n'a rien livré. Que changer dans Spawn pour un meilleur cadrage dès le départ, moins d'agents en même temps et moins de tokens ?

Étude en lecture seule : transcripts Claude Code, ledgers et branches des trois projets Godot (`gdsbj-planet-terrain`, `map-editor`, `rpg-demo`), code du service et du kit. Rien n'est décidé ici : chaque point se tranche par le mainteneur.

**Verdict : à quantité de tokens comparable, la console livre et Spawn ne livre pas.** Deux tiers du budget de Spawn partent dans l'orchestration, ses plans sont trop fins, ses EPIC ne sont pas cadrées, et rien ne règle la charge de la machine.

## Mesure

| | Spawn, 3 fils Godot (22/11, 18 h → 00 h) | Console, nuit (23:29 → 06:59) |
|---|---|---|
| Sessions + agents | 73 sessions, 65 agents | 1 session, 9 agents |
| Tokens en sortie | 1,7 M | 0,9 M |
| Entrée neuve | 9,2 M | 7,8 M |
| Cache relu | 161 M | 335 M |
| Coût relatif estimé (sortie × 5, cache × 0,1) | ~34 | ~46 |
| Résultat | 42 tâches closes sur 49, aucune fusion, fils bloqués | 3 dépôts fusionnés, validé sur capture |

Part de l'entrée neuve par rôle :

| Rôle | Spawn | Console |
|---|---|---|
| Orchestrateur | **67 %** | 9 % |
| Agents qui font le travail | 23 % | 91 % |
| Relecteurs | 9 % | 0 |

Plans des fils :

| Fil | Exigences | Tâches | Lignes de plan | Faites | Rondes | Relectures finales | Fin |
|---|---|---|---|---|---|---|---|
| `affiche-une-poi-cuite-v2` | 17 | 19 | 237 | 19 | 6 | 1 | bloqué (décision) |
| `permets-de-cuire-une-carte` | 19 | 21 | 340 | 14 | 2 | 1 | non fini |
| `cree-le-catalogue-map-editor` | 10 | 9 | 136 | 9 | 2 | 0 | non fini |

La console a fait le même genre de travail en 8 gros morceaux délégués (bake eau et ponts, mer, palier CLOSE, normale, eau en unités physiques…), avec des validations du mainteneur sur capture. Elle a repris et fusionné les branches des fils Spawn.

Non vérifié : la part du quota. Le coût relatif suit le rapport des prix publics, ce n'est pas le décompte du quota.

## 1. Un orchestrateur qui garde son contexte, repartant à neuf après le plan

**Constat.** Une session neuve d'orchestrateur à chaque tour : 73 sessions pour 3 fils, 28 pour le seul fil POI v2. Chacune relit skill, ledger et plan, puis lance `spawn next`. La console garde une session et délègue.

**Proposition.** Deux sessions par EPIC :

1. **Cadrage** : inventaire, choix, stories, plan. Le mainteneur valide.
2. **Reset du contexte** : le plan validé et les décisions font la passation.
3. **Exécution** : une seule session, qui garde son contexte d'une tâche à l'autre et délègue aux implémenteurs. Le compactage de Claude Code prend le relais, avec le plan et le ledger comme ancres.

Les implémenteurs gardent leur forme actuelle (brief, TDD, commit).

**Ce que ça change.** L'enchaîneur et la conversation du service (`service/src/modules/conversation.ts`), la skill `story`. Rejoint le point 3 de l'étude du 18/11 (un processus Claude qui reste ouvert par story).

## 2. Cadrer l'EPIC, et ce qu'elle livre à chaque jalon

**Constat.** Une EPIC n'est qu'une étiquette (« des stories qui livrent un tout », facultative, `docs/modele.md` §2). Le cadrage se fait story par story, en exigences fines, sans dire ce que l'EPIC livre ni quand. L'EPIC POI touchait 3 dépôts, découpés en fils qui ne se voyaient pas. Le plan v2 a construit l'habillage à côté du scatter, contre la tranche F du plan d'architecture (`deep-front/docs/superpowers/plans/2026-11-20-terrain-poi-cuite.md` : « placeur branché ») ; l'écart tenait en une ligne du hors-périmètre de la spec validée.

**Proposition.** Un cadrage d'EPIC, validé une fois :

- objectif, et dépôts touchés ;
- inventaire de l'existant, en lecture seule, un agent par dépôt ;
- décisions d'architecture, et en tête tout écart à un plan déjà décidé, à valider explicitement ;
- sorties par jalon : ce que le mainteneur verra et jugera (scène, capture), avec un budget de performance mesuré quand il compte (« ≥ 60 FPS en vol ») ;
- des stories plus grosses, qui découlent des jalons : une par composant, 5 à 8 par EPIC ;
- une relecture finale par EPIC ; un relecteur de tâche seulement là où le plan désigne un risque.

**Ce que ça change.** Le modèle (`docs/modele.md`), le cadrage de l'app, `spawn next`. Le budget de performance demande une mesure dans l'adaptateur Godot : changement du contrat des adaptateurs.

## 3. Régler la charge de la machine, et l'ordre des stories

**Constat, vérifié dans le code.**

- Une seule limite : `parallel_agents` dans `spawn.json` (3 par défaut, 10 au plus, `kit/core/src/project.ts:18`), comptée par projet. Trois projets : jusqu'à 9 agents sur la machine, et leurs suites lourdes ensemble (délais dépassés, `ECONNRESET`).
- Aucune limite du nombre de stories ou d'EPIC actives.
- Aucun ordonnancement : le modèle prévoit un « rang » dans le Backlog (§6, étape 3), aucun code ne l'implémente.

**Proposition.**

- Une configuration pour toute la machine (`~/.spawn/`) : nombre total d'agents, nombre d'EPIC ou de stories actives.
- Une file ordonnée par la priorité du mainteneur (rang modifiable dans le Backlog), qui respecte les dépendances entre stories et démarre la suivante quand une place se libère.
- Une seule suite lourde à la fois sur la machine.

**Ce que ça change.** Un nouveau composant du service (la file), les réglages de l'app, le Backlog.

## 4. Pas de reprise automatique au démarrage de l'app

**Constat, vérifié dans le code.** Au démarrage, le service reprend tout fil dont le dernier tour a été coupé, tous d'un coup et sans limite (`service/src/modules/conversation.ts:275`, `autoResume` vrai par défaut ; ligne 574). Arrêter l'app pour reprendre la main ne suffit pas : tout repart au lancement suivant.

**Proposition.** Plus de reprise automatique : un fil coupé reste « coupé », visible, et repart par le geste du mainteneur (« Reprendre »), ou par la file du point 3, dans ses limites.

**Ce que ça change.** Le service (`conversation.ts`) et ses tests ; le parcours de reprise (`docs/parcours.md`).

## À garder

Worktrees, périmètre, preuve par l'outil (compilation, tests, captures), fusion vérifiée.

## Décisions attendues

1. Orchestrateur en deux sessions par EPIC (cadrage, puis exécution qui garde son contexte).
2. Cadrage par EPIC avec jalons, écarts d'architecture en tête, stories plus grosses, relecteurs ciblés ; budget de performance (contrat des adaptateurs).
3. Limites pour toute la machine et file ordonnée par priorité.
4. Fin de la reprise automatique au démarrage.
5. Le commit `74e6bf2` (section « Existant » obligatoire dans la spec), qui ne traite pas l'écart d'architecture : à annuler, ou à fondre dans le point 2.
