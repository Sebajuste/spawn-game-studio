# Moteur « container » : un projet qui déclare son environnement

État : proposée (2026-11-22), à valider par le mainteneur. Maquette : `docs/maquettes/reglages.html`, écrans 1, 10 et 11.

## 0. Pourquoi

Un agent ne travaille sans l'utilisateur que si compiler et tester donnent le même verdict sur toute machine. Un service Java 8 ou 21 construit avec Maven, ou un front webpack ancien, dépend aujourd'hui du JDK, de Maven ou de Node installés sur l'hôte. Le verdict ne prouve alors rien. Un essai d'adoption d'un front ancien l'a montré : `npm ci` échoue sous Node 26, et l'adoption a noté la version de l'hôte, que le projet ne déclarait pas.

Le principe : **l'environnement d'exécution appartient au projet**. Il est déclaré dans son dépôt (`spawn.json`), versionné et relu ; Spawn s'y conforme.

## 1. Décisions proposées

1. **Un adaptateur de plus, pas de changement du cœur.** `kit/engines/container` respecte le contrat v1 (`kit/engine-contract.md`) tel quel. Le cœur, les schémas et le contrat ne bougent pas. L'adaptateur `node` et son `node.runner` restent inchangés.
2. **L'environnement est une image.** Pour ce moteur, la `version` de `spawn.json` est la référence de l'image (`maven:3.9-eclipse-temurin-21`). Les commandes s'y exécutent, le projet étant monté en `/work`. L'agent, lui, reste sur l'hôte : seules les commandes passées par `spawn engine` vont dans le conteneur.
3. **Le verdict des tests vient des rapports JUnit XML** écrits pendant l'appel. Surefire, Gradle, Jest (`jest-junit`), Playwright, PHPUnit et pgTAP (`pg_prove --formatter`) produisent tous ce format.
4. **L'adoption propose, à partir de recettes.** Les recettes sont des données (`kit/engines/container/recipes.json`), pas du code : en ajouter une ne demande aucun changement d'adaptateur. Il y en a deux en v1, Maven et Gradle. La version de Java est lue dans le projet ; sans déclaration, elle est signalée et jamais inventée.
5. **Les secrets restent sur la machine.** Les fichiers de l'hôte à monter (`~/.m2/settings.xml` pour un dépôt Maven privé) se déclarent par machine dans `~/.spawn/container.json`, toujours en lecture seule, jamais dans le dépôt.
6. **Hors v1** :
   - `launch` et `capture` : il n'y a pas de fenêtre pour un service (ils répondent `not-declared`) ;
   - la pile d'intégration multi-dépôts (Compose et tests de bout en bout au niveau d'un epic) : spec suivante ;
   - Podman ;
   - les projets Node : ils restent sur l'adaptateur `node`, avec `node.runner` pour une version ancienne.

## 2. `spawn.json`

```json
{
  "engine": "container",
  "version": "maven:3.9-eclipse-temurin-21",
  "tag": "API",
  "container": {
    "compile": ["mvn -B -q -DskipTests test-compile"],
    "test": { "command": "mvn -B test", "reports": ["**/target/surefire-reports/TEST-*.xml"] },
    "smoke_test": "mvn -B -q -DskipTests package",
    "caches": ["/root/.m2/repository"]
  }
}
```

Les clés connues de la section `container` sont `compile`, `test`, `smoke_test` et `caches` ; toute autre est refusée avec l'exemple à écrire (comme pour `node`).

| Clé | Sens |
|---|---|
| `compile` | Commandes `sh -c` lancées dans l'ordre ; la première en échec arrête |
| `test.command` | La suite de tests ; `test.reports` : motifs (relatifs au projet) des rapports JUnit qu'elle écrit |
| `smoke_test` | Facultatif : une commande qui dit que l'ensemble se construit ou démarre |
| `caches` | Dossiers du conteneur gardés d'un appel à l'autre. Ils deviennent des volumes nommés par projet, partagés par ses worktrees |

Les commandes sont versionnées dans le dépôt, au même titre que les scripts de `package.json` ; le périmètre des agents s'applique à `spawn.json` comme à tout fichier.

## 3. Exécution

```
docker run --rm --name spawn-<id> -v <projet>:/work -w /work
  [-v spawn-<projet>-<n>:<cache>]... [-v <hôte>:<cible>:ro]... <image> sh -c "<commande>"
```

- L'arrêt passe par le nom du conteneur (`docker kill`), jamais par le client `docker` ni par un nom d'image : c'est la règle du §2 du contrat.
- `--timeout` borne chaque commande.
- Sous Linux, `--user <uid>:<gid>`, pour que les fichiers écrits dans `/work` appartiennent à l'utilisateur.
- Les chemins `/work/…` de la sortie sont rendus relatifs au projet, avec des `/`.

## 4. Verdicts

| Sous-commande | Réussite | Échecs |
|---|---|---|
| `compile` | Toutes les commandes finissent en 0 **et** aucune ligne d'erreur reconnue (javac et Maven `[ERROR] …java:[l,c]`, Kotlin, Gradle) | `compile-error` avec `file` et `line` ; code non nul sans ligne reconnue : `compile-failed` avec les dernières lignes du journal |
| `test` | Au moins un rapport écrit pendant l'appel, aucun test en échec ou en erreur, commande finie en 0 | `test-failed` (un par cas : classe, nom, message, `file` si connu) ; aucun rapport ou zéro test : `no-tests` ; rapport illisible : `report-invalid` ; rapports verts mais code non nul : `test-runner-failed` |
| `smoke-test` | Commande finie en 0, sans ligne d'erreur reconnue | `runtime-error` |

