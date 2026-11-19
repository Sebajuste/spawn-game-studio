import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TestData } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { parseTests } from "../gut.ts";
import { Failure, type Report } from "../result.ts";
import { mainScene, endToEndTests } from "../main-scene.ts";
import { timestamp, Session, checkProject } from "../session.ts";

export async function runTests(o: Options, r: Report): Promise<void> {
  r.data = { total: 0, passed: 0, failed: 0, skipped: 0, end_to_end: [] } satisfies TestData;
  const project = o.required("project");
  checkProject(project);
  if (!existsSync(join(project, "addons", "gut", "gut_cmdln.gd"))) {
    throw new Failure("gut-missing", "GUT n'est pas installé dans addons/gut", "addons/gut");
  }
  const session = new Session("test", o, r, 900, project);
  await session.importProject();

  // GUT refuse les arguments inconnus, même après `--` : le jeton est porté par le nom du rapport.
  const token = randomUUID();
  const junit = join(session.logDir, `junit-${timestamp()}-${token}.xml`);
  const args = ["--headless", "--path", project, "-s", "addons/gut/gut_cmdln.gd", "-gexit", `-gjunit_xml_file=${junit}`];
  if (!existsSync(join(project, ".gutconfig.json"))) args.push("-gdir=res://test", "-ginclude_subdirs");
  const filter = o.text("filter");
  if (filter !== undefined) args.push(`-gselect=${filter}`);

  const l = await session.run(args, { includedToken: token });
  const xml = existsSync(junit) ? readFileSync(junit, "utf8") : null;
  if (xml !== null) r.artifact(junit, "test-report", "junit");

  const summary = parseTests(l.output, xml, l.code, project);
  for (const d of summary.errors) r.errors.push(d);
  r.data.total = summary.total;
  r.data.passed = summary.passed;
  r.data.failed = summary.failed;
  r.data.skipped = summary.skipped;
  r.data.end_to_end = endToEndTests(project, summary.files, mainScene(project));
}
