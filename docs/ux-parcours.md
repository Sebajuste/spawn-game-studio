# Parcours de l'app, vus par l'utilisateur

> Parcours à jour (2026-11-18) : `docs/parcours.md`, tiré du modèle `docs/modele.md`. Ce document garde le lexique et les décisions de l'app v1 ; ses sections « Versions, bugs et correctifs » et « Hiérarchie de l'interface » sont remplacées.

Maquette cliquable à jour : `docs/maquettes/app.html`, tirée de `docs/parcours.md` (la maquette de l'app v1 et les maquettes intermédiaires sont retirées ; elles restent dans l'historique git).

Règle de chaque écran : il répond à « que fais-je maintenant ? » et ne montre pas le jargon du kit (fil, worktree, ledger, session) en premier plan. Le détail technique reste accessible, replié.

Vocabulaire montré : **jeu** (un projet), **feature** (une demande, = un fil du kit), **à juger**, **historique**.

## 1. Installer (une fois par machine)

| Je fais | Je vois |
|---|---|
| J'ouvre l'app la première fois | « Préparer la machine » : git, Claude Code, OpenCode et son modèle, moteurs trouvés (Godot 4.x), chacun présent ou manquant |
| Je clique « Installer » sur un manquant | Le plan (ce qui sera écrit, où), puis « Appliquer » ; le résultat ligne par ligne |
| Tout est vert | L'accueil. Cet écran ne revient que si un prérequis casse (bandeau dans le jeu, « Réparer ») |

## 2. Créer, ouvrir, retrouver un jeu

| Je fais | Je vois |
|---|---|
| Fichier > Nouveau jeu (Ctrl+N) | Nom, dossier (sélecteur Windows), moteur (versions trouvées). « Avancé » fermé : préfixe d'exigences, dépôt distant, agent |
| « Créer » | Les étapes cochées une à une (modèle, git, premier import, premier test vert), puis le jeu s'ouvre sur « Que veux-tu ? » |
| Fichier > Ouvrir un jeu (Ctrl+O) | Sélecteur de dossier. Un dossier sans `spawn.json` : « Ce n'est pas un jeu Spawn » (Adopter, plus tard) |
| Fichier > Jeux récents | Les jeux connus de la machine (le registre), avec leur état en une ligne ; « Retirer de la liste » |
| Je rouvre l'app | Le dernier jeu ouvert. Sans jeu : l'accueil (Nouveau, Ouvrir, Récents) |

Une fenêtre = un jeu. Deux jeux = deux fenêtres (Fichier > Nouvelle fenêtre).

## 3. Demander une feature

| Je fais | Je vois |
|---|---|
| Je tape dans « Que veux-tu ? » (toujours en haut du jeu, Ctrl+Maj+N) et Entrée ; je peux coller une image | La feature apparaît dans « En cours », avec un titre tiré de ma phrase (modifiable, F2) |
| Rien d'autre | L'agent est celui des réglages du projet ; « Avancé » sous le champ permet d'en choisir un autre pour cette fois, ou « Lancer cette nuit » (modèle local) |

## 4. Suivre

Barre latérale du jeu, par ce qui me concerne, pas par état technique :

1. **Attend ta réponse** (pastille orange, notification Windows)
2. **À juger** (pastille bleue, notification)
3. **En cours** (une ligne : étape et avancement, « tâche 3/5 »)
4. **Cette nuit** (features programmées)
5. **Historique** (replié)

Vue d'une feature, onglet **Avancement** par défaut :

