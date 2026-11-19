# Parcours utilisateur (proposé le 2026-11-18, à valider avant la maquette)

Tiré du modèle validé (`docs/modele.md`). Remplace les sections « Versions, bugs et correctifs » et « Hiérarchie de l'interface » de `docs/ux-parcours.md` ; son lexique reste valable.

## Structure de la fenêtre

- **Menus** : Fichier (projets), Projet (commandes du projet), Affichage, Aide.
- **Barre de lieux** (gauche) : le projet en haut (nom, ▶ lancer le jeu, clic : changer de projet), puis cinq lieux fixes :
  - **À traiter** : tout ce qui attend une décision de l'utilisateur, et rien d'autre ;
  - **Backlog** : les stories non livrées ; regroupement par version, epic ou état ;
  - **Versions** : la feuille de route, des livrées aux prévues ;
  - **Architecture** : carte, règles, décisions ;
  - **Vision**.
- **Zone principale** : le lieu ou l'objet ouvert, avec un fil d'Ariane.
- **Barre d'état** : agents au travail (clic : la story), contexte, service.
- **Une page par objet** (story, epic), la même quel que soit le chemin (À traiter, Backlog, Versions, barre d'état, Ctrl+K) : la décision en attente en haut, au-dessus des onglets, visible quel que soit l'onglet ; dessous, les onglets (Avancement, Fichiers, Journal, Technique ; pour un epic : Cadrage, Stories, Journal) ; à droite, la conversation avec l'agent. Une carte d'À traiter ouvre cette page, jamais un écran à part.
- **Cadrage : document et conversation.** Le cadrage est un document vivant ; la conversation à côté le fait évoluer, et chaque mise à jour du document y est signalée. Les choix sont des raccourcis (« Autre… » renvoie à la conversation). Nouvelle feature propose trois départs : l'agent cadre seul, discuter d'abord (« Cadrer maintenant » quand l'idée est mûre), je cadre moi-même.
- Règle : une action vit au niveau de ce qu'elle concerne, une seule fois à l'écran. On crée dans le lieu qui liste ; on modifie ou ferme sur l'objet (menu « ⋯ », clic droit). Les raccourcis valent partout.

## Ce qui arrive dans À traiter

| Carte | Gestes |
|---|---|
| Cadrage à valider (feature ou bug) | ouvrir les stories en brouillon et les corriger · Valider · Demander un autre cadrage · Fermer |
| Décision d'architecture (conception d'une story) | Valider · Préférer l'alternative · Demander une autre conception |
| Recette | Valider · Demander des changements · Abandonner |
| Décision d'architecture : écart entre l'impact annoncé et la carte relevée | Accepter (devient une décision enregistrée) · Demander la correction (la story repart en développement) |
| Question d'un agent bloqué | Répondre |
| Bug non reproduit | Préciser comment le reproduire · Fermer |
| Version prête à livrer | Livrer (ouvre la livraison) |

Vide : « Rien ne t'attend », avec ce qui tourne et la prochaine recette probable.

## P1. Créer un projet

1. Fichier > Nouveau projet : nom, dossier, moteur (« Avancé » fermé : préfixe d'exigences, dépôt distant, agent).
2. **Vision** : cinq questions (ce que c'est, pour qui, plateforme et contrôles, style, ce qu'il ne sera jamais). « Plus tard » possible : les cadrages le rappelleront.
3. **Architecture** : l'outil montre les règles par défaut du moteur (lecture ; une exception se décidera au cadrage qui en a besoin).
4. Le projet s'ouvre sur À traiter, vide : « Écris ta première feature » mène au Backlog. Version `0.1.0` en développement.

## P2. Demander une feature (pipeline : `docs/modele.md` §6)

1. Backlog > **+ Nouvelle feature** (ou Ctrl+Maj+N) : une phrase. Option : « Je cadre moi-même ».
2. **Cadrage** par l'agent, seul : les stories apparaissent dans le Backlog en **brouillon**.
3. À traiter : **Cadrage à valider**. Un résumé : ce qu'il a compris, la conformité à la vision (« hors vision : … » est une décision), les choix ouverts (recommandation présélectionnée), la liste des stories.
4. Une story se corrige en l'ouvrant, sur sa propre page, comme toute story pas commencée (titre, résultat attendu, critères, hors périmètre, version, epic). « + Story » en ajoute une. Puis **Valider le cadrage** : les brouillons deviennent « prêtes ».
5. **Planification** : l'outil place les stories à la fin de la version en développement (ou de celle que le cadrage propose) ; l'utilisateur les déplace dans le Backlog ou Versions s'il veut. Aucun arrêt.
6. **Conception**, quand une story démarre : l'agent fait le plan technique et dit l'impact sur l'architecture. S'il y en a un (composant, dépendance, contrat, exception), À traiter : **Décision d'architecture** (valider, préférer l'alternative, demander une autre conception). Sinon, aucun arrêt.
7. Développement et vérification sans l'utilisateur ; il suit, s'il veut, par la barre d'état.

## P3. Recetter

1. À traiter : **Recette**. La story ouverte montre le résultat attendu, chaque critère avec sa preuve (source de chaque vérification), la Definition of Done vérifiée par l'outil, les captures, ▶ Lancer cette version.
2. **Valider** : la story est livrée dans la branche de sa version (fusion par l'outil).
3. **Demander des changements** : ce qui ne remplit pas les critères ; l'agent corrige dans la même story.
4. **Abandonner** : fermée, avec son motif.

## P4. Changer d'avis sur une story en cours

Sur la story, « ⋯ » :
- **Ajouter une suite** : une nouvelle story liée, qui passe par son cadrage ; la story en cours continue.
- **Abandonner et recadrer** : la story est fermée avec sa raison ; son texte, corrigé, repart en nouvelle feature.

Une story pas commencée se modifie librement (titre, demande, version, epic, ordre) ; elle se **ferme** avec un motif (ne sera pas fait, doublon, erreur), jamais ne se supprime.

## P5. Signaler un bug

1. Versions > **Signaler un bug** (version préremplie), ou sur une version livrée, ou Ctrl+Maj+B : ce qui se passe, ce qui devrait se passer, comment le reproduire (facultatif), capture.
2. L'agent le **reproduit** : un test qui échoue, lancé par l'outil. S'il n'y arrive pas : À traiter, « Bug non reproduit ».
3. À traiter : **Cadrage du bug** : cause probable, résultat attendu, impact sur l'architecture, et la version : corriger dans `1.0.1` puis reporter (recommandé si la version livrée est utilisée), ou seulement dans la version en développement.
4. Développement, vérification (le test de reproduction passe), recette dans la `1.0.1`, livraison, puis **report** par l'outil dans la version en développement, preuve refaite. Un conflit de report est réglé par l'agent dans la même story ; un échec revient dans À traiter.

## P6. Livrer une version

1. Versions > la version > **Livrer** (ou la carte « Version prête à livrer »).
2. L'outil refait la preuve sur toute la version (compilation, toutes les suites, smoke test, règles d'architecture) et vérifie que les correctifs sont reportés.
3. Notes de version tirées des stories livrées, modifiables ; numéro modifiable (`1.1.0` → `2.0.0`) jusqu'ici.
4. **Livrer** : tag, la version est figée. Les stories non livrées passent à la version suivante, créée d'elle-même.

## P7. Planifier

- Versions > **Planifier une version** : numéro, objectif. Les stories pas commencées s'y déplacent (glisser, ou « ⋯ > Version »).
- Backlog : l'ordre se change en glissant ; les agents prennent les stories dans cet ordre, jusqu'à `parallel_agents` à la fois.

## P8. Suivre l'architecture

Lieu **Architecture** :
- **Carte** relevée par l'outil à chaque fusion : composants par couche, dépendances, mise à jour (date, version).
- **Règles** : chacune verte ou rouge ; une rouge bloque la fusion et dit quoi corriger.
- **Décisions** : la liste des ADR (date, story d'origine, raison) ; chacune ouvre son fichier.
- Dérive (composant trop gros, dépendances qui montent) : l'outil propose une story de refactoring, qui arrive dans le Backlog comme les autres.

## P9. Modifier la vision

Lieu **Vision** : le texte, modifiable par l'utilisateur seul. Les cadrages suivants s'y confrontent ; les stories pas commencées qui en sortent sont signalées dans le Backlog (« hors vision »), à garder ou fermer.

## P10. Suivre et retrouver

- **Barre d'état** : qui travaille sur quoi ; clic : la story.
- **Story** : onglets Avancement, Conversation, Fichiers, Journal, Technique.
- **Retrouver** : Backlog avec « Afficher les livrées » et « Afficher les fermées » ; Versions pour ce qui est sorti ; Ctrl+K pour aller à n'importe quel objet.

## P11. Agir sur une story et suivre son avancement (validé le 2026-11-18)

Constats de l'essai du 18/11 (`docs/essais/2026-11-18-spawn-sur-spawn.md`) : un clic sur Valider ne montrait rien, le second a reçu « fusion déjà en cours » ; l'avancement s'est contredit après la fusion refusée et la tâche ajoutée après la recette ; « en cours d'écriture » restait affiché sans agent au travail. Principe : l'écran dit toujours ce qui se passe vraiment, et ce qu'on attend de l'utilisateur, s'il attend quelque chose.

### Une action, un retour

Vaut pour chaque bouton qui envoie quelque chose : valider la spec, répondre, valider la recette, demander des changements, abandonner, pause, reprendre, envoyer un message, nouvelle feature, renommer.

1. Au clic, le bouton passe en attente (« Validation… », « Envoi… ») et les autres gestes de la même carte se grisent : un second clic est impossible.
2. Le service répond :
   - **accepté** : la carte change tout de suite d'état (étape 3 pour une action longue) ;
   - **refusé** : la raison s'affiche sur la carte, en mots simples, à côté du bouton cliqué ; les boutons redeviennent actifs. Un refus parce que la même chose est déjà en cours n'est pas une erreur : la carte montre ce qui est en cours.
3. **Action longue** (fusion, tour d'agent) : la carte des gestes disparaît et laisse un bandeau d'état, avec la durée écoulée : « Fusion en cours : intégration à develop, suite complète des tests — 2 min ». Plus aucun bouton Valider tant qu'elle tourne.
4. **Fin d'une action longue**, dans le même bandeau :
   - réussie : « Livrée dans develop (abc1234) » ;
   - refusée : « Fusion refusée : <cause>. L'agent corrige, puis réinscrit ; rien à faire pour toi. » ;
   - bloquée : la story revient dans ce qui attend l'utilisateur, avec la question de l'agent.

### L'avancement

Les étapes restent : Cadrage, Planification, Développement, Vérification, Recette, Livraison.

1. **Une seule étape en cours à la fois**, celle que donne l'outil (la même que `spawn next`) ; celles d'avant sont faites, celles d'après à venir. Jamais deux étapes en cours, jamais une étape faite après une étape pas faite.
2. **Retour en arrière** (changements demandés à la recette, fusion refusée, tâche de correction ajoutée) : l'étape où la story revient redevient « en cours », celles d'après redeviennent « à venir », et l'étape dit pourquoi : « reprise après recette : <ta demande> », « fusion refusée : <cause> ». Les tâches ajoutées apparaissent dans la liste du Développement, à la suite.
3. **État non reconnu** (l'outil rend une étape que l'app ne connaît pas) : la frise affiche « Étape non reconnue : <texte de l'outil> » à la place de l'étape en cours, plutôt qu'un état faux.

### Qui travaille

1. Un libellé d'activité (« en cours d'écriture », « l'agent travaille… », le point vivant) ne s'affiche **que pendant un tour d'agent**.
2. Sans tour en cours, la story dit pourquoi elle ne bouge pas :
   - « à toi : <ce qui est attendu> » quand elle attend l'utilisateur ;
   - « en pause » avec **Reprendre** ;
   - « arrêtée : <dernière phrase de l'agent> » quand un tour s'est fini sans atteindre un point d'arrêt prévu, avec **Reprendre**.

### Écrire pendant une action longue

1. La conversation reste ouverte pendant un tour d'agent ou une fusion, comme dans Claude Code : un message envoyé est **mis en file**, affiché aussitôt dans la conversation comme « en attente », sans interrompre l'agent.
   - Pendant un tour : il est remis à l'agent **dans le même tour**, dès que ses actions en cours sont finies (comportement documenté de Claude Code et de l'Agent SDK) ; si le tour finit avant, il en ouvre un nouveau.
   - Pendant une fusion : il part à la fin de la fusion.
   - Plusieurs messages en file partent ensemble, dans l'ordre.
   - Faisabilité à établir à la conception : l'app lance aujourd'hui `claude -p` un tour à la fois, et la documentation ne dit pas comment `--input-format stream-json` remet un message en cours de tour. Si la remise dans le tour demande une dépendance nouvelle (Agent SDK) ou un changement du contrat des agents, la story s'arrête et le propose ; en attendant, la remise à la fin du tour est acceptable.
2. Un message en file peut être retiré tant qu'il n'est pas parti.
3. Une fusion refusée rappelle l'agent avec la cause : les messages en file partent avec ce rappel.
4. « Arrêtée » reste sur la page de la story, sans arriver dans ce qui attend l'utilisateur : Reprendre suffit.
