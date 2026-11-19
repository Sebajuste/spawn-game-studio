import { spawnSync } from "node:child_process";

export interface GitOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export function git(dir: string, args: readonly string[]): GitOutput {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

export function gitOk(dir: string, args: readonly string[]): string {
  const r = git(dir, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} : ${r.stderr || `code ${r.code}`}`);
  return r.stdout;
}

export function currentBranch(dir: string): string | null {
  const r = git(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return r.code === 0 && r.stdout ? r.stdout : null;
}
