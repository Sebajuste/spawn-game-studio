// Lance le script de smoke test déclaré (`node.smoke_test`) : il doit finir en 0 dans le temps imparti.
// `--seconds` est ici une limite (120 par défaut, une construction peut tourner), pas une durée à tenir.
import type { SmokeTestData } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { parseErrors } from "../parse.ts";
import { declaredScript, nodeConfig, readPackageJson } from "../project.ts";
import { Failure, type Report } from "../result.ts";
import { Session } from "../session.ts";

export const DEFAULT_SMOKE_SECONDS = 120;

export async function smokeTest(o: Options, r: Report): Promise<void> {
  const seconds = o.integer("seconds") ?? DEFAULT_SMOKE_SECONDS;
  r.data = { scene: null, seconds } satisfies SmokeTestData;
  const project = o.required("project");
  readPackageJson(project);
  const script = declaredScript(project, nodeConfig(project), "smoke_test", "main-scene-missing");
  r.data = { scene: script, seconds } satisfies SmokeTestData;

  const session = new Session("smoke-test", o, r, seconds, project);
  const result = await session.script(script, Math.min(session.deadline, Date.now() + seconds * 1000));
  if (result.timedOut) {
    throw new Failure("timeout", `le script « ${script} » n'a pas fini en ${seconds} s : arrêté par son PID et ses descendants (journal : ${session.log})`);
  }
  if (result.code !== 0) {
    const found = parseErrors(result.output, session.paths);
    if (found.length > 0) for (const d of found) r.error("runtime-error", d.message, d.file, d.line);
    else r.error("runtime-error", `le script « ${script} » s'est arrêté en erreur (code ${String(result.code)}) : voir le journal`);
  }
}
