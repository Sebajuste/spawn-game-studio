// Lance le script de test déclaré (`node.test`) et relit son résumé (lanceur de Node, Vitest ou Jest).
import type { TestData } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { parseErrors, parseTestOutput } from "../parse.ts";
import { declaredScript, matchFiles, nodeConfig } from "../project.ts";
import { Failure, type Report } from "../result.ts";
import { Session } from "../session.ts";

export async function runTests(o: Options, r: Report): Promise<void> {
  r.data = { total: 0, passed: 0, failed: 0, skipped: 0, end_to_end: [] } satisfies TestData;
  const project = o.required("project");
  const config = nodeConfig(project);
  const script = declaredScript(project, config, "test");
  // Le script appartient au projet : l'adaptateur ne sait pas y restreindre les fichiers lancés.
  if (o.has("filter")) r.warn("filter-ignored", "--filter n'est pas pris en charge : le script de test déclaré lance tous ses tests");

  const session = new Session("test", o, r, 900, project);
  const result = await session.script(script);
  if (result.timedOut) throw new Failure("timeout", `délai dépassé pendant le script « ${script} » : arrêté par son PID et ses descendants`);
  const s = parseTestOutput(result.output, session.paths);

  // Bout en bout : les fichiers des motifs déclarés, quand des tests ont tourné.
  const endToEnd = s.total > 0 ? matchFiles(project, config.end_to_end ?? []) : [];
  r.data = { total: s.total, passed: s.passed, failed: s.failed, skipped: s.skipped, end_to_end: endToEnd } satisfies TestData;

  if (s.total === 0) {
    r.error("no-tests", s.suites === 0 ? `le script « ${script} » n'a donné aucun résumé reconnu (lanceur de tests de Node « ℹ tests N », Vitest « Tests  N passed », Jest « Tests: N total »)` : "aucun test lancé");
  }
  for (const f of s.failures) r.error("test-failed", f.name, f.file, f.line);
  if (s.failed > 0 && s.failures.length === 0) r.error("test-failed", `${s.failed} test(s) en échec : voir le journal`);
  if (result.code !== 0 && s.failed === 0) {
    const found = parseErrors(result.output, session.paths);
    if (found.length > 0) r.errors.push(...found);
    else r.error("script-failed", `le script « ${script} » a échoué (code ${String(result.code)}) : voir le journal`);
  }
}