- Étapes : Comprendre → Découper (n tâches) → Tâches (chacune : titre, état, tests) → Preuve → Fusion → À juger. Source : ledger et `spawn suivant`.
- « Maintenant » : une ligne (« implementer sur la tâche 3, depuis 2 min »).
- Coût et durée en tête : tokens, temps écoulé.
- Les autres onglets : **Conversation** (parler à l'agent, son flux complet), **Fichiers**, **Médias**, **Journal** (ledger, refus du périmètre, compactages), **Technique** (branche, worktree, session, jauge de contexte).
- Barre d'état en bas : agent et modèle, contexte en %, branche.

## 5. Répondre à une question de l'agent

Une vraie décision (statut `bloque:`) : la feature passe dans « Attend ta réponse », la question est en tête de sa vue, avec ses choix en boutons s'il en propose, et un champ libre. Ma réponse relance le travail. Rien d'autre ne me demande quoi que ce soit (§0).

## 6. Juger

Quand la preuve est verte, la feature passe « À juger ». L'écran :

- **Ce qui a été fait**, en trois lignes (compte rendu final de l'agent) ; **comment vérifier** (ce que je dois essayer).
- Les captures et vidéos, en grand.
- Tests : n verts. Fichiers touchés : replié.
- **▶ Lancer cette version** (le jeu de la branche, pas `develop`).
- **✓ Accepter** : fusion, puis ménage, sans moi. La feature passe dans l'historique.
- **↺ Redemander** : je dis ce qui ne va pas ; la feature repart avec ce message.
- **✕ Abandonner** : branche supprimée, l'historique garde la trace.

Un refus de fusion (conflit, rouge) ne me remonte pas : l'agent est rappelé. Seulement après deux échecs, la feature passe en « Attend ta réponse ».

## 7. Retrouver

- **Historique** : features finies et abandonnées, date, ma phrase d'origine, résultat. Une feature finie se relit telle quelle : conversation, fichiers (d'après le commit de fusion), médias, commit.
- **Aller à** (Ctrl+K) : cherche dans les titres, les phrases et les fichiers touchés, sur le jeu ouvert.

## 8. Coupure (PC, app)

Au redémarrage, les features coupées reprennent seules (même session), et leur Avancement le note (« reprise après coupure à 14:02 »). Si la reprise échoue : « Attend ta réponse », avec « Reprendre » et la cause.

## 9. État du jeu

Dans l'en-tête du jeu, une ligne : « jouable · 14 tests verts » et **▶ Lancer** (`develop`). Si quelque chose demande attention, un bandeau ; sinon rien.

Jeu > État du jeu : `develop` (vert ou cassé, depuis quelle fusion), file de fusion, quarantaines (n/5, échéances), branches et worktrees orphelins avec « Faire le ménage » (liste montrée avant).

## 10. Réglages et affichage

- **Jeu > Réglages du projet** : agent par défaut (Claude Code et son modèle, ou OpenCode et le modèle local), limites (contexte, taille des tâches), version du moteur.
- **Affichage** : cases à cocher des modules (Activité, Jauge, Fichiers, Médias, Journal…), au lieu du panneau ⚙.
- **Fichier > Préférences** : prérequis, moteurs, notifications, heures de nuit.

## Menus

| Menu | Contenu |
|---|---|
| Fichier | Nouveau jeu (Ctrl+N) · Ouvrir un jeu (Ctrl+O) · Jeux récents › · Nouvelle fenêtre · Préférences · Fermer le jeu · Quitter |
| Jeu | Nouvelle feature (Ctrl+Maj+N) · Lancer le jeu (F5) · État du jeu · Ouvrir le dossier · Ouvrir dans Godot · Réglages du projet |
| Affichage | Aller à (Ctrl+K) · modules à cocher |
| Aide | Documentation · À propos |

## Décisions (mainteneur, 2026-11-17)

1. **On juge avant la fusion** : `develop` ne reçoit que ce qui a été vu.
2. **Reprise automatique** après coupure ; « Reprendre » seulement si elle échoue.
3. **Cette nuit** : utile, plus tard.
4. **Titre** tiré de la phrase par simple découpe, renommable (F2).

## Pas encore fait

- « Cette nuit » (§3), l'état du jeu (§9, phase 6), « Préparer la machine » (§1 : `spawn prerequis` en ligne de commande), la recherche dans les fichiers touchés (§7), les notifications Windows.

## Lexique (validé par le mainteneur le 2026-11-18)

Règle (2026-11-18) : un terme technique du métier reste en anglais quand la traduction perd la notion (feature, epic, story, backlog, Definition of Done, smoke test) ; le français pour les mots courants et les gestes (valider, demander des changements, recette, cadrage). Le vocabulaire interne du kit (fil, ledger, worktree) reste derrière la vue « Technique ».

| Objet | Nom | Anglais | Ce que c'est |
|---|---|---|---|
| Ta phrase | **Feature** | Feature request | la fonctionnalité que tu veux ; cadrée, elle devient une story, ou un epic si elle est grosse |
| Grosse demande découpée | **Epic** | Epic | un ensemble de stories qui livrent un tout |
| Unité livrée | **Story** | User story | ce qui est développé, recetté, livré (= un fil du kit) |
| Étape technique | **Tâche** | Task | faite par un agent, dans une story |
| À faire | **Backlog** | Backlog | les stories restantes, dans l'ordre : on voit ce qui reste, pas seulement ce qui est fait |
| Preuve | **Definition of Done** | Definition of Done | compilation et scènes, suite complète, smoke test, test de bout en bout, relecture : vérifiée par l'outil |

Contenu d'une story : **Résultat attendu** (ce que le joueur pourra faire, 3 à 5 lignes ; remplace « Ce que tu verras »), **Exigences** (vérifiables une à une, chacune avec sa preuve ; le nom reste : les identifiants `TAG-NN` s'appellent exigences dans tout le kit), **Hors périmètre**.

Étapes d'une story : **Cadrage** → **Validation du cadrage** (la seule question) → **Planification** → **Développement** → **Vérification** → **Recette** → **Livraison**.

