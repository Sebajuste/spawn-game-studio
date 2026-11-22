# Workspaces et projets à jour dans l'app ouverte (bug, spec du 2026-11-22)

Demande : « La discussion globale a décidé de créer une épic : elle n'apparaît pas dans la liste des épics ! De plus, j'ai 4 demandes en attente, et toutes affichent "Choose a workspace or a project to start." quand je sélectionne la demande. »

## Résultat attendu

Sans recharger ni relancer l'app : une epic créée par la conversation d'un workspace est aussitôt dans Epics, et « Open » mène à sa page. Un projet ajouté pendant la session est aussitôt connu, même si la fenêtre d'ajout a été fermée sans « Ouvrir » : cliquer l'une de ses demandes ouvre la story, pas le sélecteur. Dans la page de l'epic, chaque story dit son état du moment, y compris quand elle est bloquée.

## Cause

- La conversation écrit l'epic sans émettre l'événement `workspaces` : la fenêtre garde son ancienne liste et prend l'adresse de l'epic pour une adresse disparue.
- Le registre des projets n'est lu qu'au démarrage de la fenêtre : un projet ajouté ensuite est dans le workspace mais inconnu de la navigation, qui renvoie au sélecteur.
- Les états des stories d'une epic ne sont pas relus quand une story change, et un état `blocked:*` s'affiche vide (`t` rend `undefined` pour une clé absente, le repli de `stateLabel` ne sert jamais).

## Exigences

- **SGS-51** Une epic créée par la conversation est annoncée par l'événement `workspaces` dès sa création, puis à chaque story qui y est rangée, donc aussi quand la création s'arrête en route. Preuve : test (service, faux agent) ; contrôle négatif : une epic refusée (projet hors du workspace) n'émet pas cet événement.
- **SGS-52** Inscrire, créer, adopter ou retirer un projet par le service émet l'événement `projects`. Preuve : test (service) ; contrôle négatif : une inscription refusée (dossier sans `spawn.json`) n'émet pas cet événement.
- **SGS-53** L'app ouverte relit ses projets à `projects` : la demande d'un projet ajouté pendant la session ouvre sa story, et « Open » d'une epic créée pendant la session ouvre sa page. Preuve : aucune ; tu le regardes à la recette. Un test demanderait un pilotage de navigateur que le projet n'a pas.
- **SGS-54** La page d'une epic relit l'état de ses stories quand l'une change. Preuve : aucune ; tu le regardes à la recette, pour la même raison.
- **SGS-55** Une story d'epic bloquée affiche « bloquée : ta décision », et un état sans libellé s'affiche tel quel, jamais vide. Preuve : test ; contrôle négatif : un état connu (`active`) garde son libellé « en cours ».

## Hors périmètre

- Les stories d'epic qui attendent une dépendance et finissent en « ta décision » (relances arrêtées) : autre bug, qui demande de décider comment une attente se montre et qui la relance, et peut toucher le cœur du kit (`next.ts`).
- Un registre ou un workspace modifié hors de l'app (ligne de commande, édition du fichier) : il faudrait surveiller ces fichiers.
- Le cœur du kit : aucune exigence ci-dessus n'y touche.
