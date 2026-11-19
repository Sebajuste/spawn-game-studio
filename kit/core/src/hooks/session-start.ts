// Hook SessionStart : stdout s'ajoute au contexte. Dans un worktree de fil, réinjecte l'état du fil et la fin du ledger.
import { resumeContext } from "./compaction.ts";
import { readInput } from "./input.ts";

try {
  const input = await readInput<{ cwd: string; source?: string }>();
  const text = resumeContext(input.cwd, input.source ?? "startup");
  if (text) process.stdout.write(text + "\n");
} catch (e) {
  process.stderr.write(`[spawn] état du fil indisponible : ${(e as Error).message}\n`);
}