États et gestes : **Bloquée : ta décision** · **En recette** · **Valider** · **Demander des changements** · **Abandonner** · **Livrées** / **Abandonnées**.

Projets de grande taille (ajouté le 2026-11-18) : un niveau au-dessus des epics, le **Jalon** (Milestone : un objectif démontrable, « Démo jouable »), facultatif tant que le projet est petit. Hiérarchie : Jalon > Epic > Story > Tâche. Tableau de bord en **Maintenant / Ensuite / Plus tard** (jalon en cours détaillé, jalon suivant résumé, demandes non cadrées) ; ce qui est livré est replié ; **thèmes** (étiquettes par zone du jeu) pour filtrer, sans niveau de plus. Remplacé le 2026-11-18 : le jalon devient une version avec un objectif (`docs/modele.md`).

## Versions, bugs et correctifs (proposé le 2026-11-18, à valider sur la maquette)

Besoin : livrer des versions, corriger un bug sur une version déjà livrée (1.0.1) pendant que la suivante (1.1.0) est en développement, et savoir ce qui est prévu dans chaque version.

- **Deux types de story** : **Feature** (ce qu'on ajoute) et **Bug** (ce qui ne marche pas comme prévu). Même parcours, avec deux différences pour un bug : le cadrage commence par le **reproduire** (un test qui échoue, lancé par l'outil : c'est la preuve que le bug existe), et la vérification exige que ce test passe.
- **Chaque story vise une version.** Numéros `majeure.mineure.correctif` :
  - **1.1.0** : la prochaine version, en développement. Les features y vont, ainsi que les bugs du code pas encore livré.
  - **1.0.1** : version de correctifs d'une version livrée. N'y vont que des bugs.
  - La majeure (2.0.0) : ton choix, quand tu livres.
- **Un jalon se livre en une version** (« Démo jouable » = 0.3.0). Les versions de correctifs sont hors jalon.
- **Signaler un bug** (Projet > Signaler un bug…, ou depuis une version) : dans quelle version, ce qui se passe, ce qui devrait se passer. Le cadrage reproduit le bug et propose la version cible :
  - **corriger dans 1.0.1, et reporter dans 1.1.0** (recommandé quand le bug gêne les joueurs) ;
  - ou **seulement dans 1.1.0**.
- **Report automatique** : un correctif livré dans 1.0.1 est toujours reporté dans 1.1.0 par l'outil, avec la preuve refaite sur 1.1.0. Un correctif n'est terminé qu'une fois reporté. En cas de conflit, l'agent le résout dans la même story (étape « Report dans 1.1.0 »).
- **Livrer une version** est ton geste, jamais automatique :
  - l'outil refait la preuve sur toute la version (compilation, tous les tests, smoke test) ;
  - il écrit les **notes de version** à partir des stories livrées, et tu peux les modifier ;
  - il pose la version.
  - Une version livrée se relance à tout moment (Versions > ▶).
- **Écran Versions** : la version de correctifs en préparation, la version en développement, les versions prévues (contenu fixé par les cadrages), puis les versions livrées repliées.
- **Le backlog se lit par version**, puis par epic.
- **Menus** : « Jeu » devient **Projet**, et Fichier > Nouveau projet, Ouvrir un projet, Projets récents, Fermer le projet. « Lancer le jeu » garde son nom (c'est le jeu qu'on lance).
- Technique (caché, vue Technique seulement) :
  - `develop` porte la prochaine version ;
  - une branche de maintenance par version livrée corrigée (`release/1.0`, tirée de `v1.0.0`) ;
  - chaque version livrée est taguée, et `main` suit la dernière version livrée ;
  - le report se fait de la branche de maintenance vers `develop`.

## Hiérarchie de l'interface (2026-11-18, reprise dans `docs/parcours.md`)

Constat : le champ « Nouvelle feature » et « Lancer le jeu » apparaissaient sur chaque écran, et la barre de gauche mélangeait lieux, choses à traiter et activité. Règle : **chaque action vit au niveau de ce qu'elle concerne**, et une seule fois à l'écran.

| Niveau | Où | Actions |
|---|---|---|
| Application | menu Fichier | nouveau, ouvrir, fermer un projet |
| Projet | bloc du projet en haut de la barre, menu Projet | changer de projet, ▶ lancer le jeu, réglages, vision, livrer une version |
| Lieu | en-tête du lieu | Backlog : + Nouvelle feature · Versions : Signaler un bug, Livrer · À traiter : aucune création, on y répond |
| Élément (story) | en-tête et contenu de la story | ▶ lancer cette version, valider, demander des changements, abandonner |
| Activité | barre d'état | agents au travail, contexte ; un clic ouvre la story |

Les raccourcis (Ctrl+Maj+N, Ctrl+Maj+B, F5) restent valables partout : ce sont des commandes, pas des éléments affichés.
