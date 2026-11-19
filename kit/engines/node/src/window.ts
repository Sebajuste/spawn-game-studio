// Fenêtre du joueur pour `launch` (contrat : « c'est le joueur qui ferme le jeu ») : une app Node n'a pas de fenêtre à
// elle, on lui en ouvre une (Edge en mode application, profil jetable). Ce processus détaché surveille les deux bouts :
// la fenêtre fermée arrête l'app par son PID, arbre compris ; l'app arrêtée (par son PID) ferme la fenêtre.
// Essai du 18/11 : l'app démarrait sans fenêtre, le bouton « Lancer » ne montrait rien.
// Usage : node window.ts <pid de l'app> <profil> <programme> [arguments…]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { isAlive, killTree } from "./process.ts";

const [appPid, profile, program, ...args] = process.argv.slice(2);
const app = Number(appPid);
if (!Number.isInteger(app) || !profile || !program) process.exit(2);

const browser = spawn(program, args, { stdio: "ignore", windowsHide: false });
let done = false;
const finish = () => {
  if (done) return;
  done = true;
  clearInterval(poll);
  killTree(app);
  if (browser.pid !== undefined && browser.exitCode === null) killTree(browser.pid);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  process.exit(0);
};
browser.on("exit", finish);
browser.on("error", finish);
const poll = setInterval(() => {
  if (!isAlive(app)) finish();
}, 1000);
