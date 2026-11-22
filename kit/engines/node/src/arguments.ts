import { isAbsolute } from "node:path";
import { UsageError } from "./result.ts";

export interface Specification {
  required: readonly string[];
  optional: readonly string[];
  repeatable?: readonly string[];
  // Options sans valeur (`--dry-run`) : présentes ou non.
  flags?: readonly string[];
  paths?: readonly string[];
  integers?: readonly string[];
}

// Options acceptées par toutes les sous-commandes. Node et npm sont ceux du PATH, ceux qu'utilisent les scripts du projet.
const COMMON = ["timeout", "logs"] as const;
const COMMON_PATHS = ["logs"] as const;

export class Options {
  private readonly values = new Map<string, string[]>();

  add(name: string, value: string): void {
    const list = this.values.get(name) ?? [];
    list.push(value);
    this.values.set(name, list);
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  text(name: string): string | undefined {
    return this.values.get(name)?.[0];
  }

  required(name: string): string {
    const v = this.text(name);
    if (v === undefined) throw new UsageError(`option --${name} manquante`);
    return v;
  }

  all(name: string): string[] {
    return this.values.get(name) ?? [];
  }

  integer(name: string): number | undefined {
    const v = this.text(name);
    return v === undefined ? undefined : Number(v);
  }
}

export function parseOptions(args: readonly string[], spec: Specification): Options {
  const allowed = new Set<string>([...spec.required, ...spec.optional, ...COMMON]);
  const repeatable = new Set(spec.repeatable ?? []);
  const flags = new Set(spec.flags ?? []);
  const options = new Options();

  for (let i = 0; i < args.length; i++) {
    const raw = args[i] ?? "";
    if (!raw.startsWith("--")) throw new UsageError(`argument inattendu : ${raw}`);
    let name = raw.slice(2);
    let value: string | undefined;
    const equals = name.indexOf("=");
    if (equals >= 0) {
      value = name.slice(equals + 1);
      name = name.slice(0, equals);
    }
    if (!allowed.has(name)) throw new UsageError(`option inconnue : --${name}`);
    if (flags.has(name)) {
      if (value !== undefined) throw new UsageError(`option --${name} sans valeur attendue`);
      value = "";
    } else if (value === undefined) {
      value = args[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`option --${name} sans valeur`);
      i++;
    }
    if (options.has(name) && !repeatable.has(name)) throw new UsageError(`option --${name} répétée`);
    options.add(name, value);
  }

  for (const name of spec.required) {
    if (!options.has(name)) throw new UsageError(`option --${name} manquante`);
  }
  for (const name of [...(spec.paths ?? []), ...COMMON_PATHS]) {
    const v = options.text(name);
    if (v !== undefined && !isAbsolute(v)) throw new UsageError(`--${name} doit être un chemin absolu : ${v}`);
  }
  for (const name of [...(spec.integers ?? []), "timeout"]) {
    const v = options.text(name);
    if (v !== undefined && !/^[1-9][0-9]*$/.test(v)) {
      throw new UsageError(`--${name} attend un entier strictement positif : ${v}`);
    }
  }
  return options;
}
