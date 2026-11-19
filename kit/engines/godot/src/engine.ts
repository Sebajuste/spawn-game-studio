import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

export interface Run {
  code: number | null;
  output: string;
  timedOut: boolean;
  token: string;
}

export interface RunParams {
  executable: string;
  args: readonly string[];
  userArgs?: readonly string[];
  log: string;
  deadline: number;
  window?: boolean;
  includedToken?: string;
}

// Le jeton, passé après `--`, permet de retrouver un orphelin par sa ligne de commande
// sans jamais viser les autres instances de Godot (éditeurs ouverts) par leur nom d'image.
export function runEngine(p: RunParams): Promise<Run> {
  const token = p.includedToken ?? randomUUID();
  const user = p.userArgs ?? [];
  const args =
    p.includedToken === undefined
      ? [...p.args, "--", ...user, `--spawn-token=${token}`]
      : [...p.args, ...(user.length > 0 ? ["--", ...user] : [])];
  const remaining = Math.max(1, p.deadline - Date.now());

  appendFileSync(p.log, `# spawn: ${p.executable} ${args.map(quote).join(" ")}\n`);

  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let finished = false;

    // Pas de windowsHide quand une vraie fenêtre est attendue : SW_HIDE s'appliquerait à la fenêtre du jeu.
    const child = spawn(p.executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: p.window !== true,
    });

    const receive = (text: string): void => {
      output += text;
      appendFileSync(p.log, text);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, remaining);

    const finish = (code: number | null, message?: string): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (message !== undefined) appendFileSync(p.log, `\n# spawn: ${message}\n`);
      appendFileSync(
        p.log,
        `\n# spawn: code de sortie du moteur : ${code === null ? "aucun" : String(code)}${timedOut ? " (délai dépassé, arbre arrêté)" : ""}\n`,
      );
      resolve({ code, output, timedOut, token });
    };

    child.on("error", (e) => finish(null, `lancement impossible : ${e.message}`));
    child.on("close", (code) => finish(code));
  });
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Le groupe a déjà disparu.
    }
  }
}

function quote(a: string): string {
  return /[\s"]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a;
}
