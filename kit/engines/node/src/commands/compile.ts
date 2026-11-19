// Lance chaque script de vérification déclaré (`node.compile`) et relit leurs erreurs (tsc, eslint, cargo, Node).
// Le verdict vient de la sortie et du code de sortie : un script en échec sans erreur reconnue est signalé tel quel.
import type { CompileData } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { parseErrors } from "../parse.ts";
import { countSourceFiles, nodeConfig, readPackageJson, requireScript, whatToAdd } from "../project.ts";
import { Failure, type Report } from "../result.ts";
import { Session } from "../session.ts";

export async function compile(o: Options, r: Report): Promise<void> {
  r.data = { files_checked: 0, scenes_checked: 0 } satisfies CompileData;
  const project = o.required("project");
  readPackageJson(project);
  const scripts = nodeConfig(project).compile;
  if (scripts === undefined) throw new Failure("not-declared", `commande non déclarée : ${whatToAdd("compile")}`, "spawn.json");
  for (const s of scripts) requireScript(project, s, "node.compile");

  const session = new Session("compile", o, r, 600, project);
  for (const script of scripts) {
    const result = await session.script(script);
    if (result.timedOut) throw new Failure("timeout", `délai dépassé pendant le script « ${script} » : arrêté par son PID et ses descendants`);
    const errors = parseErrors(result.output, session.paths);
    r.errors.push(...errors);
    if (result.code !== 0 && errors.length === 0) {
      r.error("script-failed", `le script « ${script} » a échoué (code ${String(result.code)}) sans erreur reconnue : voir le journal`);
    }
  }
  r.data = { files_checked: countSourceFiles(project), scenes_checked: 0 } satisfies CompileData;
}
