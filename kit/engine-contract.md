# Contrat des adaptateurs de moteur (version 1)

Décision de référence : D6 dans `docs/kit-perimetre.md`. Le cœur et l'app ne connaissent aucun moteur : tout ce qui est propre à un moteur passe par un adaptateur qui respecte ce contrat. La suite `kit/core/src/adapter/contract.ts` le vérifie sur chaque adaptateur, y compris sur un adaptateur menteur qu'elle doit prendre en défaut.

## 1. Déclaration

Chaque adaptateur vit dans `kit/engines/<moteur>/` avec un descripteur `adapter.json` :

```json
{ "contract": 1, "engine": "godot", "command": ["node", "src/cli.ts"] }
```

Le descripteur peut porter `domain` (`product`, `entry`, `user`, `framing?`) : les mots du domaine que l'adaptateur sert (« jeu », « scène principale », « joueur » pour Godot), que le cœur reprend sans jamais les nommer lui-même (D9).

Il peut aussi porter `not_applicable` : les vérifications de la suite de contrat sans objet pour ce moteur, parmi `new-project` et les scénarios d'échec du §5 (jamais `healthy`). Un moteur sans scènes déclare `"not_applicable": ["invalid-scene", "empty-main-scene"]`. La suite saute ces vérifications et le dit ; une valeur inconnue rend le descripteur invalide. Sans ce champ (Godot), tout est vérifié.

L'exécutable du moteur se trouve, dans cet ordre : option `--engine`, variable propre à l'adaptateur (`SPAWN_GODOT`), **réglage machine** `~/.spawn/engines.json` (`{ "<moteur>": { "<version>": "<exécutable>" } }`, `SPAWN_CONFIG` pour un autre dossier, écrit par le cœur avec `spawn engines set`), puis recherche de la version du projet dans les emplacements habituels. `prerequisites` rend dans `data.source` d'où vient le chemin (`option`, `variable`, `setting`, `path`, `search`) ; un moteur introuvable donne `engine-not-found` avec la commande exacte qui corrige.

`command` est le programme à lancer et ses premiers arguments ; un chemin relatif est résolu depuis le dossier du descripteur. Un adaptateur peut être écrit dans n'importe quel langage. Un projet déclare son moteur dans `spawn.json` (`{ "engine": "godot", "version": "4.7.2" }`).

## 2. Appel

```
<command de l'adaptateur> <sous-commande> [--option valeur | --drapeau]...
```

- Les chemins passés en option sont absolus.
- Une option répétable (`--exclude`) peut apparaître plusieurs fois.
- `--timeout <secondes>` borne toute sous-commande qui lance le moteur. Au-delà, le moteur est arrêté **par son PID et ses descendants**, jamais par nom d'image, et le résultat porte l'erreur `timeout`.
- Un lancement du moteur ne doit jamais laisser de processus derrière lui.

## 3. Sortie

Sur stdout, **un seul objet JSON**, et rien d'autre. stderr est libre (diagnostic). Schéma : `kit/core/schemas/adapter-result.v1.json`, type TypeScript `AdapterResult` dans `kit/core/src/adapter/types.ts`.

```json
{
  "contract": 1,
  "engine": "godot",
  "command": "test",
  "ok": false,
  "errors": [{ "code": "test-failed", "message": "test_saut : [1] expected to equal [2]", "file": "test/test_saut.gd", "line": 3 }],
  "warnings": [],
  "artifacts": [{ "path": "C:/jeu/.spawn/logs/engine/junit-….xml", "role": "test-report", "type": "junit" }],
  "log": "C:/jeu/.spawn/logs/engine/test-20261117-133000-4f2a.log",
  "duration_ms": 5120,
  "data": { "total": 3, "passed": 2, "failed": 1, "skipped": 0 }
}
```

Invariants vérifiés par la suite de contrat :

