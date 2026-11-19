# {{GAME_NAME}}

Vision du projet, préférences et objectifs en cours : `context/`. Leçons apprises : `knowledge/`.

## Décider par l'objectif

L'utilisateur fixe la vision et décide de l'architecture ; il dit ce qu'il veut, puis juge ce qu'il voit. Tout le reste se fait sans lui, et tout ce qu'on lui montre a été vérifié. Le projet ne s'éloigne ni de sa vision ni de son architecture sans qu'il l'ait décidé.

Avant de trancher un problème technique (outil, architecture, contournement, test, processus), remonter à l'objectif : celui du projet (`context/`) et celui-ci. Retenir la solution qui le sert le plus simplement :

- **Sans lui** : elle ne lui demande ni permission, ni arbitrage, ni surveillance.
- **Vérifié** : rien n'est déclaré fait, vert ou relu sans une vérification de l'outil ; ce qui n'est pas vérifié est dit non vérifié. « Vert » veut dire que le programme se lance et remplit ses critères d'acceptation. Aucune dette cachée (pas de rouge admis, pas de contournement silencieux).
- **Maîtrisé** : elle ne s'éloigne ni de la vision (`context/vision.md`) ni de l'architecture sans décision de l'utilisateur ; un nouveau composant, une nouvelle dépendance ou un contrat changé se proposent au cadrage, jamais en douce.
- **Petit** : elle est à la taille du projet ; pas d'outillage que rien ne mesure.

Si la réponse n'est pas évidente, c'est l'objectif qui n'est pas clair : le clarifier avant de choisir un « comment ».

## Analyser

Quand quelque chose résiste (un rouge qui revient, une commande refusée, un résultat inattendu) :

- **Prendre du recul** : relire l'objectif (la spec du fil, l'étape que donne `spawn next`). Ce qui ne le sert pas attend.
- **Lire l'outil jusqu'au bout** : son message dit ce qui ne va pas, où, et comment corriger. Appliquer sa correction avant d'en inventer une.
- **Mesurer** : une cause n'est retenue que si une mesure la montre (la sortie de l'outil, le fichier réel, la ligne citée), jamais parce qu'elle est plausible.
- **Chercher à réfuter, pas à confirmer** : se demander quelle observation contredirait l'hypothèse, et la faire. Deux essais qui échouent pour la même raison : l'hypothèse est fausse, en changer au lieu de réessayer.
- **Ne jamais contourner l'outil** (changer sa vérification, écrire au ledger ce qui n'est pas fait) : s'il semble avoir tort, s'arrêter et le dire à l'utilisateur, avec la mesure.

## Organisation

Par composant réutilisable, à la manière de React : un composant = un dossier qui contient au moins sa scène et son script, ses ressources dédiées et ses tests (`tests/`), regroupé par thème. Ce qui est réutilisable (outil d'éditeur, bibliothèque entre projets) est séparé du code du projet et des assets bruts. L'arborescence de ce moteur : `knowledge/organization.md`. La compilation signale un fichier mal rangé et dit où le déplacer.

## Travailler

- Toute feature passe par la skill `story` du kit (`spawnstudio:story` sous Claude Code, `spawn-story` sous OpenCode), dans le worktree de son fil. À tout moment, `spawn next` donne l'action exacte à faire.
- Exigences : `{{TAG}}-NN`, dans `docs/specs/`. Plans : `docs/plans/`.
- Moteur : {{ENGINE}} {{VERSION}}. Compiler, tester, capturer passent par l'outil `spawn engine`, jamais par le moteur en direct : seule la sortie relue fait foi.
- Shell sous Windows : Windows PowerShell 5.1 quand l'agent n'en choisit pas d'autre. Pas de `&&` ni de `||` : enchaîner par `;`, ou `A; if ($?) { B }` ; un exécutable dont le chemin est entre guillemets se lance par `& "<chemin>" <arguments>` ; `2>$null`, pas `2>nul`. Un message de commit accentué s'écrit dans un fichier (outil d'écriture, UTF-8), puis `git commit -F <fichier>` : passé en argument, PowerShell 5.1 abîme les accents.
- Une leçon fiable va dans `knowledge/<sujet>.md` (une note par sujet), pas dans la mémoire de l'agent.
