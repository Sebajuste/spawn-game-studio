# Référence UI/UX : Mr. Mak Workspace 0.6.4

Lu le 2026-11-17 dans `C:\Temp\mr-mak-workspace` (README, `desktop/README.md`, `docs/`, captures, liste de `src/`). Rien n'a été exécuté.

## 1. Ce que propose Mr. Mak

| Zone | Fonctionnalités |
|---|---|
| Deux fenêtres | **Chats** (donner des tâches) et **Workspace** (relire les résultats), côte à côte ou réduites séparément |
| Onglets de chat | Un onglet = une session CLI réelle (PTY). Épingler, colorer, renommer (F2), grouper par projet (en-têtes repliables, déplaçables), pastille « réponse non lue » |
| Nouveau chat | Agent, nom, permissions visibles ; projet, dossier, effort, reprise sous « Avancé », fermé par défaut. Projets récents lus dans `.claude.json`, favoris épinglés |
| Vue Conversation / Terminal | Bascule par chat. Conversation : Markdown, tableaux, images, heure, outils récents résumés ; Terminal pour les contrôles natifs. La dernière vue choisie devient le défaut |
| Menus de permission | Le menu numéroté du CLI devient des boutons ; l'écran est relu avant d'envoyer la touche, une réponse périmée est refusée |
| Compositeur | Entrée = envoyer, pièces jointes, image collée, dictée ; `/` complète commandes et skills ; crayon sur un message = rewind et nouvel envoi ; Échap = Stop |
| Activité | Ligne au-dessus du compositeur : sous-agents et commandes de fond en cours, tâche et étape de chacun, durée |
| Barre d'état | Connecté et sauvegardé, modèle, effort, mode de permission ; ligne Contexte (pourcentage et jetons, « limite estimée » pour Claude, « inconnu » si la donnée manque) |
| Événements du CLI | Résultats d'agents de fond, commandes et revues affichés en événements courts ; Compact, Étendu ou Masqué |
| Longs chats | Après 40 messages : proposition « Résumer et continuer » (passation dans `inbox/handoffs`, nouveau chat même agent et mêmes réglages) |
| Workspace | Cartes de projet avec onglets (brief, recherche, versions), statut, épinglage, archive ; rapports HTML ; Markdown lisible et éditable ; arbre de fichiers ; panneaux Skills, MCP, Réglages, Aide à droite |
| Téléphone | Web app via Tailscale : lire, répondre, dicter, ouvrir les rapports ; Terminal en mode « Wrap » |
| Thèmes | Thèmes séparés Workspace et Chat, contraste vérifié |

## 2. Ce qui rend l'usage simple

1. **Les réglages rares sont cachés.** « Nouveau chat » montre trois champs ; le reste est sous « Avancé ».
2. **Pas d'écran vide ni de question cachée.** Un chat neuf s'ouvre en Terminal tant que le CLI peut demander confiance ou connexion.
3. **Un clic au lieu d'une touche.** Permissions en boutons, liens de fichiers ouverts en aperçu, images agrandies.
4. **Ce qui tourne se voit.** Sous-agents et commandes de fond avec leur étape et leur durée ; pastille de non-lu sur l'onglet.
5. **L'inconnu est dit.** Contexte « inconnu » ou « limite estimée » plutôt qu'un chiffre faux.
6. **Les actions risquées sont gardées.** Réponse à une permission liée au menu vu ; pas de redémarrage sans accord.
7. **Le bruit est réduit.** Événements du CLI compactés, réglables.

## 3. Ce qu'on reprend pour l'app

| Élément | Adaptation |
|---|---|
| Onglets groupés par projet, non-lu, épinglage | Groupe = jeu ; onglet = fil |
| Vue Conversation + Terminal | Conversation alimentée par `stream-json` du CLI, pas par la lecture du transcript ni de l'écran ; Terminal gardé en secours |
| Ligne d'activité (sous-agents, commandes de fond) | Alimentée par les événements du CLI et `.spawn/fils/<fil>.json` |
| Ligne Contexte avec « inconnu » | Montre aussi le seuil de compactage du kit |
| « Avancé » fermé par défaut | Appliqué à « Nouveau fil » et « Nouveau projet » |
| Barre d'état (modèle, effort, mode) | Plus la branche et le worktree du fil |
| Événements compacts | Résultats de sous-agents, compactages, commits, fusions |
| Aperçu de fichiers et Markdown depuis un lien | Specs, passations, retex lisibles sans quitter l'app |
| Compositeur (`/`, pièces jointes, image collée, Échap) | Tel quel ; dictée plus tard |

## 4. Ce qu'on fait mieux ou autrement

| Mr. Mak | Spawn Game Studio |
|---|---|
| Menus de permission en boutons | Plus de menus : bypass + hook de périmètre (D2). Seules les vraies décisions remontent, en issues |
| « Résumer et continuer » après 40 messages, à cliquer | Compactage guidé automatique au seuil de contexte (D3) |
| Cartes de rapports HTML | Tableau de bord du jeu : fils et statuts, worktrees, MR et CI, décisions en attente, ménage (D5) |
| Un projet = un dossier | Un projet = un jeu créé ou adopté par le kit (`/nouveau-jeu`, `/adopter`) |

## 5. Ce qu'on laisse

Multi-CLI (Codex, OpenCode, Antigravity, Kimi), voix OpenAI, cartes éditables, thèmes multiples, accès mobile (à revoir plus tard : Remote Control natif de Claude Code d'abord).

## 6. Liens et médias dans les réponses des agents

| Principe | Détail |
|---|---|
| Connaître plutôt que deviner | Les fichiers écrits ou modifiés viennent des appels d'outils du flux `stream-json` : ligne « Fichiers touchés » en pastilles sous chaque réponse. La détection de chemins dans le texte (Markdown, `chemin:ligne`) ne sert qu'en complément |
| Aperçu par type | Code et texte : panneau latéral coloré, positionné sur la ligne, bouton « ouvrir dans l'éditeur ». Markdown : rendu. Image : vignette dans le message, plein écran, zoom, avant/après. Vidéo et son : lecteur dans le message. Modèle 3D : visionneuse plus tard. URL : navigateur par défaut. Fichier absent : pastille « introuvable ». Les types et leur ouverture (ex. « ouvrir dans Godot », jamais sur un worktree) viennent de l'adaptateur du moteur (D6) |
| Galerie par fil | Toutes les captures, vidéos et sons d'un fil dans un onglet |
| Convention des agents (règle du kit) | Chemins relatifs au worktree ou `chemin:ligne` ; média intégré par `![légende](chemin)` ; médias produits dans `.spawn/media/<fil>/` |
| Sécurité | Protocole de fichiers de Tauri limité au dossier du projet, comme le périmètre des agents |
| À vérifier | WebView2 lit MP4 (H.264), WebM, WAV, OGG, MP3 ; probablement pas l'AVI MJPEG ni l'OGV Theora de Movie Maker : conversion ffmpeg pour l'aperçu ou captures en WebM/MP4 |
