// Appel d'un adaptateur de moteur (contrat §1 et §2) et relecture de sa réponse.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { LOCK_ENV, machineLock } from "../machine-lock.ts";
import { NOT_APPLICABLE, type AdapterDescriptor, type AdapterResult, type NotApplicable } from "./types.ts";
import { validateResponse } from "./validate.ts";

export interface Adapter {
  dir: string;
  descriptor: AdapterDescriptor;
}

export type OptionValue = string | readonly string[] | true;

export interface Response {
  subcommand: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  // Défauts relevés par rapport au contrat ; vide si la réponse est conforme.
  defects: string[];
  // Présent seulement si stdout est un objet JSON conforme au schéma.
  result: AdapterResult | null;
  timedOut: boolean;
}

export interface CallOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export const DESCRIPTOR_FILE = "adapter.json";

export function loadAdapter(dir: string): Adapter {
  const raw: unknown = JSON.parse(readFileSync(join(dir, DESCRIPTOR_FILE), "utf8"));
  const d = raw as Partial<AdapterDescriptor>;
  if (d.contract !== 1) throw new Error(`${dir}/${DESCRIPTOR_FILE} : contrat ${String(d.contract)} non pris en charge`);
  if (typeof d.engine !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.engine)) {
    throw new Error(`${dir}/${DESCRIPTOR_FILE} : engine invalide`);
  }
  if (!Array.isArray(d.command) || d.command.length === 0 || !d.command.every((c) => typeof c === "string" && c.length > 0)) {
    throw new Error(`${dir}/${DESCRIPTOR_FILE} : command invalide`);
  }
  const dom = d.domain;
  const domain =
    dom && typeof dom.product === "string" && typeof dom.entry === "string" && typeof dom.user === "string"
      ? { product: dom.product, entry: dom.entry, user: dom.user, ...(typeof dom.framing === "string" ? { framing: dom.framing } : {}) }
      : undefined;
  const notApplicable = d.not_applicable as unknown;
  if (notApplicable !== undefined) {
    if (!Array.isArray(notApplicable) || !notApplicable.every((n) => (NOT_APPLICABLE as readonly unknown[]).includes(n))) {
      throw new Error(`${dir}/${DESCRIPTOR_FILE} : not_applicable doit être une liste parmi ${NOT_APPLICABLE.join(", ")}`);
    }
  }
  return {
    dir: resolve(dir),
    descriptor: {
      contract: 1,
      engine: d.engine,
      ...(typeof d.title === "string" && d.title.trim() !== "" ? { title: d.title } : {}),
      command: d.command,
      ...(domain ? { domain } : {}),
      ...(notApplicable !== undefined ? { not_applicable: [...(notApplicable as NotApplicable[])] } : {}),
    },
  };
}

export function optionArgs(options: Readonly<Record<string, OptionValue>>): string[] {
  const args: string[] = [];
  for (const [name, value] of Object.entries(options)) {
    if (value === true) args.push(`--${name}`);
    else if (typeof value === "string") args.push(`--${name}`, value);
    else for (const v of value) args.push(`--${name}`, v);
  }
  return args;
}

function resolveProgram(adapter: Adapter): { program: string; args: string[] } {
  const [first, ...rest] = adapter.descriptor.command as [string, ...string[]];
  // Un premier élément « node » désigne le Node qui exécute le cœur, quel que soit le PATH.
  const program = first === "node" ? process.execPath : first;
  const args = rest.map((a) => (a.startsWith(".") || a.includes("/") || a.includes("\\")) && !isAbsolute(a) ? join(adapter.dir, a) : a);
  return { program: program.startsWith(".") ? join(adapter.dir, program) : program, args };
}

function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Le groupe a déjà disparu.
    }
  }
}

// Filet contre un adaptateur pendu, pas une limite du moteur : c'est l'adaptateur qui borne le moteur (contrat §2) et
// rend une erreur `timeout` lisible, jusqu'à 900 s par défaut pour une suite. Un filet au même niveau tue l'adaptateur
// avant qu'il réponde (22/11 : suite map-editor saine tuée à 600 s, « adaptateur non conforme »). Il passe donc
// au-dessus de `--timeout` ou de `--seconds` quand ils sont donnés, et largement au-dessus des défauts sinon.
const SAFETY_MS = 30 * 60_000;
const ANSWER_MARGIN_MS = 60_000;

export function adapterTimeoutMs(options: Readonly<Record<string, OptionValue>>): number {
  const seconds = (name: string): number => {
    const v = options[name];
    return typeof v === "string" && /^\d+$/.test(v) ? Number(v) : 0;
  };
  const timeout = seconds("timeout");
  if (timeout > 0) return timeout * 1000 + ANSWER_MARGIN_MS;
  return Math.max(SAFETY_MS, (seconds("seconds") + 120) * 1000 + ANSWER_MARGIN_MS);
}

// Une seule suite de tests à la fois sur la machine (docs/reglages.md §3.2) : `test` attend le verrou avant de partir,
// et son délai ne court qu'une fois parti.
export async function callAdapter(
  adapter: Adapter,
  subcommand: string,
  options: Readonly<Record<string, OptionValue>> = {},
  call: CallOptions = {},
): Promise<Response> {
  if (subcommand !== "test") return run(adapter, subcommand, options, call);
  const release = await machineLock("test", (who) => process.stderr.write(`[spawn] une autre suite de tests tourne sur la machine (${who}) : attente de sa fin
`));
  try {
    return await run(adapter, subcommand, options, { ...call, env: { ...(call.env ?? process.env), [LOCK_ENV]: "1" } });
  } finally {
    release();
  }
}

function run(
  adapter: Adapter,
  subcommand: string,
  options: Readonly<Record<string, OptionValue>>,
  { timeoutMs = adapterTimeoutMs(options), env }: CallOptions,
): Promise<Response> {
  const { program, args } = resolveProgram(adapter);
  const childEnv = { ...(env ?? process.env) };
  // Hérité d'un lanceur node --test, il détournerait la sortie d'un adaptateur écrit en Node.
  delete childEnv.NODE_TEST_CONTEXT;
  // Marqueur de l'enchaîneur (RUNNER_ENV de next.ts), destiné à l'agent : une suite du projet qui en hérite change de
  // comportement selon qui la lance (22/11 : fusion refusée sur runner.test.ts, verte sans la variable).
  delete childEnv.SPAWN_RUNNER;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, [...args, subcommand, ...optionArgs(options)], {
      cwd: adapter.dir,
      env: childEnv,
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (t: string) => (stdout += t));
    child.stderr.setEncoding("utf8").on("data", (t: string) => (stderr += t));
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) killTree(child.pid);
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const { defects, result } = validateResponse({ subcommand, engine: adapter.descriptor.engine, exitCode: code, stdout });
      if (timedOut) defects.unshift(`l'adaptateur n'a pas répondu en ${timeoutMs} ms`);
      resolvePromise({ subcommand, exitCode: code, stdout, stderr, defects, result, timedOut });
    });
  });
}
