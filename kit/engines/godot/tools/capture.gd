# Instancie une scène dans une vraie fenêtre, attend N images rendues et enregistre un PNG.
# Arguments utilisateur : <scene res://> <sortie.png> <images>. Le `--spawn-token=` ajouté par
# l'adaptateur est filtré. `_initialize` plutôt que `_init` : une erreur dans `_init` empêche
# d'atteindre `quit()` et Godot tourne indéfiniment.
extends SceneTree

func _initialize() -> void:
	var args: Array[String] = []
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--spawn-token="):
			args.append(a)
	if args.size() < 3:
		print("SPAWN-CAPTURE-ERROR arguments attendus : scene sortie images")
		quit(2)
		return
	var packed := load(args[0]) as PackedScene
	if packed == null:
		print("SPAWN-CAPTURE-ERROR scène illisible : ", args[0])
		quit(1)
		return
	root.add_child(packed.instantiate())
	for i in int(args[2]):
		await process_frame
	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	var err := image.save_png(args[1])
	print("SPAWN-CAPTURE ", err, " ", image.get_width(), "x", image.get_height())
	quit(0 if err == OK else 1)
