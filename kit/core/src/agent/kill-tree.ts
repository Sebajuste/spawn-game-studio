// Arrêt d'un arbre de processus, par PID et ses descendants, jamais par nom d'image.
// Sous Windows `taskkill /T` suit le PID parent, et Git Bash le coupe : un `exec` y crée un nouveau processus et
// l'intermédiaire meurt (constat du 22/11 : suites de tests vivantes après Stop). La table de Git Bash (`ps`) garde, elle,
// le parent et le groupe : ce qui descend d'un processus tué y est retrouvé.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

interface MsysProcess {
  pid: number;
  ppid: number;
  pgid: number;
  winpid: number;
}

const output = (program: string, args: readonly string[]) =>
  new Promise<string>((ok) => {
    // Un échec (processus déjà fini, outil absent) rend ce qui a été lu : l'arrêt continue avec.
    execFile(program, args, { windowsHide: true, timeout: 3000 }, (_error, stdout) => ok(stdout.toString()));
  });

function msysPs(env: NodeJS.ProcessEnv): string | null {
  const paths = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  // git.exe est dans Git/cmd ou Git/mingw64/bin ; ps.exe dans Git/usr/bin.
  const roots = paths.filter((d) => existsSync(join(d, "git.exe"))).flatMap((d) => [resolve(d, ".."), resolve(d, "..", "..")]);
  if (env.ProgramFiles) roots.push(join(env.ProgramFiles, "Git"));
  return roots.map((r) => join(r, "usr", "bin", "ps.exe")).find((p) => existsSync(p)) ?? null;
}

async function table(ps: string | null): Promise<MsysProcess[]> {
  if (ps === null) return [];
  return (await output(ps, [])).split(/\r?\n/).flatMap((line) => {
    // Une lettre d'état (S, I) peut précéder le PID.
    const m = /^\s*(?:[A-Z]\s+)?(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), winpid: Number(m[4]) }] : [];
  });
}

export async function killProcessTree(pid: number, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const ps = msysPs(env);
  const before = await table(ps);
  // Les messages de taskkill sont traduits, pas les PID qu'ils citent : ce sont ceux de l'arbre tué.
  const killed = new Set((await output("taskkill", ["/PID", String(pid), "/T", "/F"])).match(/\d+/g)?.map(Number) ?? []);
  // Il cite aussi le parent de la racine tuée : l'appelant, présent dans la table quand Spawn est lancé depuis Git Bash.
  killed.delete(process.pid);
  const seeds = before.filter((p) => killed.has(p.winpid));
  if (seeds.length === 0) return;
  const family = new Set(seeds.map((p) => p.pid));
  // Seuls les groupes dont le meneur était dans l'arbre tué : jamais le groupe d'un shell qui aurait lancé Spawn.
  const groups = new Set(seeds.filter((p) => p.pid === p.pgid).map((p) => p.pgid));
  let size = 0;
  while (size !== family.size) {
    size = family.size;
    for (const p of before) if (family.has(p.ppid) || groups.has(p.pgid)) family.add(p.pid);
  }
  // Relue après coup : un PID Windows mort peut être repris par un autre programme, et un exec en change.
  const survivors = (await table(ps)).filter((p) => family.has(p.pid) || groups.has(p.pgid));
  await Promise.all(survivors.map((p) => output("taskkill", ["/PID", String(p.winpid), "/T", "/F"])));
}