Un rapport plus ancien que le début de l'appel est ignoré : on ne juge jamais une exécution précédente. Le code de sortie ne fait que retirer un vert, il n'en donne jamais un seul (§3 du contrat, « Vérité »).

## 5. Les autres sous-commandes

- `prerequisites` : `docker version` répond (client et démon), puis l'image est présente ou se récupère. `data.tools` décrit Docker et l'image ; un démon arrêté donne `engine-not-found`, avec la commande qui corrige.
- `detect` : vrai si `spawn.json` déclare `container`, ou si une recette reconnaît le dossier (`pom.xml`, `build.gradle`, `build.gradle.kts`). `evidence` vaut ce fichier, et `version` l'image proposée.
- `adopt` : remplit la section `container` à partir de la recette, sans rien écraser.
  - Les écarts sont signalés comme `gaps` : version de Java non déclarée, `~/.m2/settings.xml` présent sur la machine mais non monté, absence de wrapper Gradle.
  - Sans recette, `adopt` écrit une section vide et le dit (« déclarer compile et test »).
- `prepare-worktree` : récupère l'image si besoin ; `cache: "shared"` (volumes du projet).
- `new-project` : sans objet en v1 (`not_applicable`), ce moteur sert à adopter l'existant.
- `file-types` : les types Java, Kotlin, XML et Gradle.
- `git-patterns` : `gitignore` vaut `target/`, `build/` et `.gradle/` (la suite de contrat exige une liste non vide).
- `launch`, `capture` : `not-declared` (v1).
- `example` : un petit projet Maven par scénario (§5 du contrat), écrit par l'adaptateur.
  - `data.scene` est la classe principale, et `smoke_test` l'exécute (`java -cp target/classes …`).
  - `runtime-error` : la classe principale lève une exception.
  - `test-not-loaded` : un fichier de test qui ne compile pas.
  - `end_to_end` cite le test qui appelle la classe principale.

Le descripteur déclare `"not_applicable": ["new-project", "invalid-scene", "empty-main-scene"]`. La suite de contrat lance `capture` sur `healthy` et `runtime-error` ; pour ce moteur, elle s'exécute avec `skipCapture` (« pas de capture pour un service »), et le dit. Le contrat le permet déjà (§5 de `kit/engine-contract.md`), même si l'option est prévue pour un outil de capture absent. Si le mainteneur préfère un `not_applicable: ["capture"]` explicite, c'est une évolution du contrat, hors de cette spec.

## 6. Recettes

```json
[
  { "id": "maven", "title": "Maven", "evidence": ["pom.xml"],
    "java": { "from": ["maven.compiler.release", "maven.compiler.source", "java.version", "maven-compiler-plugin release|source"] },
    "image": "maven:3.9-eclipse-temurin-{java}",
    "compile": ["mvn -B -q -DskipTests test-compile"],
    "test": { "command": "mvn -B test", "reports": ["**/target/surefire-reports/TEST-*.xml"] },
    "caches": ["/root/.m2/repository"],
    "mounts": ["~/.m2/settings.xml"] },
  { "id": "gradle", "title": "Gradle", "evidence": ["build.gradle", "build.gradle.kts"],
    "java": { "from": ["java.toolchain.languageVersion", "sourceCompatibility"] },
    "image": "gradle:8-jdk{java}",
    "compile": ["{gradle} --no-daemon -q testClasses"],
    "test": { "command": "{gradle} --no-daemon test", "reports": ["**/build/test-results/test/TEST-*.xml"] },
    "caches": ["/home/gradle/.gradle"] }
]
```

- `{java}` : la version lue (`1.8` devient `8`). Si aucune n'est lue, le diagnostic l'affiche en ⚠ et propose la version LTS la plus récente, à confirmer dans le champ Version.
- `{gradle}` : `./gradlew` si le wrapper est présent, sinon `gradle`.
- `mounts` : les fichiers de l'hôte que la recette suggère de monter, s'ils existent sur la machine.

## 7. Réglages machine : `~/.spawn/container.json`

```json
{ "mounts": [{ "source": "~/.m2/settings.xml", "target": "/root/.m2/settings.xml" }] }
```

Le fichier s'applique à tous les projets `container` de la machine, toujours en lecture seule. `SPAWN_CONFIG` désigne un autre dossier (tests). L'app ne l'édite pas en v1 : le diagnostic dit quoi écrire.

## 8. Interface

- **Réglages > Application, Moteurs** : une ligne de plus, « Conteneur (Maven, Gradle) », produit « service ».
- **Ajouter un projet existant** : le moteur proposé est « Conteneur ». Le champ Version montre l'image, modifiable. L'origine indique la recette et la version lue : « reconnu par `pom.xml` (Java 21) ». La section du moteur liste les commandes, les rapports, les caches et les montages.
- **Projet adopté, suite de départ** : elle s'exécute dans l'image. Un échec reste dit tel quel ; une première story peut le corriger.

## 9. Vérification

- Tests de l'adaptateur sans Docker : lecture de `spawn.json`, recettes (lecture de la version de Java dans des `pom.xml` et `build.gradle` d'exemple), lecture JUnit (cas vert, échec, erreur, ignoré, rapport périmé, rapport illisible), lignes d'erreur javac et Maven, construction de la commande `docker run`.
- Suite de contrat avec Docker : comme pour Godot, elle demande le moteur et ne fait pas partie de la vérification d'une story.
- Essai réel, hors du dépôt : adopter un clone d'un service Java 21 qui a une cinquantaine de tests. Suite de départ verte attendue, sans JDK ni Maven sur l'hôte.
