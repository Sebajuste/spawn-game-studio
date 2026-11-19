// Hook PreCompact : stdout devient la consigne du résumé. Une panne ne doit jamais bloquer le compactage.
import { compactionInstructions } from "./compaction.ts";
import { readInput } from "./input.ts";

try {
  const input = await readInput<{ cwd: string }>();
  const instructions = compactionInstructions(input.cwd);
  if (instructions) process.stdout.write(instructions + "\n");
} catch (e) {
  process.stderr.write(`[spawn] consignes de compactage indisponibles : ${(e as Error).message}\n`);
}
