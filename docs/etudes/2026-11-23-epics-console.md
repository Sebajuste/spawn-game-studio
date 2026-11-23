# Complément du 23/11 : trois EPIC menées en console

Question du mainteneur : trois EPIC tournent en console (POI, animations des personnages, RPG multijoueur). Elles s'en sortent bien avec 3 sous-agents au plus et se coordonnent seules quand elles fusionnent dans les mêmes dépôts. Qu'en retenir avant de changer la forme des sessions de Spawn (mesure 3 : session neuve après le plan) ?

Étude en lecture seule des transcripts Claude Code, sans rien envoyer aux sessions. Chaque message de l'API est compté une fois (`message.id`). Scripts : `epic.cjs`, `epic2.cjs`, `epic3.cjs` (scratchpad de la session du mainteneur, non conservés).

Ce document corrige aussi l'étude du jour (`2026-11-23-orchestration-et-cadrage.md`), voir la dernière section.

## Mesure

| | POI | Animations | RPG multijoueur |
|---|---|---|---|
| Session | `Godot4/497eedd3` | `Godot4/72879f46` | `rpg-demo/62c2eeb1` |
| Durée | 22/11 23:29 → 23/11 15:02 | 23/11 07:34 → 15:01 | 22/11 17:48 → 23/11 15:00 |
| Appels de l'orchestrateur | 586 | 183 | 514 |
| Contexte relu par appel, moyen (max) | 467 k (965 k) | 216 k (352 k) | 151 k (227 k) |
| Compactages | 1 | 0 | 9 |
| Pertes de cache | 2 (dont 1 après 2 h 31 de pause) | 0 | 9 (7 juste après un compactage, 2 après une pause de plus d'une heure) |
| Sous-agents | 21, 3 au plus en même temps | 10, 2 au plus | 27, 3 au plus |
| Brief médian | 4,2 k car. | 4,9 k car. | 5,1 k car. |
| Compte rendu médian | 6,4 k car. | 5,5 k car. | 7,5 k car. |
| Passe d'agent, médiane (max) | 45 min (1 h 48) | 36 min (53 min) | 28 min (2 h 07) |
| Orchestrateur, part de l'entrée neuve | 14 % | 10 % | 20 % |
| Orchestrateur, part du coût relatif (sortie × 5, cache × 0,1) | 29 % | 14 % | 19 % |
| Messages avec d'autres sessions (envoyés, reçus) | 8, 1 | 7, 4 | 6, 9 |
| Interventions du mainteneur | 23 | 30 | 44 |

Tous les sous-agents tournent sur le modèle de l'orchestrateur (opus), en fond.

## Ce qui marche

**De gros morceaux délégués.** Un brief de 4 à 5 k caractères pour une passe de 30 à 45 minutes, un compte rendu de 5 à 7 k caractères. L'orchestrateur ne voit ni le code ni les sorties de tests de l'agent. Il ne garde que la décision, le brief et le compte rendu.

**Les décisions sont écrites dans un fichier d'EPIC, pas dans le contexte.** `rpg-demo/context/epic-base-rpg.md` (21 k caractères) contient les critères d'acceptation, l'emplacement du code, puis une section par décision, datée : « décidé par l'utilisateur le 2026-11-23 ». Viennent ensuite les stories, les options, ce qui est hors de l'EPIC, les prérequis constatés et les risques non levés. Le fichier est complété au fil de la discussion. Une décision qui concerne une autre session lui est transmise en pointant la section.

**La coordination à la fusion suit toujours la même forme**, de session à session, par leur nom :

1. « Je fusionne X dans `develop` de tel dépôt dès que ma vérification est verte ; préviens-moi avant ta fusion. »
2. « C'est fusionné au commit Y. Ce qui change pour toi : … »
3. L'autre répond « bien reçu », intègre `develop`, refait sa vérification et prévient avant sa propre fusion.

Un pilote est désigné par dépôt partagé (« c'est moi qui pilote RPG-3 »). Les deux côtés vérifient que la fusion garde les commits de l'autre.

**Le mainteneur intervient sur le fond.** Ses interventions sont surtout des décisions de conception : modèle des acteurs, synchronisation réseau, nommage aligné sur les moteurs, choix d'un pack. Viennent ensuite des validations à l'écran et des questions d'état.

## Ce qui coince encore

- **Dérive du cadrage.** Dans l'EPIC RPG, le mainteneur corrige trois fois une invention : « un pilotable non humanoïde », « deux archères », et le rappel « on a surtout discuté du cahier des charges ». Ces corrections tombent dans la session aux 9 compactages. Le lien avec les compactages n'est pas vérifié.
- **La coordination n'a pas de support.** Le mainteneur doit demander qui s'occupe d'une branche (« qui s'occupe de feature/depot-verifiable ? »), puis le dit : « Il faut se coordonner avec les autres fils autrement. » Deux incidents :
  - un sous-agent a travaillé dans la copie principale d'un dépôt partagé ;
  - une session attendait un événement qui ne viendrait pas : le worktree d'un fil déjà fusionné n'avait pas été supprimé.
- **On ne voit pas l'avancement.** « ça tourne ? je ne vois rien », « Ça fait des heures que ça tourne », et une demande d'état à chaque reprise.
- **Le contexte de l'orchestrateur grossit sans limite.** La session POI relit en moyenne 467 k par appel, jusqu'à 965 k. Elle ne s'est compactée qu'une fois. Avec le cache relu, l'orchestrateur pèse 29 % du coût, et non les 14 % de l'entrée neuve.

## Ce que ça change pour Spawn

1. **Mesure 3 (session neuve après le plan) : confirmée, avec une condition.** La console montre que la passation tient dans un fichier de décisions, pas dans le contexte. La session POI montre aussi qu'un contexte jamais remis à zéro coûte cher. Condition : la session neuve repart d'un document où **toute** décision du mainteneur est écrite, datée, au moment où il la prend. Sinon on recrée la dérive de l'EPIC RPG.
2. **Mesure 4 (sorties plus courtes) : le bon ordre de grandeur existe.** Un brief de ~5 k et un compte rendu de ~6 k par morceau de 30 à 45 minutes. Une story Spawn découpée en 19 tâches de quelques minutes multiplie les tours de l'orchestrateur ; c'est le point 2 de l'étude (des tâches plus grosses).
3. **Point 2 (cadrage par EPIC) : le fichier d'EPIC de rpg-demo en est le modèle vivant.** Critères, emplacement du code, décisions datées, stories, hors périmètre, prérequis, risques.
4. **Nouveau : coordonner les fusions entre stories qui touchent un même dépôt.** La file de fusion de Spawn sérialise, mais ne dit pas aux autres stories ouvertes ce qui a changé pour elles. Ce que font les consoles :
   - annoncer la fusion ;
   - transmettre le commit et « ce qui change pour toi » ;
   - faire intégrer `develop` avant la fusion suivante ;
   - nommer un pilote par dépôt partagé.

   Spawn peut le faire sans messages entre sessions : à chaque fusion, une note pour chaque story ouverte sur ce dépôt. Elle est à proposer ; pas encore conçue.
5. **Ne pas reprendre** : le travail dans la copie principale d'un dépôt partagé (le périmètre de Spawn l'interdit déjà), et le suivi de l'avancement qui passe par des questions au chat (l'app le montre).

## Corrections de l'étude du jour

- **Point 1, constat faux.** « Une session neuve d'orchestrateur à chaque tour : 73 sessions pour 3 fils » : chaque fil Godot n'a qu'**une** session d'orchestrateur, reprise à chaque tour (`--resume`, 8 tours chacun). Les autres transcripts sont des agents. Le point 1 se réduit à la session neuve après le plan (mesure 3) et à la réutilisation du cache.
- **Tableau de mesure.** Les parts par rôle comptaient chaque bloc d'un message comme un appel. Une fois dédoublonné, le fil POI se répartit ainsi : orchestrateur 40 %, ses sous-agents 35 %, agents de l'enchaîneur 26 %. La nuit en console : orchestrateur 9 %.
- **Pertes de cache de Spawn.** Toutes s'expliquent. Une installation du runtime pendant un fil coûte deux tours de réécriture complète par story ouverte (constaté 2 fois sur 2, mécanisme non vérifié). S'y ajoutent les pauses de plus d'une heure. Décision : installer seulement entre deux séries de stories.
