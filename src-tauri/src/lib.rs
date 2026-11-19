// Coque de l'app : la fenêtre, le lancement du service Node (service/src/main.ts) et sa connection. Toute la logique
// vit dans le service ; il s'arrête quand son entrée standard se ferme, donc avec l'app.
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

#[derive(Clone, Serialize, Deserialize)]
struct Connection {
    port: u16,
    token: String,
}

struct ServiceState {
    connection: Mutex<Result<Connection, String>>,
    // Gardé pour que l'entrée standard du service reste ouverte tant que l'app vit.
    _child: Mutex<Option<Child>>,
}

// Service à démarrer : SPAWN_SERVICE s'il est donné ; sinon celui du runtime quand l'app en fait partie
// (`<version>/app/<exe>` à côté de `<version>/service/`) ; sinon celui du dépôt où l'app a été compilée (dev).
fn service_script() -> String {
    if let Ok(script) = std::env::var("SPAWN_SERVICE") {
        return script;
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())) {
        let runtime = dir.join("..").join("service").join("src").join("main.ts");
        if runtime.is_file() {
            return runtime.to_string_lossy().into_owned();
        }
    }
    concat!(env!("CARGO_MANIFEST_DIR"), "/../service/src/main.ts").to_string()
}

// Node qui exécute le service : celui que le runtime embarque (`<version>/node/`, à côté de `<version>/app/`), pour
// que Spawn tourne sans Node installé ; sinon `node` du PATH (app de dev).
fn node() -> std::ffi::OsString {
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())) {
        let embedded = dir.join("..").join("node").join(name);
        if embedded.is_file() {
            return embedded.into_os_string();
        }
    }
    "node".into()
}

fn start_service() -> Result<(Child, Connection), String> {
    let script = service_script();
    let mut command = Command::new(node());
    command
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        // Posée par Windows sur une app lancée depuis l'Explorateur, héritée par le service, les agents et ce qu'ils
        // lancent : Edge s'arrêtait sans rien faire (captures impossibles depuis l'app, essai du 18/11).
        .env_remove("__COMPAT_LAYER");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW : pas de console qui s'ouvre à côté de l'app.
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("service introuvable ({script}) ou Node absent : {e}"))?;
    let output = child.stdout.take().ok_or("sortie du service indisponible")?;
    let mut line = String::new();
    BufReader::new(output)
        .read_line(&mut line)
        .map_err(|e| format!("le service n'a pas répondu : {e}"))?;
    let connection: Connection = serde_json::from_str(line.trim())
        .map_err(|e| format!("première ligne du service illisible ({}) : {e}", line.trim()))?;
    Ok((child, connection))
}

#[tauri::command]
fn service(state: tauri::State<ServiceState>) -> Result<Connection, String> {
    state.connection.lock().map_err(|e| e.to_string())?.clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (child, connection) = match start_service() {
        Ok((e, c)) => (Some(e), Ok(c)),
        Err(e) => (None, Err(e)),
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ServiceState {
            connection: Mutex::new(connection),
            _child: Mutex::new(child),
        })
        .invoke_handler(tauri::generate_handler![service])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
