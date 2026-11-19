// Hook WorktreeRemove : code non nul et dossier encore présent = suppression refusée.
import { deleteWorktree } from "./worktree.ts";
import { fail, readInput } from "./input.ts";

try {
  deleteWorktree(await readInput<{ cwd: string; worktree_path: string }>());
} catch (e) {
  fail(`[spawn] suppression du worktree refusée : ${(e as Error).message}`);
}
