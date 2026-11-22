// Résumé de Jest : `Tests:  1 failed, 1 skipped, 3 passed, 5 total`, fichiers `FAIL fichier`, échecs `● suite › test`
// suivis de leur pile (`at … (fichier:ligne:colonne)`).
import type { FailedTest, Paths, TestSummary } from "./parse.ts";

const SUMMARY = /^Tests:\s+(.+?),\s*(\d+) total\s*$/;
const COUNT = /(\d+) (passed|failed|skipped|todo)/g;
const FILE = /^\s*FAIL\s+(\S+)/;
const BULLET = /^ {2}● (.+?)\s*$/;
const AT = /\(?([^\s()]+):(\d+):\d+\)?\s*$/;

export function parseJest(all: readonly string[], paths: Paths): TestSummary | null {
  const s: TestSummary = { suites: 0, total: 0, passed: 0, failed: 0, skipped: 0, failures: [] };
  let file: string | undefined;
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
    const f = FILE.exec(line);
    if (f?.[1]) {
      file = paths.file(f[1]);
      pending = undefined;
      continue;
    }
    const b = BULLET.exec(line);
    // `● Console` regroupe les console.log, pas un échec.
    if (b?.[1] && b[1] !== "Console") {
      pending = { name: b[1] === "Test suite failed to run" && file !== undefined ? `${file} ne se charge pas` : b[1], ...(file !== undefined ? { file } : {}) };
      s.failures.push(pending);
      continue;
    }
    if (pending?.file !== undefined && pending.line === undefined && line.trimStart().startsWith("at ")) {
      const at = AT.exec(line);
      if (at && paths.file(at[1] ?? "") === pending.file) pending.line = Number(at[2]);
    }
  }
  return s.suites > 0 ? s : null;
}
