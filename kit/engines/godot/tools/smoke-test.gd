# Test de smoke test : lance la scène principale comme le ferait le jeu (instance ajoutée à la racine, scène courante,
# autoloads présents), la laisse tourner N secondes, puis quitte. Arguments utilisateur : <scene> <secondes>.
# Le `--spawn-token=` ajouté par l'adaptateur est filtré. `_initialize` plutôt que `_init` : une erreur dans
# `_init` empêche d'atteindre `quit()`.
# `SPAWN-SMOKE-SCRIPTS n` compte les nœuds de la scène qui portent un script, sous-scènes comprises : à zéro,
# la scène ne contient aucun code et le jeu ne fait rien. `SPAWN-SMOKE-END` prouve que le jeu a tenu jusqu'au bout.
extends SceneTree

func _initialize() -> void:
	var args: Array[String] = []
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--spawn-token="):
			args.append(a)
	if args.size() < 2:
		print("SPAWN-SMOKE-ERROR arguments attendus : scene secondes")
		quit(2)
		return
	var packed := load(args[0]) as PackedScene
	if packed == null:
		print("SPAWN-SMOKE-ERROR scène illisible : ", args[0])
		quit(1)
		return
	var scene := packed.instantiate()
	if scene == null:
		print("SPAWN-SMOKE-ERROR scène non instanciable : ", args[0])
		quit(1)
		return
	root.add_child(scene)
	current_scene = scene
	print("SPAWN-SMOKE-SCRIPTS ", _scripts(scene), " ", _nodes(scene))
	await create_timer(float(args[1])).timeout
	print("SPAWN-SMOKE-END")
	quit(0)

func _scripts(n: Node) -> int:
	var total := 0 if n.get_script() == null else 1
	for child in n.get_children(true):
		total += _scripts(child)
	return total

func _nodes(n: Node) -> int:
	var total := 1
	for child in n.get_children(true):
		total += _nodes(child)
	return total
