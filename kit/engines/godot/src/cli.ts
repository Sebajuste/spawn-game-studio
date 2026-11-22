// Adaptateur Godot du contrat kit/engine-contract.md : un seul objet JSON sur stdout,
// sortie 0 si ok, 1 si ok: false, 2 pour un appel invalide. Le diagnostic va sur stderr.
import type { Subcommand } from "../../../core/src/adapter/types.ts";
import { parseOptions, type Options, type Specification } from "./arguments.ts";
import { capture } from "./commands/capture.ts";
import { compile } from "./commands/compile.ts";
import { detect } from "./commands/detect.ts";
import { adopt } from "./commands/adopt.ts";
import { example } from "./commands/example.ts";
import { smokeTest } from "./commands/smoke-test.ts";
import { launchGame } from "./commands/launch.ts";
import { newProject } from "./commands/new-project.ts";
import { prerequisites } from "./commands/prerequisites.ts";
import { readLog, gitPatterns, prepareWorktree, fileTypes } from "./commands/simple.ts";
import { runTests } from "./commands/test.ts";
import { buildResult, Failure, UsageError, Report } from "./result.ts";

interface Command {
  spec: Specification;
  run: (o: Options, r: Report) => Promise<void>;
}

const COMMANDS: Record<Subcommand, Command> = {
  prerequisites: { spec: { required: [], optional: ["project"], paths: ["project"] }, run: prerequisites },
  "new-project": {
    spec: { required: ["project", "name"], optional: ["exclude"], repeatable: ["exclude"], paths: ["project"] },
    run: newProject,
  },
  "prepare-worktree": {
    spec: { required: ["project"], optional: ["source"], paths: ["project", "source"] },
    run: prepareWorktree,
  },
  compile: { spec: { required: ["project"], optional: [], paths: ["project"] }, run: compile },
  test: { spec: { required: ["project"], optional: ["filter"], paths: ["project"] }, run: runTests },
  "smoke-test": { spec: { required: ["project"], optional: ["seconds"], paths: ["project"], integers: ["seconds"] }, run: smokeTest },
  capture: {
    spec: {
      required: ["project", "scene", "output"],
      optional: ["frames", "width", "height"],
      paths: ["project", "output"],
      integers: ["frames", "width", "height"],
    },
    run: capture,
  },
  launch: { spec: { required: ["project"], optional: ["scene"], paths: ["project"] }, run: launchGame },
  "read-log": {
    spec: { required: ["file"], optional: ["project"], paths: ["file", "project"] },
    run: readLog,
  },
  "file-types": { spec: { required: [], optional: [] }, run: fileTypes },
  "git-patterns": { spec: { required: [], optional: [] }, run: gitPatterns },
  example: { spec: { required: ["project", "scenario"], optional: [], paths: ["project"] }, run: example },
  detect: { spec: { required: ["project"], optional: [], paths: ["project"] }, run: detect },
  adopt: {
    spec: { required: ["project"], optional: ["exclude"], flags: ["dry-run"], repeatable: ["exclude"], paths: ["project"] },
    run: adopt,
  },
};

function isSubcommand(name: string): name is Subcommand {
  return Object.hasOwn(COMMANDS, name);
}

async function main(argv: readonly string[]): Promise<number> {
  const start = performance.now();
  const name = argv[0];
  const report = new Report();
  let usage = false;

  try {
    if (name === undefined || !isSubcommand(name)) {
      throw new UsageError(
        name === undefined
          ? `sous-commande manquante (attendues : ${Object.keys(COMMANDS).join(", ")})`
          : `sous-commande inconnue : ${name}`,
      );
    }
    const command = COMMANDS[name];
    await command.run(parseOptions(argv.slice(1), command.spec), report);
  } catch (e) {
    if (e instanceof UsageError) {
      usage = true;
      report.error("usage", e.message);
    } else if (e instanceof Failure) {
      report.error(e.code, e.message, e.file);
    } else {
      process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
      report.error("internal-error", `erreur interne de l'adaptateur : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const result = buildResult(name === undefined || name === "" ? "none" : name, report, start);
  await new Promise<void>((done) => process.stdout.write(`${JSON.stringify(result)}\n`, () => done()));
  if (usage) return 2;
  return result.ok ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
