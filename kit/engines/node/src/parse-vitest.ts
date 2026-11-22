// Résumé de Vitest : `Tests  1 failed | 3 passed | 1 skipped (5)`, échecs `FAIL  fichier > suite > test`
// suivis de leur emplacement `❯ fichier:ligne:colonne`.
import type { FailedTest, Paths, TestSummary } from "./parse.ts";

const SUMMARY = /^\s*Tests\s{2,}(.+?)\s*\((\d+)\)\s*$/;
const COUNT = /(\d+) (passed|failed|skipped|todo)/g;
const FAIL = /^\s*FAIL\s+(\S+?)(?: > (.+?))?(?: \[ .+ \])?\s*$/;
const AT = /^\s*❯ (.+?):(\d+):\d+\s*$/;

export function parseVitest(all: readonly string[], paths: Paths): TestSummary | null {
  const s: TestSummary = { suites: 0, total: 0, passed: 0, failed: 0, skipped: 0, failures: [] };
  let pending: FailedTest | undefined;
  for (const line of all) {
    const m = SUMMARY.exec(line);
    if (m) {
      s.suites++;
      s.total += Number(m[2]);
      for (const [, n, kind] of (m[1] ?? "").matchAll(COUNT)) {
        if (kind === "passed") s.passed += Number(n);
        else if (kind === "failed") s.failed += Number(n);
        else s.skipped += Number(n);
      }
      continue;
    }
    const f = FAIL.exec(line);
    if (f?.[1]) {
      const file = paths.file(f[1]);
      // Sans nom de test : le fichier n'a pas pu se charger.
      pending = { name: f[2] ?? `${f[1]} ne se charge pas`, ...(file !== undefined ? { file } : {}) };
      s.failures.push(pending);
      continue;
    }
    const at = AT.exec(line);
    if (at && pending?.file !== undefined && pending.line === undefined && paths.file(at[1] ?? "") === pending.file) {
      pending.line = Number(at[2]);
    }
  }
  return s.suites > 0 ? s : null;
}
