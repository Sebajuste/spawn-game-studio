// Hook WorktreeCreate : la dernière ligne de stdout est le chemin du worktree ; tout le reste va sur stderr.
import { createWorktree } from "./worktree.ts";
import { fail, readInput } from "./input.ts";

try {
  const input = await readInput<{ cwd: string; name: string }>();
  const path = await createWorktree(input);
  process.stdout.write(path + "\n");
} catch (e) {
  fail(`[spawn] création du worktree refusée : ${(e as Error).message}`);
}
