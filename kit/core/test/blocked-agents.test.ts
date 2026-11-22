// Ce qui bloquait les agents le 22/11 : compactage qui réveille un fil en attente, verdict « aucun » lu comme un finding,
// spawn next refusé par la garde anti-boucle, commit signé par l'IA refusé seulement à la fin de la tâche.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { decideGuard } from "../src/guard/analysis.ts";
import { repetition, MAX_REPETITIONS } from "../src/guard/repetitions.ts";
import { compactionInstructions, resumeContext } from "../src/hooks/compaction.ts";
import { createWorktree } from "../src/hooks/worktree.ts";
import { needsChanges } from "../src/next.ts";
import { readStory, updateStory, type Status } from "../src/stories.ts";
import { cleanDirs, spawnProject, tempDir } from "./git-helper.ts";

after(cleanDirs);
const ENGINES = fileURLToPath(new URL("./adapters/", import.meta.url));

test("compaction: a story waiting, to judge or done keeps its status", async () => {
  const root = spawnProject();
  const dir = await createWorktree({ cwd: root, name: "pont" }, { engines: ENGINES, log: () => {} });
  for (const status of ["blocked:decision", "blocked:spec-approval", "in-acceptance", "done"] as Status[]) {
    if (readStory(root, "pont")?.status !== "active") updateStory(root, "pont", { status: "active" });
    updateStory(root, "pont", { status });
    compactionInstructions(dir);
    resumeContext(dir, "compact");
    assert.equal(readStory(root, "pont")?.status, status);
  }
});

test("review verdict: « aucun » under a severity is not a finding; a real finding still is", () => {
  const approved = (findings: string) => needsChanges(`VERDICT : APPROUVÉ\n${findings}`);
  for (const none of ["1. Critique : aucun.\n2. Important : aucun.", "- **Critique** : aucun", "- **Important :** aucune", "1) [Critique] néant.", "1. Critique : aucun finding.", "1. Critique : aucun. 2. Important : aucun. 3. Mineur : nom"]) {
    assert.equal(approved(none), false, none);
  }
  for (const finding of ["3. [Important] aucun contrôle pour MOR-01.", "1. Critique : aucun test ne charge la scène", "1. Important : aucun.\n2. Critique : la scène ne charge pas"]) {
    assert.equal(approved(finding), true, finding);
  }
});

test("repetitions: every way of calling spawn next is allowed, another command still is capped", () => {
  const root = tempDir("repetitions-next");
  for (const command of ["spawn next", "cd x ; spawn next", "cd x && spawn.cmd next", "spawn next 2>&1", '"C:/Users/a/.spawn/bin/spawn" next']) {
    for (let i = 0; i < MAX_REPETITIONS + 2; i++) assert.equal(repetition(root, command, command), null, command);
  }
  for (const command of ["spawn engine test", "echo next", "grep spawn next.ts"]) {
    for (let i = 0; i < MAX_REPETITIONS; i++) repetition(root, command, command);
    assert.notEqual(repetition(root, command, command), null, command);
  }
});

test("guard: a commit signed by an AI is refused before it is made, even without a git hook", () => {
  const root = "C:\\jeux\\demo";
  const decide = (command: string, tool = "Bash") =>
    decideGuard({ tool_name: tool, tool_input: { command }, cwd: root }, { root, allowedList: [], protectedBranches: ["develop"], currentBranch: () => "feature/a", env: {} });
  const signature = "Co-Authored-By: Claude Opus <noreply@anthropic.com>";
  for (const command of [
    `git commit -m "ajout" -m "${signature}"`,
    `git commit -m "$(cat <<'EOF'\najout\n\n${signature}\nEOF\n)"`,
    `cat > m.txt <<'EOF'\najout\n\n${signature}\nEOF\ngit commit -F m.txt`,
    `git commit -m ajout --trailer "${signature}"`,
    `git -C . commit -m "ajout\n\n🤖 Generated with Claude Code"`,
  ]) {
    const v = decide(command);
    assert.equal(v.allowed, false, command);
    assert.match(v.allowed ? "" : v.reason, /attribution IA/);
  }
  assert.equal(decide(`git commit -m @'\najout\n\n${signature}\n'@`, "PowerShell").allowed, false);
  for (const command of [
    'git commit -m "docs: hooks de Claude Code"',
    'git commit -m "ajout" -m "Co-Authored-By: Alice Martin <alice@exemple.fr>"',
    "git log -1 --format=%B | grep -viE 'co-authored-by: claude' > m.txt; git commit --amend -F m.txt",
    `echo "${signature}"`,
    // Vérifier l'absence de signature après son commit n'est pas signer.
    "git commit -q -F m.txt; git log --format=%B | Select-String 'Co-Authored|Claude|Generated with|anthropic'",
    "git commit -q -F m.txt && git log -1 --format=%B | grep -E \"Generated with|anthropic\"",
  ]) {
    assert.equal(decide(command).allowed, true, command);
  }
});