| Règle | Détail |
|---|---|
| Code de sortie | 0 si `ok`, 1 si le verdict est `ok: false`, 2 pour un appel invalide (sous-commande inconnue, option manquante) avec `ok: false` et l'erreur `usage`. Tout autre code, ou un stdout qui n'est pas un objet JSON valide, est un plantage de l'adaptateur |
| Verdict | `ok: false` ⇔ `errors` non vide. Un avertissement ne change pas le verdict |
| Erreurs | `code` en kebab-case, `message` lisible ; `file` relatif au projet, séparateurs `/` ; `line` à partir de 1 |
| Journal | `log` vaut `null` si le moteur n'a pas été lancé ; sinon un fichier existant qui contient la sortie complète (stdout et stderr) du moteur |
| Artefacts | `path` : chemins absolus de fichiers existants |
| Vérité | Le verdict vient de la relecture de la sortie et des fichiers produits, jamais du seul code de sortie du moteur |

Écriture d'un `message` d'erreur, à la manière du compilateur Rust (règle d'écriture, que la suite de contrat ne vérifie pas) : il **montre** ce qui est en cause (le fichier, la ligne, l'extrait fautif tel qu'il est écrit), **explique** pourquoi c'est faux en une phrase (ce que le moteur en fera, ou ne fera pas), et **propose** la correction sous la forme exacte à écrire, ou la commande à lancer. Le lecteur est souvent un modèle : il corrige ce qu'on lui montre, pas une règle générale. Exemple (Godot, `invalid-scene`) : « main.tscn:4 : « script = "res://main.gd" » n'attache aucun script : Godot lit une chaîne, pas une ressource. Corriger ainsi : en tête du fichier, après la ligne [gd_scene …] : [ext_resource type="Script" path="res://main.gd" id="1_script"] ; puis, sous le nœud : script = ExtResource("1_script") ».

Journaux et rapports vont dans `--logs <dossier>` s'il est donné, sinon dans `<projet>/.spawn/logs/engine/`. L'adaptateur fait en sorte que son moteur n'importe pas ce dossier.

## 4. Sous-commandes

| Sous-commande | Options | Effet | `data` |
|---|---|---|---|
| `prerequisites` | `[--project]` | Trouve le moteur et ses outils. Avec `--project`, compare à la version de `spawn.json` | `executable`, `version`, `expected_version`, `tools[]` (`name`, `present`, `version`, `path`) |
| `new-project` | `--project --name [--exclude <relatif>]...` | Crée les fichiers du moteur dans un dossier existant, installe le cadre de test et un premier test vert, marque les dossiers exclus comme ignorés par le moteur. Refuse un projet déjà présent (`project-exists`) | `files[]` (relatifs) |
| `prepare-worktree` | `--project [--source]` | Rend un worktree fraîchement créé utilisable (import, caches). `--source` désigne le projet principal dont les caches peuvent être repris. Idempotent | `cache` : `none`, `copy` ou `shared` |
| `compile` | `--project` | Vérifie tout le code du projet sans exécuter le jeu, puis charge (et instancie, sans l'exécuter) chaque scène et ressource du projet : une scène que le moteur refuse est un échec `invalid-scene`, avec `file` | `files_checked`, `scenes_checked` |
| `test` | `--project [--filter]` | Lance les tests du projet. Zéro test lancé est un échec (`no-tests`) ; un fichier de test qui ne se charge pas aussi | `total`, `passed`, `failed`, `skipped`, `end_to_end[]` |
| `smoke-test` | `--project [--seconds]` | Smoke test : lance la scène principale du projet sans fenêtre et la laisse tourner `--seconds` (3 par défaut). Pas de scène principale déclarée : `main-scene-missing` ; une erreur relevée dans la sortie, ou un jeu arrêté avant la fin : `runtime-error` (avec `file` et `line` si connus) ; une scène principale sans aucun code : `main-scene-empty` | `scene` (`null` si absente), `seconds` |
| `capture` | `--project --scene --output [--frames] [--width] [--height]` | Lance une scène dans une vraie fenêtre, attend `--frames` images rendues et enregistre une image PNG en `--output` (artefact `capture`). Une erreur de script pendant le rendu est un échec | `scene`, `width`, `height` |
| `launch` | `--project [--scene]` | Lance le jeu pour le joueur (scène principale, ou `--scene`) et rend la main aussitôt, sans attendre sa fin : le jeu est détaché et survit à l'appel. N'importe rien (`prepare-worktree` l'a fait ; sinon avertissement). Un dossier qui n'est pas un projet, une scène absente ou un moteur introuvable sont des échecs | `pid`, `scene` (`null` = scène principale) |
| `read-log` | `--file` | Relit un journal existant avec les motifs d'erreur du moteur | `lines` |
| `file-types` | aucune | Types de fichiers du moteur, pour l'app (aperçus, ouverture) | `types[]` (`extension`, `category`, `language?`, `open`) |
| `git-patterns` | aucune | Motifs que le cœur écrit dans le dépôt du jeu | `gitignore[]`, `gitattributes[]`, `lfs[]`, `lockable[]` |
| `example` | `--project --scenario` | Crée un projet d'exemple pour la suite de contrat (§5). Ne sert qu'aux tests | `scene` (référence à passer à `capture`) |

Précisions :

- `test --filter` restreint les fichiers de test lancés (motif sur leur nom), pas les tests à l'intérieur d'un fichier.
- `test` : `end_to_end` liste, parmi les fichiers de test lancés (relatifs, triés), ceux qui citent la scène principale (son chemin exact dans le source, Godot : `res://…` ou son `uid://`) : les tests de bout en bout. Vide sans scène principale. Le cœur s'en sert pour savoir si le jeu est testé en entier, pas seulement par morceaux.
- `compile`, `test` et `smoke-test` répondent à trois questions différentes : le code et les scènes se chargent, les règles sont justes, le jeu démarre et tourne. Un vert ne vaut que pour sa question.
- `launch` est la seule exception au §2 : ni `--timeout`, ni arrêt de l'arbre, c'est le joueur qui ferme le jeu. Son journal est rempli par le jeu tant qu'il tourne. La suite de contrat ne le juge que sur un dossier qui n'est pas un projet (un vrai lancement ouvrirait une fenêtre) ; le cas réussi est testé par chaque adaptateur.
- `file-types` : `extension` en minuscules avec son point (`.gd`).
- Un adaptateur peut accepter des options en plus et ajouter des clés à `data` (Godot : `--engine <exe>` sur toutes les sous-commandes, `data.engine_exit_code`). Le cœur et l'app ne s'appuient que sur ce que fixe ce contrat.

Valeurs fermées :

- `category` : `code`, `scene`, `resource`, `shader`, `image`, `model-3d`, `audio`, `video`, `project`, `text`.
- `open` : `engine` (l'éditeur du moteur, jamais sur un worktree), `editor` (éditeur de texte), `system` (application par défaut).

## 5. Scénarios d'exemple

`example --scenario` crée un petit projet dont l'issue est connue. La suite de contrat l'utilise pour juger le verdict de l'adaptateur sans rien savoir du moteur :

| Scénario | Attendu |
|---|---|
| `healthy` | `compile` (au moins une scène vérifiée), `test` (au moins un test réussi, au moins un test de bout en bout), `smoke-test` et `capture` (PNG présent) réussissent |
| `code-error` | `compile` échoue, avec au moins une erreur qui porte `file` et `line` |
| `runtime-error` | Le code compile, mais la scène (principale) lève une erreur de script à l'exécution : `compile` réussit, `capture` et `smoke-test` échouent |
| `failing-test` | `test` échoue, avec `failed` ≥ 1 |
| `test-not-loaded` | Un fichier de test ne se charge pas : `test` échoue |
| `no-tests` | `test` échoue avec `no-tests` |
| `invalid-scene` | Tout le code compile, mais une scène ne se charge pas : `compile` échoue avec `invalid-scene` et `file` |
| `no-main-scene` | Aucune scène principale déclarée : `smoke-test` échoue avec `main-scene-missing` ; `test` réussit avec `end_to_end` vide |
| `empty-main-scene` | La scène principale ne porte aucun code : `smoke-test` échoue avec `main-scene-empty` |

Un scénario déclaré dans `not_applicable` (§1) n'est ni créé ni jugé. Un adaptateur qui déclare `invalid-scene` n'a pas de scènes : `compile` sur `healthy` peut rendre `scenes_checked: 0`. Quand l'outil de capture manque sur la machine, la suite peut sauter les captures (option `skipCapture` de `checkContract`), en le disant.

## 6. Godot, Unreal et Node

Le contrat est écrit pour les deux moteurs. Godot est implémenté ; la colonne Unreal fixe ce que le contrat doit pouvoir porter.

| Sujet | Godot 4.7 | Unreal 5.8 (plus tard) |
|---|---|---|
| Code de sortie menteur | Une `SCRIPT ERROR` à l'exécution sort en 0 ; GUT sort en 0 quand un test ne se charge pas ou quand rien n'a tourné | Les tests d'automatisation sortent souvent en 0 avec des échecs : relire le rapport |
| `compile` | Chargement de chaque script GDScript (`tools/check-scripts.gd`), puis chargement et instanciation de chaque `.tscn`, `.scn`, `.tres`, `.res` hors `addons/`, dossiers cachés et dossiers à `.gdignore` (`tools/check-scenes.gd`) : deux lancements. `load()` accepte une racine qui déclare un parent, seule l'instanciation la refuse | UnrealBuildTool (C++), puis compilation des Blueprints, puis chargement des cartes (`-run=ResavePackages -verify` ou commandlet équivalent) |
| `test` | GUT, rapport JUnit | Automation (`-ExecCmds="Automation RunTests …"`), rapport JSON |
| `prepare-worktree` | Import (`--import`) : sans lui, un worktree n'a pas de `.godot/` | Worktree lourd : Derived Data Cache partagé avec la source (`cache: shared`), pas de copie |
| `git-patterns` | `.godot/` ignoré ; `.gdignore` dans les dossiers exclus ; scènes texte fusionnables | `Binaries/`, `Intermediate/`, `Saved/`, `DerivedDataCache/` ignorés ; `.uasset` et `.umap` en LFS **et verrouillables** (`lockable`) |
| `smoke-test` | `run/main_scene` de `project.godot` (`uid://` résolu par l'en-tête des scènes), lancée par `tools/smoke-test.gd` avec `--headless --max-fps 60` : instance ajoutée à la racine, autoloads présents ; aucun nœud à script dans la scène, sous-scènes comprises = `main-scene-empty` | `GameDefaultMap`, `UnrealEditor <projet>.uproject -game -nullrhi -ExecCmds="quit"` après N secondes |
| `test` : `end_to_end` | Fichiers des suites du rapport JUnit dont le source cite le chemin `res://` ou l'`uid://` de la scène principale | Tests d'automatisation qui ouvrent la carte par défaut |
| `capture` | Script externe lancé par `--script`, fenêtre réelle | `HighResShot` ou commande de capture du projet |
| `launch` | `--path <projet> [res://scène]`, processus détaché, sortie dans le journal | `UnrealEditor <projet>.uproject [carte] -game`, détaché |
| Processus | PID capturé au lancement ; arrêt de l'arbre par PID | Idem, l'éditeur lance des processus enfants |

### Node (`kit/engines/node`)

Pour une app Node et TypeScript (Spawn le premier). Le moteur est la pile du projet : Node et npm du PATH. L'adaptateur ne connaît aucun projet : il ne lance que les scripts npm que le projet déclare dans `spawn.json`, section `node`. Une commande non déclarée est un échec (`not-declared`, ou `main-scene-missing` pour `smoke-test`) dont le message dit quelle clé ajouter ; un script déclaré absent de `package.json` est un échec `script-missing`.

```json
{
  "engine": "node",
  "version": "24",
  "node": {
    "compile": ["typecheck", "lint"],
    "test": "test:unit",
    "smoke_test": "smoke",
    "launch": "dev",
    "capture": { "path": "/", "wait_ms": 1000 },
    "end_to_end": ["service/test/service.test.ts"]
  }
}
```

| Sujet | Node |
|---|---|
| Déclaration | `not_applicable` : `invalid-scene`, `empty-main-scene` (pas de scènes) |
| `new-project` | Gabarit minimal sans dépendance : `package.json`, `src/` (serveur qui écrit `SPAWN-URL`), `test/` (unitaire et bout en bout), `tools/` (vérification de syntaxe, smoke test), et la section `node` de `spawn.json` (le cœur a déjà écrit le reste). `--exclude` est sans objet. Refuse un `package.json` existant (`project-exists`) |
| `prerequisites` | `node` du PATH (version majeure comparée à `spawn.json`), `npm`, Edge (avertissement s'il manque) ; avec `--project`, dépendances installées (`node_modules/`), sinon `dependencies-missing` avec la commande exacte (`npm ci`, ou `npm install` sans `package-lock.json`) |
| `prepare-worktree` | `package-lock.json` identique à celui de `--source` et `node_modules/` présent dans la source : un lien symbolique de dossier vers chaque `node_modules/` de la source que décrit le `package-lock.json`, racine et espaces de travail (`kit/core/node_modules/`) (`cache: shared`). Sinon `npm ci` (`cache: none`). Idempotent. **Jamais de jonction** : `git worktree remove --force` (Git pour Windows 2.47) suit une jonction et vide le `node_modules/` de la source ; un lien symbolique est seulement retiré. Sans le droit de créer un lien (mode développeur de Windows inactif), `npm ci` |
| `compile` | Chaque script de `node.compile`. Erreurs relues : tsc (`fichier(l,c): error TSxxxx` et `fichier:l:c - error TSxxxx`), eslint (format stylish), cargo (`error…` puis `--> fichier:l:c`), erreurs non rattrapées de Node (`SyntaxError`…). Un script en échec sans erreur reconnue : `script-failed`. `files_checked` : fichiers de code du projet (indicatif) ; `scenes_checked` : 0 |
| `test` | Script `node.test`, sortie du lanceur de tests de Node (reporter spec ou TAP) : `ℹ tests`, `pass`, `fail` (+ `cancelled`), `skipped` (+ `todo`), additionnés sur toutes les suites (`npm test --workspaces`). Noms des tests en échec (section `✖ failing tests:`), avec fichier et ligne. `end_to_end` : fichiers des motifs `node.end_to_end` quand des tests ont tourné. `--filter` n'est pas pris en charge (avertissement) |
| `smoke-test` | Script `node.smoke_test` ; `--seconds` est une limite (120 par défaut, une construction peut tourner), pas une durée à tenir. Code de sortie non nul : `runtime-error` ; limite dépassée : `timeout`, arbre arrêté. `scene` : le nom du script |
| `launch` | Script `node.launch`, détaché (voir le protocole ci-dessous) ; `data` : `pid`, `url` (plus la route `--scene`), `scene`. Le joueur voit l'app dans une fenêtre Edge en mode application (`--app`, profil jetable) : fermer la fenêtre arrête l'app par son PID, arbre compris ; arrêter l'app ferme la fenêtre ; le profil est supprimé. Edge absent : `browser-not-found` (avertissement), l'app tourne sans fenêtre |
| `capture` | Lance comme `launch`, ouvre `url` + route (`--scene`, sinon `node.capture.path`) dans Edge sans fenêtre (`--headless=new --screenshot --window-size`, profil jetable, attente `node.capture.wait_ms`), écrit le PNG puis arrête l'app par son PID. `--scene` est facultatif. Edge absent : `browser-not-found` (`SPAWN_EDGE` désigne un autre exécutable) |
| `git-patterns` | `node_modules/`, `dist/`, `target/`, `.spawn/` ignorés ; pas de LFS |
| Processus | Scripts lancés par `npm run <script>` ; arrêt de l'arbre par PID (`taskkill /T /F` sous Windows) |

**Protocole de lancement.** Le script `node.launch` démarre l'app sur un port libre qu'il choisit lui-même, puis écrit sur stdout **une ligne** `SPAWN-URL <url>` (ex. `SPAWN-URL http://127.0.0.1:5173`) quand elle est prête à répondre. L'adaptateur lance `npm run <script>` détaché, dans le dossier donné (projet principal ou worktree), sa sortie dans le journal ; il relit le journal jusqu'à cette ligne (60 s par défaut, `--timeout` pour une autre limite), puis rend `pid` et `url`. Le processus survit à l'appel et continue de remplir le journal ; on l'arrête par ce `pid` et ses descendants, jamais par nom de processus. Le script qui s'arrête avant d'écrire la ligne : `runtime-error` (avec les erreurs relues dans le journal) ; la ligne qui n'arrive pas à temps : `timeout`, arbre arrêté.
