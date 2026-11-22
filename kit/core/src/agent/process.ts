// Lancement d'un agent en ligne de commande, sortie dans un fichier, borné dans le temps.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { binDir } from "../location.ts";
import { killProcessTree } from "./kill-tree.ts";

export type Launcher = (program: string, args: readonly string[], o: { cwd: string; output: string; timeoutMs: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal }) => Promise<number | null>;

// Sous Windows, un outil installé par npm est un raccourci `.cmd` que Node ne lance pas sans shell, et un shell
// déformerait le message passé en argument (guillemets, &, %). On lance donc l'exécutable réel : le `.exe` du PATH, ou
// celui que le raccourci npm appelle (`"%dp0%\node_modules\…\x.exe"`). Sinon, le nom tel quel.
export function executable(program: string, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string {
  if (platform !== "win32" || isAbsolute(program) || /[\\/]/.test(program)) return program;
  const paths = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  for (const d of paths) {
    const cmd = join(d, `${program}.cmd`);
    if (!existsSync(cmd)) continue;
    // Copilot : le raccourci lance `npm-loader.js` via node, mais le paquet de la plateforme contient le vrai `.exe`.
    // Un `copilot.exe` posé avant dans le PATH (le relais de VS Code) rappelle ce même `.cmd` et échoue en
    // « UnsupportedWindowsCommandValue » : le `.exe` natif passe donc en premier.
    const loader = /"%dp0%\\([^"]+)[\\/]npm-loader\.js"/i.exec(readFileSync(cmd, "utf8"))?.[1];
    const native = loader && resolve(d, loader, "node_modules", "@github", `copilot-win32-${process.arch}`, "copilot.exe");
    if (native && existsSync(native)) return native;
  }
  for (const d of paths) {
    const exe = join(d, `${program}.exe`);
    if (existsSync(exe)) return exe;
  }
  for (const d of paths) {
    const cmd = join(d, `${program}.cmd`);
    if (!existsSync(cmd)) continue;
    const target = /"%dp0%\\([^"]+\.exe)"/i.exec(readFileSync(cmd, "utf8"))?.[1];
    if (target && existsSync(resolve(d, target))) return resolve(d, target);
  }
  return program;
}

// Le Node qui exécute Spawn passe en tête du PATH de l'agent, et les lanceurs `spawn` avant lui : la commande `spawn`
// des consignes est trouvée, et `node` est le Node embarqué du runtime, même sans Node installé ou trop ancien.
export function withOwnNode(env: NodeJS.ProcessEnv, node = process.execPath): NodeJS.ProcessEnv {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const first = [binDir(), dirname(node)];
  const known = new Set(first.map((d) => resolve(d).toLowerCase()));
  const paths = (env[key] ?? "").split(delimiter).filter(Boolean);
  return { ...env, [key]: [...first, ...paths.filter((p) => !known.has(resolve(p).toLowerCase()))].join(delimiter) };
}

export const runProcess: Launcher = (program, args, o) =>
  new Promise((resolvePath) => {
    const stream = createWriteStream(o.output);
    // PWD suit cwd : OpenCode prend son dossier de travail dans PWD, hérité du parent. Sans cela, il travaillait dans le
    // dossier de l'app et non dans le worktree du fil, où son plugin de périmètre ne voyait aucun projet.
    const env = withOwnNode({ ...(o.env ?? process.env), PWD: o.cwd });
    // Entrée standard fermée : un agent qui la voit ouverte attend d'y lire la suite du message (OpenCode pend).
    const child = spawn(executable(program, env), args, { cwd: o.cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(stream);
    // La sortie d'erreur est gardée à côté (`<sortie>.stderr`) : un agent qui refuse de démarrer n'écrit rien d'autre
    // (essai réel du 18/11 : « --agent 'spawnstudio:implementer' not found », vu seulement comme un code 1).
    let errors = "";
    child.stderr.on("data", (d: Buffer) => {
      if (errors.length < 8000) errors += d.toString("utf8");
    });
    const keepErrors = () => {
      if (errors.trim()) writeFileSync(`${o.output}.stderr`, errors.slice(0, 8000));
    };
    let release: ReturnType<typeof setTimeout> | undefined;
    const killTree = () => {
      // Déjà fini, son PID peut être à un autre : il ne reste que ses sorties à lâcher.
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        if (process.platform === "win32") void killProcessTree(child.pid, env);
        else child.kill("SIGKILL");
      }
      // Un descendant hors d'atteinte garde les sorties ouvertes : Stop rend la main quand même, avant les 5 s que la
      // fermeture du service accorde pour écrire l'état des tours coupés.
      release ??= setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
      }, 4000);
    };
    const timer = setTimeout(killTree, o.timeoutMs);
    if (o.signal?.aborted) killTree();
    o.signal?.addEventListener("abort", killTree, { once: true });
    child.on("error", (e) => {
      clearTimeout(timer);
      errors += `${e.message}\n`;
      keepErrors();
      stream.end(() => resolvePath(null));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(release);
      keepErrors();
      stream.end(() => resolvePath(code));
    });
  });

export const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

// Première valeur d'un champ dans une sortie JSON ligne à ligne (identifiant de session).
export function firstField(output: string, field: string): string | null {
  for (const l of read(output).split(/\r?\n/)) {
    try {
      const v = (JSON.parse(l) as Record<string, unknown>)[field];
      if (typeof v === "string") return v;
    } catch {
      // ligne non JSON
    }
  }
  return null;
}
