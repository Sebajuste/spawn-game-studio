# Charge chaque script GDScript du projet en un seul lancement de Godot.
# `load()` renvoie une ressource même quand le script ne compile pas : c'est `can_instantiate()`
# qui distingue un script valide, et le journal qui donne fichier et ligne (`at: GDScript::reload`).
extends SceneTree

func _initialize() -> void:
	var files: Array[String] = []
	_walk("res://", files)
	var failures := 0
	for f in files:
		var script := ResourceLoader.load(f, "", ResourceLoader.CACHE_MODE_IGNORE) as Script
		if script == null or not script.can_instantiate():
			failures += 1
			print("SPAWN-FAILED ", f)
	print("SPAWN-CHECKED ", files.size(), " ", failures)
	quit(0)

func _walk(dir: String, acc: Array[String]) -> void:
	if dir == "res://addons/" or FileAccess.file_exists(dir.path_join(".gdignore")):
		return
	for f in DirAccess.get_files_at(dir):
		if f.get_extension() == "gd":
			acc.append(dir.path_join(f))
	for sub in DirAccess.get_directories_at(dir):
		if not sub.begins_with("."):
			_walk(dir.path_join(sub) + "/", acc)
