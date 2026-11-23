// Vérification d'un plan à l'enregistrement : forme lisible par spawn next, fichiers du moteur et pas d'une autre plateforme.
import assert from "node:assert/strict";
import { test } from "node:test";
import { planDefects, planProofDefects, specDefects, specRequirements, specSection } from "../src/plan.ts";

// Inventaire fait avant la spec : ce qu'on étend, ou ce qu'on a cherché sans le trouver.
const EXISTING = "## Existant\n\n- Barre de menus : `src/menubar/MenuBar.tsx`, étendue.\n- Raccourci : rien d'existant (cherché : `src/`, `docs/`).\n";

const GODOT = [".gd", ".tscn", ".tres", ".gdshader"];

test("plan: readable tasks and engine files accepted", () => {
  assert.deepEqual(planDefects("## Tâche 1 : grille\nFichiers : `core/games/morpion/grille.gd`, `grille.tscn`\n## Tâche 2 : tour\n", GODOT, "godot"), []);
});

test("plan: the 18/11 night plan (« ### 1. », HTML, CSS, JavaScript in a Godot project) is refused, with what to do", () => {
  const night = "### 1. Structure HTML/CSS de la grille\n**Fichier(s) :** `public/index.html`, `public/styles.css`\n### 2. Logique\n`src/game.js`\n";
  const d = planDefects(night, GODOT, "godot", "jeu");
  assert.equal(d.length, 2);
  assert.match(d[0] ?? "", /« ## Tâche N : <titre> »/);
  assert.match(d[1] ?? "", /public\/index\.html, public\/styles\.css, src\/game\.js : fichiers d'une autre plateforme ; ce projet est un jeu godot[\s\S]*\.gd, \.tscn/);
});

test("plan: an extension the engine declares is not foreign (a web engine, a Python tool script)", () => {
  assert.deepEqual(planDefects("## Tâche 1 : page\n`index.html` `jeu.js`\n", [".html", ".js"], "web"), []);
});

test("plan: the kit proof command (absolute path to cli.ts) is not a game file", () => {
  const plan = String.raw`## Tâche 1 : grille
${"`"}core/games/morpion/grille.gd${"`"}
Preuve : node "C:\Dev\spawn-game-studio\kit\core\src\cli.ts" engine test --filter grille
ou /opt/spawn/kit/core/src/cli.ts, ou \Dev\spawn-game-studio\kit\core\src\cli.ts
Runtime versionné (essai du 19/11, « + » dans le chemin) : node "C:\Users\x\.spawn\runtime\0.1.0+ffd3f6c\kit\core\src\cli.ts" engine test
`;
  assert.deepEqual(planDefects(plan, GODOT, "godot"), []);
  assert.equal(planDefects("## Tâche 1 : x\n`src/game.ts`\n", GODOT, "godot").length, 1, "un chemin relatif du projet compte toujours");
});

// Preuve par exigence, fixée au cadrage. Cas réel : essai Spawn sur Spawn du 18/11 (menu « Jeu » renommé « Projet »).
const MENU_SPEC = [
  EXISTING,
  "## Exigences",
  "",
  "- **SGS-31** Le deuxième menu de la barre s'intitule « Projet ». Preuve : capture.",
  "- **SGS-32** Aucun menu de la barre ne s'intitule « Jeu ». Preuve : **capture** (barre entière).",
  "- **SGS-35** Les commentaires de `src/App.tsx` disent « Projet ». Preuve : aucune.",
].join("\n");

test("spec: every requirement carries a proof from the closed list", () => {
  assert.deepEqual(specRequirements(MENU_SPEC, "SGS"), [
    { id: "SGS-31", proof: "capture" },
    { id: "SGS-32", proof: "capture" },
    { id: "SGS-35", proof: "aucune" },
  ]);
  assert.deepEqual(specDefects(MENU_SPEC, "SGS"), []);
  assert.deepEqual(specDefects(`${EXISTING}- **SGS-01** Le saut. Preuve : bout en bout.\n- **SGS-02** La chute. Preuve : test (contrôle négatif : sans gravité, rouge).\n`, "SGS"), []);
});

// Nuit du 22 au 23/11 : un scatter réécrit dans la démo au lieu d'étendre celui de l'addon terrain. Rien n'obligeait à
// regarder l'existant avant d'écrire, ni ne le donnait à l'implémenteur.
test("spec: the « Existant » section is required, each item names what is extended or what was searched", () => {
  const requirements = "## Exigences\n- **SGS-01** Le saut. Preuve : bout en bout.\n";
  assert.match(specDefects(requirements, "SGS")[0] ?? "", /section « ## Existant » absente[\s\S]*inventaire/);
  assert.match(specDefects(`## Existant\n\nÀ voir.\n${requirements}`, "SGS")[0] ?? "", /« ## Existant » sans élément de liste/);
  const vague = specDefects(`## Existant\n- Le scatter, réutilisé.\n${requirements}`, "SGS");
  assert.match(vague[0] ?? "", /« Le scatter, réutilisé\. » : ni chemin ni « rien d'existant »/);
  assert.deepEqual(specDefects(`## Existant\n- Scatter : addons/planet_terrain/scatter/scatter.gd, étendu.\n${requirements}`, "SGS"), []);
  assert.deepEqual(specDefects(`### Existant\n- Rien d'existant (cherché : core/, addons/).\n${requirements}`, "SGS"), []);
});

test("spec: a section is read up to the next heading of the same level or above", () => {
  assert.equal(specSection(`# Titre\n${EXISTING}\n### Détail\nx\n## Exigences\n- y\n`, "Existant"), `${EXISTING.trim()}\n\n### Détail\nx`);
  assert.equal(specSection("## Exigences\n- y\n", "Existant"), null);
});

test("spec: the 18/11 spec (no proof per requirement) is refused, as are an unknown proof and a spec without requirements", () => {
  const trial = [
    EXISTING,
    "- **SGS-31** Le deuxième menu s'intitule « Projet ». Contrôle négatif : le test qui vérifie ce titre échoue sur le code d'avant.",
    "- **SGS-35** Commentaires. Preuve : capture.",
  ].join("\n");
  const d = specDefects(trial, "SGS");
  assert.equal(d.length, 1);
  assert.match(d[0] ?? "", /^SGS-31 : preuve absente[\s\S]*Preuve : <test \| bout en bout \| capture \| aucune>/);
  assert.match(specDefects("- **SGS-01** X. Preuve : pilote Edge.\n", "SGS")[0] ?? "", /SGS-01 : preuve « pilote edge » inconnue[\s\S]*outillage absent/);
  assert.match(specDefects("Rien à faire.\n", "SGS")[0] ?? "", /aucune exigence lisible/);
});

test("plan: a task that writes a test the approved spec does not plan is refused (the Edge driver of 18/11)", () => {
  const trialPlan = [
    "## Tâche 1 : pilote d'app pour les tests",
    "- Fichiers : `service/test/app-driver.ts` (nouveau), `service/test/app-driver.test.ts` (nouveau).",
    "- Exigences : socle de SGS-31 à SGS-33.",
    "## Tâche 2 : le menu « Jeu » s'intitule « Projet »",
    "- Fichiers : `service/test/menubar.test.ts` (nouveau), `src/App.tsx`.",
    "- Exigences : SGS-35.",
    "- Test d'abord : les titres valent « Fichier, Projet, Affichage, Aide ».",
  ].join("\n");
  const d = planProofDefects(trialPlan, MENU_SPEC, "SGS");
  assert.equal(d.length, 3, d.join("\n"));
  assert.match(d[0] ?? "", /tâche 1 : SGS-33 absente de la spec validée/);
  assert.match(d[1] ?? "", /tâche 1 : elle écrit un test[\s\S]*SGS-31 \(preuve : capture\)/);
  assert.match(d[2] ?? "", /tâche 2 : elle écrit un test[\s\S]*SGS-35 \(preuve : aucune\)/);
});

test("plan: what the spec plans passes (the one-task rename, and a test where the spec asks for one)", () => {
  const rename = [
    "## Tâche 1 : le menu « Jeu » s'intitule « Projet »",
    "- Fichiers : `src/App.tsx`.",
    "- Exigences : SGS-31, SGS-32, SGS-35.",
    '- Preuve : `node "C:\\Users\\x\\.spawn\\runtime\\kit\\core\\src\\cli.ts" engine test`, puis la capture.',
  ].join("\n");
  assert.deepEqual(planProofDefects(rename, MENU_SPEC, "SGS"), []);
  const spec = "- **SGS-01** La chute. Preuve : test.\n- **SGS-02** Le titre. Preuve : capture.\n";
  assert.deepEqual(planProofDefects("## Tâche 1 : chute\n- Exigences : SGS-01, SGS-02.\n- Test d'abord : `core/systems/test_gravite.gd`.\n", spec, "SGS"), []);
  // Contrôle négatif : la même tâche sans l'exigence testée est refusée.
  assert.equal(planProofDefects("## Tâche 1 : chute\n- Exigences : SGS-02.\n- Test d'abord : `core/systems/test_gravite.gd`.\n", spec, "SGS").length, 1);
});

