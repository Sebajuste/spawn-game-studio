# Menu « Projet » dans la barre de menus (spec, 2026-11-18)

Demande : dans la barre de menus, renommer le menu « Jeu » en « Projet », comme dans la maquette `docs/maquettes/app.html`.

## Ce que tu verras

Tu ouvres l'app : la barre de menus montre, dans l'ordre, **Fichier, Projet, Affichage, Aide**. Le deuxième menu s'appelle « Projet » au lieu de « Jeu ». Son contenu ne change pas (Nouvelle feature, Lancer le jeu, Livrées et abandonnées, Ouvrir le dossier, Réglages du projet…), ni ses raccourcis (Ctrl+Maj+N, F5).

## Exigences

- **SGS-31** La barre de menus de l'app affiche « Fichier », « Projet », « Affichage », « Aide », dans cet ordre, et aucun menu nommé « Jeu ». Preuve : capture (l'app ouverte, barre de menus visible). Un test automatique demanderait un outillage de test de l'interface React (rendu de composants ou pilotage de la fenêtre) que le projet n'a pas ; il n'est pas ajouté ici.
- **SGS-32** Le menu « Projet » garde les mêmes entrées, dans le même ordre, avec les mêmes raccourcis qu'avait le menu « Jeu ». Preuve : aucune ; vérifiée par la relecture du code (`src/App.tsx` : entrées, ordre et raccourcis du menu inchangés) et par le contrôle demandé à l'utilisateur dans le compte rendu à juger (déplier le menu dans l'app) ; l'utilisateur a accepté la feature et choisi cette preuve. Une capture automatique demanderait un moyen d'ouvrir un menu au chargement, que l'app n'a pas.

## Hors périmètre

- Les autres écarts avec la maquette : menu Fichier (« Nouveau projet… », « Ouvrir un projet… », « Projets récents », « Fermer le projet »), entrées absentes du menu Projet (« Signaler un bug… », « Planifier une version… », « Livrer une version… »).
- Le mot « jeu » ailleurs dans l'app (« Lancer le jeu », messages, écrans).
