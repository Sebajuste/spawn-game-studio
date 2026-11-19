import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExampleData, Scenario } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { UsageError, type Report } from "../result.ts";
import { createProject } from "./new-project.ts";

export const EXAMPLE_SCENE = "res://main.tscn";

// Copie locale : l'adaptateur n'importe rien du cœur à l'exécution. Le `Record` force
// la liste à suivre le type `Scenario` du contrat.
const PRESENT: Record<Scenario, true> = {
  healthy: true,
  "code-error": true,
  "runtime-error": true,
  "failing-test": true,
  "test-not-loaded": true,
  "no-tests": true,
  "invalid-scene": true,
  "no-main-scene": true,
  "empty-main-scene": true,
};
const SCENARIOS = Object.keys(PRESENT);

const SCENE = `[gd_scene format=3]

[ext_resource type="Script" path="res://main.gd" id="1"]

[node name="Main" type="Node2D"]
script = ExtResource("1")

[node name="Background" type="ColorRect" parent="."]
offset_right = 320.0
offset_bottom = 180.0
color = Color(0.2, 0.5, 0.8, 1)
`;

// Mesuré sur Godot 4.7.2 : `load()` accepte une racine qui déclare un parent, seule l'instanciation la refuse.
const INVALID_SCENE = `[gd_scene format=3]

[node name="Level" type="Node2D" parent="."]
`;

// Deux nœuds, aucun script : la scène s'affiche mais le jeu ne fait rien.
const SCENE_WITHOUT_SCRIPT = `[gd_scene format=3]

[node name="Main" type="Node2D"]

[node name="Background" type="ColorRect" parent="."]
offset_right = 320.0
offset_bottom = 180.0
`;

const HEALTHY_SCRIPT = `extends Node2D


func double_it(x: int) -> int:
	return x * 2
`;

// L'identifiant inconnu est signalé exactement à sa ligne (5), contrairement à une erreur
// d'indentation que Godot situe sur la ligne suivante.
const CODE_ERROR_SCRIPT = `extends Node2D


func double_it(x: int) -> int:
	return unknown * x
`;

// Compile, mais `_ready` appelle une méthode sur null : Godot écrit une SCRIPT ERROR et sort en 0.
const RUNTIME_ERROR_SCRIPT = `extends Node2D

var target: Node = null


func _ready() -> void:
	print(target.get_name())


func double_it(x: int) -> int:
	return x * 2
`;

const HEALTHY_TEST = `extends GutTest


func test_double_it() -> void:
	var main = load("res://main.gd").new()
	assert_eq(main.double_it(2), 4)
	main.free()


# Charge la scène principale : un test de bout en bout (data.end_to_end de test).
func test_main_scene() -> void:
	assert_not_null(load("${EXAMPLE_SCENE}"))
`;

const FAILING_TEST = `extends GutTest


func test_failing() -> void:
	assert_eq(1, 2, "échec voulu par le scénario failing-test")
`;

// Erreur de syntaxe : GUT ignore ce fichier en silence et sort en 0 si les autres tests passent.
const BROKEN_TEST = `extends GutTest


func test_broken() -> void
	assert_eq(1, 1)
`;

function scenarioFiles(scenario: Scenario): Record<string, string> {
  const base: Record<string, string> = { "main.tscn": SCENE, "main.gd": HEALTHY_SCRIPT };
  const withTest = { ...base, "test/test_main.gd": HEALTHY_TEST };
  switch (scenario) {
    case "healthy":
      return withTest;
    case "code-error":
      return { ...withTest, "main.gd": CODE_ERROR_SCRIPT };
    case "runtime-error":
      return { ...withTest, "main.gd": RUNTIME_ERROR_SCRIPT };
    case "failing-test":
      return { ...withTest, "test/test_failing.gd": FAILING_TEST };
    case "test-not-loaded":
      return { ...withTest, "test/test_broken.gd": BROKEN_TEST };
    case "no-tests":
      return base;
    case "invalid-scene":
      return { ...withTest, "level.tscn": INVALID_SCENE };
    case "no-main-scene":
      return withTest;
    case "empty-main-scene":
      return { ...withTest, "main.tscn": SCENE_WITHOUT_SCRIPT };
  }
}

function isScenario(s: string): s is Scenario {
  return (SCENARIOS as readonly string[]).includes(s);
}

export async function example(o: Options, r: Report): Promise<void> {
  r.data = { scene: EXAMPLE_SCENE } satisfies ExampleData;
  const scenario = o.required("scenario");
  if (!isScenario(scenario)) {
    throw new UsageError(`scénario inconnu : ${scenario} (attendus : ${SCENARIOS.join(", ")})`);
  }
  const project = o.required("project");
  mkdirSync(project, { recursive: true });
  const mainScene = scenario === "no-main-scene" ? undefined : EXAMPLE_SCENE;
  await createProject(project, `example-${scenario}`, [], mainScene === undefined ? {} : { mainScene });
  for (const [rel, content] of Object.entries(scenarioFiles(scenario))) {
    const path = join(project, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}
