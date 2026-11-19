// Lancement des scripts npm du projet : sortie complète dans le journal, échéance, arrêt de l'arbre par PID.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Failure } from "./result.ts";

const RELAY = fileURLToPath(new URL("./relay.ts", import.meta.url));

export interface Run {
  code: number | null;
  output: string;
  timedOut: boolean;
}

// Environnement des scripts : sans les variables qu'npm et le lanceur de tests injectent dans l'adaptateur
// quand il tourne lui-même sous `npm test` (un `npm_config_workspace` hérité ferait chercher un espace de travail
// dans le projet ; NODE_TEST_CONTEXT changerait le format de sortie de node --test). Sans __COMPAT_LAYER non plus :
// Windows la pose sur une app lancée depuis l'Explorateur (« DetectorsAppHealth ») et tout son arbre en hérite ; avec
// elle, Edge s'arrête en 100 ms sans rien faire, sans erreur (captures impossibles depuis l'app, essai du 18/11).
export function scriptEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^npm_/i.test(k) || k === "NODE_TEST_CONTEXT" || k.toUpperCase() === "__COMPAT_LAYER") continue;
    env[k] = v;
  }
  return env;
}

export function npmRun(script: string): string {
  return `npm run ${script}`;
}

// npm lancé par Node sans shell. Sous Windows, un cmd.exe détaché (sans console) ne transmet pas les
// redirections à ses enfants : la sortie de l'app n'arriverait jamais dans le journal.
function npmDirect(script: string): { program: string; args: string[] } | null {
  const dir = dirname(process.execPath);
  for (const cli of [join(dir, "node_modules", "npm", "bin", "npm-cli.js"), join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")]) {
    if (existsSync(cli)) return { program: process.execPath, args: [cli, "run", script] };
  }
  return null;
}

export function killTree(pid: number | undefined): void {
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

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface RunParams {
  // Ligne de commande passée au shell (`npm run <script>`, `node --version`) ou programme et arguments.
  command: string | { program: string; args: readonly string[] };
  cwd: string;
  log: string;
  deadline: number;
}

// Lance et attend. Au-delà de l'échéance, l'arbre est arrêté par son PID, jamais par nom d'image.
export function run(p: RunParams): Promise<Run> {
  const shell = typeof p.command === "string";
  const line = typeof p.command === "string" ? p.command : [p.command.program, ...p.command.args].join(" ");
  appendFileSync(p.log, `# spawn: ${line} (dans ${p.cwd})\n`);
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let finished = false;
    const child =
      typeof p.command === "string"
        ? spawn(p.command, { cwd: p.cwd, env: scriptEnv(), shell: true, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true })
        : spawn(p.command.program, [...p.command.args], { cwd: p.cwd, env: scriptEnv(), shell, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
    const receive = (text: string): void => {
      output += text;
      appendFileSync(p.log, text);
    };
    child.stdout?.setEncoding("utf8").on("data", receive);
    child.stderr?.setEncoding("utf8").on("data", receive);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, Math.max(1, p.deadline - Date.now()));
    const finish = (code: number | null, message?: string): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (message !== undefined) appendFileSync(p.log, `\n# spawn: ${message}\n`);
      appendFileSync(p.log, `\n# spawn: code de sortie : ${code === null ? "aucun" : String(code)}${timedOut ? " (délai dépassé, arbre arrêté)" : ""}\n`);
      resolve({ code, output, timedOut });
    };
    child.on("error", (e) => finish(null, `lancement impossible : ${e.message}`));
    child.on("close", (code) => finish(code));
  });
}

export interface Started {
  pid: number;
  url: string;
  child: ChildProcess;
}

const URL_LINE = /^SPAWN-URL (\S+)\s*$/m;

// Protocole de lancement (kit/engine-contract.md §6) : le script déclaré écrit une ligne `SPAWN-URL <url>` sur
// stdout quand l'app est prête. Le processus est détaché, sa sortie va dans le journal, que l'app continue de
// remplir ; l'adaptateur relit le journal jusqu'à cette ligne. Sortie du script ou délai dépassé : échec.
export async function startDetached(script: string, cwd: string, log: string, deadline: number): Promise<Started> {
  appendFileSync(log, `# spawn: ${npmRun(script)} (détaché, dans ${cwd})\n`);
  const offset = readFileSync(log).length;
  const direct = npmDirect(script);
  let child: ChildProcess;
  if (process.platform === "win32") {
    // Par le relais (relay.ts) : lancé détaché directement, npm laissait cmd.exe ouvrir une console visible.
    const spec = direct !== null ? { ...direct, shell: false } : { program: npmRun(script), args: [], shell: true };
    child = spawn(process.execPath, [RELAY, log, cwd, JSON.stringify(spec)], { cwd, env: scriptEnv(), stdio: "ignore", detached: true, windowsHide: true });
  } else {
    const fd = openSync(log, "a");
    try {
      const options = { cwd, env: scriptEnv(), stdio: ["ignore", fd, fd] as ["ignore", number, number], detached: true, windowsHide: true };
      child = direct !== null ? spawn(direct.program, direct.args, options) : spawn(npmRun(script), { ...options, shell: true });
    } finally {
      closeSync(fd);
    }
  }
  const pid = await new Promise<number | undefined>((resolve, reject) => {
    child.once("spawn", () => resolve(child.pid));
    child.once("error", reject);
  }).catch((e: unknown) => {
    throw new Failure("launch-failed", `le script « ${script} » n'a pas pu être lancé : ${e instanceof Error ? e.message : String(e)}`);
  });
  if (pid === undefined) throw new Failure("launch-failed", `le script « ${script} » n'a pas pu être lancé`);
  let exitCode: number | null | undefined;
  child.on("exit", (code) => (exitCode = code));
  child.on("error", () => undefined);

  for (;;) {
    const text = readFileSync(log).subarray(offset).toString("utf8");
    const m = URL_LINE.exec(text);
    if (m?.[1] !== undefined) {
      child.unref();
      return { pid, url: m[1], child };
    }
    if (exitCode !== undefined) {
      appendFileSync(log, `\n# spawn: le script s'est arrêté (code ${String(exitCode)}) sans écrire SPAWN-URL\n`);
      throw new Failure("runtime-error", `le script « ${script} » s'est arrêté (code ${String(exitCode)}) avant d'écrire la ligne SPAWN-URL <url>`);
    }
    if (Date.now() > deadline) {
      killTree(pid);
      appendFileSync(log, "\n# spawn: délai dépassé sans ligne SPAWN-URL, arbre arrêté\n");
      throw new Failure("timeout", `le script « ${script} » n'a pas écrit la ligne SPAWN-URL <url> dans le délai : arrêté par son PID et ses descendants`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}
