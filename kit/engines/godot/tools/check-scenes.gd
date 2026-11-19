# Charge et instancie chaque scène et ressource du projet (.tscn, .scn, .tres, .res) en un seul lancement.
# Des scripts verts ne prouvent pas qu'une scène se charge. Mesuré sur Godot 4.7.2 : une racine qui déclare
# `parent="."` se charge (`load()` réussit, `can_instantiate()` vrai) et seule `instantiate()` la refuse ;
# une ressource externe absente se charge aussi, Godot n'écrit qu'une Parse Error. D'où l'instanciation,
# et le marqueur `SPAWN-SCENE` avant chaque fichier : l'adaptateur rattache à ce fichier les erreurs qui suivent.
# L'instance n'entre pas dans l'arbre : seuls les `_init` des scripts tournent, jamais `_ready`.
extends SceneTree

const EXTENSIONS := ["tscn", "scn", "tres", "res"]

func _initialize() -> void:
	var files: Array[String] = []
	_walk("res://", files)
	var failures := 0
	for f in files:
		print("SPAWN-SCENE ", f)
		if not _check(f):
			failures += 1
			print("SPAWN-SCENE-FAILED ", f)
	print("SPAWN-SCENES ", files.size(), " ", failures)
	quit(0)

func _check(f: String) -> bool:
	var resource := ResourceLoader.load(f, "", ResourceLoader.CACHE_MODE_IGNORE)
	if resource == null:
		return false
	var packed := resource as PackedScene
	if packed == null:
		return true
	if not packed.can_instantiate():
		return false
	var instance := packed.instantiate()
	if instance == null:
		return false
	instance.free()
	return true

func _walk(dir: String, acc: Array[String]) -> void:
	if dir == "res://addons/" or FileAccess.file_exists(dir.path_join(".gdignore")):
		return
	for f in DirAccess.get_files_at(dir):
		if f.get_extension().to_lower() in EXTENSIONS:
			acc.append(dir.path_join(f))
	for sub in DirAccess.get_directories_at(dir):
		if not sub.begins_with("."):
			_walk(dir.path_join(sub) + "/", acc)
