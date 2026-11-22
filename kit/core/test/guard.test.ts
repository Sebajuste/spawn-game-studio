// Table de cas du hook de périmètre. Racine fictive Windows (C:\jeux\demo) quel que soit le
// système : l'analyse choisit la saveur des chemins d'après la racine. Chaque règle a ses formes
// détournées et au moins un cas permis voisin, contrôle négatif contre les faux positifs.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decideGuard, type GuardContext } from "../src/guard/analysis.ts";

const ROOT = "C:\\jeux\\demo";
const WT_A = "C:\\jeux\\demo\\.claude\\worktrees\\a";
const TEMP = "C:\\Users\\agent\\AppData\\Local\\Temp";

const BRANCHES: Record<string, string> = {
  [ROOT]: "develop",
  [WT_A]: "feature/a",
  "C:\\jeux\\demo\\.claude\\worktrees\\m": "main",
  "C:\\jeux\\demo\\.claude\\worktrees\\b": "feature/b",
  "C:\\jeux\\x": "feature/x",
};

function simulatedBranch(dir: string): string | null {
  const d = dir.toLowerCase();
  let found: string | null = null;
  let size = -1;
  for (const [key, branch] of Object.entries(BRANCHES)) {
    const k = key.toLowerCase();
    if ((d === k || d.startsWith(`${k}\\`)) && k.length > size) {
      found = branch;
      size = k.length;
    }
  }
  return found;
}

const CTX: GuardContext = {
  root: ROOT,
  allowedList: [TEMP],
  protectedBranches: ["develop", "main"],
  currentBranch: simulatedBranch,
  env: { USERPROFILE: "C:\\Users\\agent", HOME: "C:\\Users\\agent", TEMP, TMP: TEMP },
};

type Tool = "Bash" | "PowerShell" | "Write" | "Edit" | "MultiEdit" | "NotebookEdit" | "Read";

interface Case {
  tool: Tool;
  input: string;
  expected: "allowed" | "refused";
  cwd?: string;
  // Fragment attendu dans la raison, pour vérifier que c'est la bonne règle qui refuse.
  reason?: string;
}

const allowed = (tool: Tool, input: string, cwd?: string): Case => (cwd === undefined ? { tool, input, expected: "allowed" } : { tool, input, expected: "allowed", cwd });
const refused = (tool: Tool, input: string, reason: string, cwd?: string): Case =>
  cwd === undefined ? { tool, input, expected: "refused", reason } : { tool, input, expected: "refused", reason, cwd };

const OUTSIDE = "hors du projet";
const FORCE = "Push forcé";
const PUSH = "Push sur";
const KILL = "par nom d'image";
const WT = "tu travailles dans le worktree";
const MAIN = "worktree d'un autre fil";
const OTHER = "pas ta branche";
const STASH = "pile de stash";
const WORKTREE = "EnterWorktree";

const TABLE: Record<string, Case[]> = {
  "command substitutions": [
    refused("Bash", 'd=$(echo C:/Windows); echo x > "$d/a"', "non résolu"),
    refused("Bash", 'd="$(echo C:/Windows)"; echo x > "$d/a"', "non résolu"),
    refused("Bash", 'd=`echo C:/Windows`; echo x > "$d/a"', "non résolu"),
    refused("Bash", 'TEMP=$(echo C:/Windows); echo x > "$TEMP/a"', "non résolu"),
    refused("Bash", "echo x > $(echo C:/Windows)/a", "non résolu"),
    refused("Bash", "echo x > `echo C:/Windows`/a", "non résolu"),
    refused("Bash", "cp a.txt $(echo C:/Windows)", "non résolu"),
    refused("Bash", "rm -rf $(echo C:/Windows)", "non résolu"),
    refused("Bash", "x=$(rm -rf C:/autre)", OUTSIDE),
    refused("Bash", 'd=$(mktemp -d); echo x > "$d/../../../../../x"', OUTSIDE),
    refused("PowerShell", "Set-Content $(Join-Path C:\\autre a) x", "non résolu"),
    allowed("Bash", 'd=$(pwd); echo x > "$d/a"'),
    allowed("Bash", "echo x > $(pwd)/a"),
    allowed("Bash", 'd=$(mktemp -d); echo x > "$d/a"'),
    allowed("Bash", 'f=$(mktemp); echo x > "$f"; rm "$f"'),
    // Formes relevées au rejeu de l'historique : le modèle dit où va le dossier.
    allowed("Bash", 'S=docs; d=$(mktemp -d "$S/mut.XXXXXX"); echo x > "$d/a"'),
    allowed("Bash", 'S=docs; d=$(mktemp -d $S/probe.XXXX); echo x > "$d/a"'),
    allowed("Bash", 'd=$(mktemp -d -t spawn-demo-XXXXXX); echo x > "$d/a"'),
    allowed("Bash", 'd=$(mktemp -d -p . guard-XXXX); echo x > "$d/a"'),
    refused("Bash", 'S=C:/Windows; d=$(mktemp -d "$S/x.XXXX"); echo x > "$d/a"', OUTSIDE),
    refused("Bash", 'd=$(mktemp -d -p C:/autre x.XXXX); echo x > "$d/a"', OUTSIDE),
    refused("Bash", 'd=$(mktemp -d -t ../../../../../../x.XXXX); echo x > "$d/a"', OUTSIDE),
    refused("Bash", 'd=$(mktemp -d "$(echo C:/Windows)/x.XXXX"); echo x > "$d/a"', "non résolu"),
    allowed("Bash", "v=$(node --version); echo \"$v\" > version.txt"),
    allowed("Bash", "cat $(ls docs)"),
    allowed("Bash", "i=$((1+2)); echo $i"),
    allowed("Bash", "echo 'a `b` c' > notes.md"),
  ],
  "file tools": [
    allowed("Write", "C:\\jeux\\demo\\src\\a.gd", ROOT),
    allowed("Write", "C:\\jeux\\demo\\.claude\\worktrees\\a\\src\\a.gd"),
    allowed("Write", "src/a.gd"),
    allowed("Edit", "c:/JEUX/DEMO/.Claude/Worktrees/A/Src/A.gd"),
    allowed("Write", `${TEMP}\\brouillon.txt`),
    allowed("NotebookEdit", "C:\\jeux\\demo\\notes\\n.ipynb", ROOT),
    allowed("Read", "C:\\Windows\\system.ini"),
    refused("Write", "..\\..\\..\\..\\x.txt", OUTSIDE),
    refused("Write", "../../../../x.txt", OUTSIDE),
    refused("Edit", "C:\\jeux\\demo-autre\\x.gd", OUTSIDE),
    // Le refus nomme le dossier temporaire permis (essai du 18/11 : un agent a écrit puis voulu nettoyer C:\tmp).
    refused("Write", "C:\\tmp\\diag.png", TEMP),
    refused("Bash", "rm -rf /c/tmp/edge-prof-e", TEMP),
    refused("MultiEdit", "C:\\Users\\agent\\.claude\\settings.json", OUTSIDE),
    refused("NotebookEdit", "D:\\n.ipynb", OUTSIDE),
    refused("Write", "C:\\jeux\\demo\\..\\autre\\x.txt", OUTSIDE),
  ],
  "force push": [
    refused("Bash", "git push --force", FORCE),
    refused("Bash", "git push -f origin feature/a", FORCE),
    refused("Bash", "git push -fu origin feature/a", FORCE),
    refused("Bash", "git push origin +feature/a", FORCE),
    refused("Bash", "git push --force-if-includes origin feature/a", FORCE),
    refused("Bash", "git push --mirror", FORCE),
    refused("Bash", "git -C ../x push -f", FORCE),
    refused("Bash", "cd .claude/worktrees/a && git push --force", FORCE, ROOT),
    refused("PowerShell", 'bash -c "git push -f"', FORCE),
    refused("PowerShell", 'cmd /c "git push --force"', FORCE),
    refused("PowerShell", "Invoke-Expression 'git push -f'", FORCE),
    refused("Bash", "FOO=1 /usr/bin/git push -f", FORCE),
    allowed("Bash", "git push --force-with-lease origin feature/a"),
    allowed("Bash", "git push --force-with-lease=feature/a:abc123 origin feature/a"),
    allowed("Bash", 'git commit -m "retire --force du script" && git push origin feature/a'),
    allowed("Bash", 'echo "git push --force origin develop"'),
    allowed("Bash", "git status # git push --force"),
    allowed("Bash", "git push -o ci.skip origin feature/a"),
  ],
  "push to a protected branch": [
    refused("Bash", "git push origin develop", PUSH),
    refused("Bash", "git push origin HEAD:develop", PUSH),
    refused("Bash", "git push origin x:refs/heads/main", PUSH),
    refused("Bash", "git push origin :develop", PUSH),
    refused("Bash", "git push origin --delete develop", PUSH),
    refused("Bash", "git push -d origin main", PUSH),
    refused("Bash", "git push --force-with-lease origin develop", PUSH),
    refused("Bash", "git push --all", "--all"),
    refused("Bash", "git push", PUSH, ROOT),
    refused("Bash", "git push origin", PUSH, ROOT),
    refused("Bash", "git push -u origin HEAD", PUSH, ROOT),
    refused("PowerShell", 'powershell -Command "git push origin develop"', PUSH),
    refused("PowerShell", "pwsh -NoProfile -c 'git push origin DEVELOP'", PUSH),
    refused("PowerShell", 'iex "git push origin main"', PUSH),
    refused("Bash", "git --no-pager -c core.x=y push origin develop", PUSH),
    refused("Bash", "git checkout develop && git push", PUSH),
    refused("Bash", "git -C C:/jeux/demo push", PUSH),
    refused("Bash", "cd .claude/worktrees/m; git push", PUSH, ROOT),
    allowed("Bash", "git push"),
    allowed("Bash", "git push -u origin feature/a"),
    allowed("Bash", "git push origin --delete feature/a"),
    allowed("Bash", "git push origin --tags", ROOT),
    allowed("Bash", "git push origin feature/develop-ui"),
    allowed("Bash", "cd .claude/worktrees/a && git push", ROOT),
    allowed("Bash", "git -C .claude/worktrees/a push", ROOT),
    allowed("Bash", "git -C .claude -C worktrees/a push", ROOT),
    allowed("PowerShell", "Set-Location .claude\\worktrees\\a; git push", ROOT),
    allowed("Bash", 'git commit -m "fusion vers develop" && git push origin HEAD'),
  ],
  "rewriting a protected branch": [
    refused("Bash", "git reset --hard", "git reset --hard sur develop", ROOT),
    refused("Bash", "git reset --hard origin/develop", "reset", ROOT),
    refused("Bash", "git -C C:/jeux/demo reset --hard", "reset"),
    refused("Bash", "git switch develop && git reset --hard origin/develop", "reset"),
    refused("Bash", "git rebase origin/develop", "rebase", ROOT),
    refused("Bash", "git rebase develop main", "rebase"),
    refused("Bash", "git commit --amend --no-edit", "amend", ROOT),
    refused("Bash", "git filter-branch --tree-filter 'rm x' HEAD", "filter-branch", ROOT),
    refused("Bash", "git filter-branch -- --all", "--all"),
    refused("Bash", "git filter-repo --path x", "filter-repo", ROOT),
    refused("Bash", "git branch -f develop HEAD", "develop"),
    refused("Bash", "git branch -D main", "main"),
    refused("Bash", "git branch -M develop", "develop"),
    refused("Bash", "git branch --delete --force develop", "develop"),
    refused("Bash", "git update-ref refs/heads/develop HEAD", "update-ref"),
    refused("Bash", "git update-ref -d refs/heads/main", "update-ref"),
    refused("Bash", "git checkout -B develop origin/develop", "checkout -B"),
    refused("PowerShell", "git switch -C main", "switch -C"),
    allowed("Bash", "git reset --hard origin/feature/a"),
    allowed("Bash", "git reset --soft HEAD~1", ROOT),
    allowed("Bash", "git rebase origin/develop"),
    allowed("Bash", "git rebase --abort", ROOT),
    allowed("Bash", "git commit --amend --no-edit"),
    allowed("Bash", 'git commit -m "--amend sur develop"', ROOT),
    allowed("Bash", "git filter-repo --path x"),
    allowed("Bash", "git branch -d feature/ancienne"),
    allowed("Bash", "git branch -D feature/a"),
    allowed("Bash", "git branch -f feature/a develop"),
    allowed("Bash", "git branch -d develop"),
    allowed("Bash", "git update-ref refs/heads/feature/a HEAD"),
    allowed("Bash", "git checkout -b feature/b develop"),
    allowed("Bash", "git checkout develop -- src/a.gd"),
    allowed("Bash", "git switch -c feature/b && git reset --hard origin/develop", ROOT),
  ],
  "stopping processes by name": [
    refused("PowerShell", "taskkill /IM godot.exe /F", KILL),
    refused("PowerShell", "taskkill /f /im Godot*", KILL),
    refused("Bash", "taskkill -im godot.exe", KILL),
    refused("Bash", "taskkill //F //IM node.exe >/dev/null 2>&1; echo ok", KILL),
    refused("Bash", 'taskkill //FI "IMAGENAME eq node.exe"', KILL),
    refused("PowerShell", 'taskkill /FI "IMAGENAME eq godot.exe"', KILL),
    refused("PowerShell", "Stop-Process -Name godot", KILL),
    refused("PowerShell", "Stop-Process -ProcessName godot -Force", KILL),
    refused("PowerShell", "spps -n godot", KILL),
    refused("PowerShell", "kill -Name godot", KILL),
    refused("PowerShell", "Get-Process godot | Stop-Process", KILL),
    refused("PowerShell", "Get-Process godot | Stop-Process -Force", KILL),
    refused("PowerShell", "Get-Process -Name godot | Where-Object { $_.Id -ne $PID } | Stop-Process", KILL),
    refused("Bash", 'powershell -Command "Get-Process godot | Stop-Process"', KILL),
    refused("Bash", "pkill godot", KILL),
    refused("Bash", "killall Godot", KILL),
    refused("PowerShell", "wmic process where name='godot.exe' delete", KILL),
    allowed("PowerShell", "taskkill /PID 123 /T /F"),
    allowed("PowerShell", "Stop-Process -Id 1234 -Force"),
    allowed("PowerShell", "Stop-Process 1234"),
    allowed("PowerShell", "Get-Process godot"),
    allowed("Bash", "kill 1234"),
    allowed("Bash", 'echo "taskkill /IM godot.exe"'),
    allowed("PowerShell", "$p = Start-Process godot -PassThru; Stop-Process -Id $p.Id"),
  ],
  "shell writes outside the project": [
    refused("Bash", "echo x > C:\\Users\\agent\\x.txt", OUTSIDE),
    refused("Bash", "echo x >> ../../../../x.log", OUTSIDE),
    refused("Bash", "make 2> C:\\autre\\err.log", OUTSIDE),
    refused("PowerShell", "git status *> C:\\autre\\tout.log", OUTSIDE),
    refused("Bash", "echo x > C:\\jeux\\demo-autre\\x", OUTSIDE),
    refused("Bash", "rm -rf ~/x", OUTSIDE),
    refused("PowerShell", "bash -c 'rm -rf ~/x'", OUTSIDE),
    refused("Bash", "rm -rf $HOME/.cache", OUTSIDE),
    refused("Bash", 'rm -rf "$INCONNUE/x"', "non résolu"),
    refused("Bash", "rm -rf ..\\..\\..\\..\\x", OUTSIDE),
    refused("Bash", "rm -rf /c/Users/agent/x", OUTSIDE),
    refused("PowerShell", "Remove-Item -Recurse -Force C:\\Users\\agent\\x", OUTSIDE),
    refused("PowerShell", "REMOVE-ITEM -RECURSE C:\\USERS\\AGENT\\X", OUTSIDE),
    refused("PowerShell", "ri $env:USERPROFILE\\x -Recurse", OUTSIDE),
    refused("PowerShell", "Remove-Item -Recurse $dossier", "non résolu"),
    refused("PowerShell", 'cmd /c "del %USERPROFILE%\\x.txt"', OUTSIDE),
    refused("PowerShell", 'cmd /c "rd /s /q C:\\autre"', OUTSIDE),
    refused("Bash", "mv build C:\\autre\\", OUTSIDE),
    refused("Bash", "cp a.txt C:\\autre\\", OUTSIDE),
    refused("PowerShell", "Copy-Item a.txt -Destination C:\\autre", OUTSIDE),
    refused("PowerShell", "New-Item -ItemType Directory -Path C:\\autre\\x", OUTSIDE),
    refused("PowerShell", "New-Item -Path C:\\autre -Name x.txt", OUTSIDE),
    refused("PowerShell", "Set-Content -Path C:\\autre\\x.txt -Value 1", OUTSIDE),
    refused("PowerShell", '"x" | Out-File C:\\autre\\x.txt', OUTSIDE),
    refused("Bash", "echo x | tee C:/autre/x", OUTSIDE),
    refused("Bash", "touch ~/x", OUTSIDE),
    refused("Bash", "mkdir -p /c/autre/x", OUTSIDE),
    refused("Bash", "cd C:\\autre && rm -rf build", OUTSIDE),
    refused("PowerShell", "Set-Location C:\\autre; Remove-Item -Recurse x", OUTSIDE),
    refused("Bash", "cat > ~/notes.md <<EOF\nx\nEOF", OUTSIDE),
    refused("PowerShell", "powershell -EncodedCommand ZQBjAGgAbwA=", "EncodedCommand"),
    refused("Bash", "pwsh -enc ZQBjAGgAbwA=", "EncodedCommand"),
    allowed("Bash", "echo x > out.txt"),
    allowed("Bash", "git status > /dev/null 2>&1"),
    allowed("PowerShell", "Get-ChildItem > $null"),
    allowed("PowerShell", "cmd /c \"dir > NUL\""),
    allowed("Bash", "echo x > /tmp/x.txt"),
    allowed("Bash", 'echo x > "$TEMP/x.txt"'),
    allowed("Bash", "rm -rf build"),
    refused("Bash", 'rm "$INCONNUE/x"', "non résolu"),
    allowed("Bash", "rm -rf /c/jeux/demo/.claude/worktrees/a/build"),
    allowed("Bash", `rm -rf ${TEMP.replace(/\\/g, "/")}/spawn-x`),
    allowed("PowerShell", "Remove-Item -Recurse -Force .\\build"),
    allowed("PowerShell", "Remove-Item -Recurse C:\\JEUX\\DEMO\\.CLAUDE\\WORKTREES\\A\\Build"),
    refused("PowerShell", "Remove-Item $fichier", "non résolu"),
    allowed("PowerShell", "$fichier = \"src\\x.gd\"; Remove-Item $fichier"),
    allowed("Bash", "mv a.txt b.txt"),
    allowed("Bash", "cp C:\\autre\\a.txt ."),
    allowed("PowerShell", "Copy-Item C:\\autre\\a.txt -Destination .\\a.txt"),
    allowed("PowerShell", "New-Item -ItemType File -Path src\\x.gd"),
    allowed("PowerShell", 'Set-Content src\\a.txt "C:\\autre"'),
    allowed("PowerShell", '"x" | Add-Content C:\\jeux\\demo\\journal.txt', ROOT),
    allowed("Bash", "mkdir -p build/out"),
    allowed("Bash", "cd C:\\autre; cd C:\\jeux\\demo; rm -rf build", ROOT),
    allowed("PowerShell", "Push-Location C:\\autre; Pop-Location; Remove-Item -Recurse build"),
    allowed("Bash", 'git commit -m "rm -rf ~/x"'),
    allowed("Bash", "cat > notes.md <<'EOF'\ngit push --force origin develop\nrm -rf ~/\nEOF\ngit add notes.md"),
    allowed("Bash", "git commit -m \"$(cat <<'EOF'\nfix: --force sur develop\nEOF\n)\""),
    allowed("PowerShell", "$m = @'\ngit push --force origin develop\n'@\ngit commit -m $m"),
    allowed("PowerShell", "powershell -ExecutionPolicy Bypass -File script.ps1"),
    allowed("Bash", "ls C:\\Users\\agent"),
  ],
  // Zone de l'agent : son worktree (session par défaut dans WT_A) ou, depuis la racine, la racine
  // moins .claude/worktrees/. <racine>/.spawn/ est permis depuis toute zone.
  "agent zone: file tools": [
    refused("Write", "C:\\jeux\\demo\\src\\a.gd", WT),
    refused("Edit", "..\\..\\..\\src\\a.gd", WT),
    refused("Write", "C:/JEUX/DEMO/.claude/worktrees/b/x.gd", WT),
    refused("Edit", "..\\..\\b\\x.gd", WT, `${WT_A}\\src`),
    refused("Write", "C:\\jeux\\demo\\.claude\\worktrees\\a\\x.gd", MAIN, ROOT),
    refused("MultiEdit", ".claude/worktrees/b/x.gd", MAIN, ROOT),
    allowed("Write", "C:\\jeux\\demo\\.spawn\\stories\\x.json"),
    allowed("Write", ".spawn\\stories\\x.json", ROOT),
    allowed("Edit", "a.gd", `${WT_A}\\src`),
    allowed("Write", "C:\\jeux\\demo\\.claude\\settings.json", ROOT),
  ],
  "agent zone: recursive removals": [
    refused("Bash", "rm -rf C:\\jeux\\demo\\build", WT),
    refused("PowerShell", "Remove-Item -Recurse ..\\b", WT),
    refused("PowerShell", "Remove-Item -Recurse -Force ..\\autre-fil", WT),
    refused("Bash", "cd ../../.. && rm -rf src", WT),
    refused("PowerShell", 'cmd /c "rd /s /q C:\\jeux\\demo\\assets"', WT),
    refused("PowerShell", 'cmd /c "del /s C:\\jeux\\demo\\*.tmp"', WT),
    refused("Bash", "rm -rf .claude/worktrees/b", MAIN, ROOT),
    refused("Bash", "rm -r -f /c/jeux/demo/.claude/worktrees/a/src", MAIN, ROOT),
    refused("Bash", "rm C:\\jeux\\demo\\notes.txt", WT),
    allowed("Bash", "rm -rf C:\\jeux\\demo\\.spawn\\stories\\vieux"),
    allowed("Bash", "rm -rf build", ROOT),
    allowed("PowerShell", "Remove-Item -Recurse -Force .\\src\\gen"),
  ],
  "agent zone: destructive git outside the zone": [
    refused("Bash", "cd ..\\..\\.. && git clean -fdx", WT),
    refused("Bash", "git -C C:\\jeux\\demo checkout -- .", WT),
    refused("Bash", "git -C C:/jeux/demo checkout .", WT),
    refused("Bash", "git -C ../b restore src/a.gd", WT),
    refused("Bash", "git -C ../b restore --staged --worktree src/a.gd", WT),
    refused("Bash", "git -C ../b reset --hard", WT),
    refused("Bash", "git -C ../b stash pop", WT),
    refused("PowerShell", "Set-Location C:\\jeux\\demo; git stash drop", WT),
    refused("Bash", "git -C .claude/worktrees/a clean -f", MAIN, ROOT),
    refused("PowerShell", 'powershell -Command "cd .claude\\worktrees\\b; git checkout -- src"', MAIN, ROOT),
    allowed("Bash", "git clean -fdx"),
    allowed("Bash", "git checkout -- ."),
    allowed("Bash", "git reset --hard"),
    allowed("Bash", "git stash pop"),
    allowed("Bash", "git -C ../b restore --staged src/a.gd"),
    allowed("Bash", "git -C ../b status"),
    allowed("Bash", "git -C ../b clean -n"),
    allowed("Bash", "git clean -fd", ROOT),
    refused("Bash", "git -C C:/jeux/demo stash", WT),
    refused("PowerShell", "git -C ..\\b stash push -u", WT),
    refused("Bash", "git -C ../b stash apply", WT),
    allowed("Bash", "git stash"),
    allowed("Bash", "git stash push -m wip"),
    allowed("Bash", "git -C ../b stash list"),
  ],
  "agent zone: --git-dir / --work-tree outside the zone": [
    // Incident : le stash poussé sur la pile partagée avec l'index du checkout principal.
    refused(
      "Bash",
      'git --work-tree="C:/jeux/demo/.claude/worktrees/a/.spawn/worktrees/dd9c4fa" --git-dir="C:/jeux/demo/.git" stash',
      "--git-dir/--work-tree",
    ),
    refused("Bash", 'git --work-tree="C:/jeux/demo/.claude/worktrees/a/.spawn/worktrees/dd9c4fa" --git-dir="C:/jeux/demo/.git" reset --hard HEAD', "refusé"),
    refused("Bash", 'git --work-tree="C:/jeux/demo/.claude/worktrees/a/.spawn/worktrees/dd9c4fa" --git-dir="C:/jeux/demo/.git" stash pop', "refusé"),
    refused("PowerShell", "git --git-dir C:\\jeux\\demo\\.git --work-tree . add -A", "--git-dir/--work-tree"),
    refused("Bash", "git --git-dir=C:/jeux/demo/.git/worktrees/b commit -m x", "--git-dir/--work-tree"),
    refused("Bash", "git --work-tree=../b checkout feature/a", "--git-dir/--work-tree"),
    refused("Bash", "git --git-dir=C:/jeux/demo/.git/worktrees/a commit -m x", "--git-dir/--work-tree", ROOT),
    allowed("Bash", "git --git-dir=C:/jeux/demo/.git log"),
    allowed("PowerShell", "git --git-dir C:\\jeux\\demo\\.git branch --list"),
    allowed("Bash", "git --git-dir=C:/jeux/demo/.git config --get user.name"),
    allowed("Bash", "git --work-tree=src status"),
    allowed("Bash", "git --git-dir=C:/jeux/demo/.git/worktrees/a --work-tree=. commit -m x"),
    allowed("Bash", "git --git-dir=.git --work-tree=. add -A", ROOT),
  ],
  "everywhere: other stories' branches and stash": [
    refused("Bash", "git stash clear", STASH),
    refused("PowerShell", 'bash -c "git stash clear"', STASH),
    refused("Bash", "git branch -D feature/b", OTHER),
    refused("Bash", "git branch -d --force feature/b", OTHER),
    refused("Bash", "git branch --delete --force feature/b", OTHER),
    refused("Bash", "git branch -f feature/b HEAD", OTHER),
    refused("Bash", "git update-ref -d refs/heads/feature/b", OTHER),
    refused("Bash", "git push origin --delete feature/b", OTHER),
    refused("Bash", "git push origin :feature/b", OTHER),
    refused("Bash", "git push -d origin feature/a feature/b", OTHER),
    allowed("Bash", "git branch -d feature/b"),
    allowed("Bash", "git push origin :feature/a"),
    allowed("Bash", "git branch -f feature/a origin/feature/a"),
    allowed("Bash", "git update-ref refs/heads/feature/b HEAD"),
    allowed("Bash", "git branch -M feature/a-v2"),
    allowed("Bash", "git stash list"),
    allowed("Bash", "git stash drop stash@{0}"),
  ],
  // Commandes de l'essai du 19/11 (OpenCode, worktree du fil) qui ont écrit dans le dépôt principal.
  "agent zone: every shell write": [
    refused("PowerShell", 'mkdir -p "C:\\jeux\\demo\\core\\games\\morpion2" 2>&1', WT),
    refused("PowerShell", 'cp "C:\\jeux\\demo\\.claude\\worktrees\\a\\core\\main.tscn" "C:\\jeux\\demo\\core\\main.tscn"', WT),
    refused(
      "PowerShell",
      "$script = @'\n$content = '''extends Node2D\n'''\n$filePath = \"C:\\jeux\\demo\\core\\games\\morpion2\\main.gd\"\nif (-not (Test-Path $filePath)) {\n    New-Item -ItemType File -Path $filePath -Value $content | Out-Null\n} else {\n    Set-Content -Path $filePath -Value $content\n}\n'@\n$script | iex",
      WT,
    ),
    refused("PowerShell", "Get-Content script.ps1 | iex", "Invoke-Expression"),
    refused("PowerShell", "iex $inconnu", "Invoke-Expression"),
    refused("PowerShell", "$p = Join-Path C:\\jeux\\demo x.gd; Set-Content $p 1", "non résolu"),
    refused("PowerShell", "$f = \"C:\\jeux\\demo\\src\\a.gd\"; Set-Content $f 1", WT),
    refused("Bash", "f=/c/jeux/demo/src/a.gd; echo x > $f", WT),
    refused("PowerShell", "New-Item -ItemType Directory C:\\jeux\\demo\\.claude\\worktrees\\b\\x", WT),
    refused("PowerShell", "Copy-Item a.gd C:\\jeux\\demo\\.claude\\worktrees\\a\\a.gd", MAIN, ROOT),
    allowed("PowerShell", "$script = @'\nSet-Content -Path core\\a.gd -Value 1\n'@\n$script | iex"),
    allowed("PowerShell", "'Get-ChildItem' | iex"),
    allowed("PowerShell", "$f = \"C:\\jeux\\demo\\.claude\\worktrees\\a\\a.gd\"; Set-Content $f 1"),
    allowed("PowerShell", "mkdir -p core/games/morpion2"),
    allowed("PowerShell", 'Remove-Item "C:/jeux/demo/.git/worktrees/a/index.lock" -Force'),
    refused("PowerShell", 'Remove-Item "C:/jeux/demo/.git/worktrees/b/index.lock" -Force', WT),
    refused("PowerShell", 'Remove-Item "C:/jeux/demo/.git/index.lock" -Force', WT),
    allowed("PowerShell", "git add -A && git commit -m \"x\""),
    allowed("PowerShell", "Copy-Item C:\\jeux\\demo\\core\\main.tscn core\\main.tscn"),
  ],
  "everywhere: git worktree add / remove": [
    refused("Bash", "git worktree add ../c -b feature/c", WORKTREE),
    refused("PowerShell", "git -C C:\\jeux\\demo worktree remove .claude\\worktrees\\b", WORKTREE),
    refused("Bash", "git worktree add .claude/worktrees/c", WORKTREE, ROOT),
    allowed("Bash", "git worktree list"),
    allowed("Bash", "git worktree prune"),
  ],
};

function input(c: Case) {
  const tool_input: Record<string, unknown> =
    c.tool === "Bash" || c.tool === "PowerShell" ? { command: c.input } : c.tool === "NotebookEdit" ? { notebook_path: c.input } : { file_path: c.input };
  return { tool_name: c.tool, tool_input, cwd: c.cwd ?? WT_A };
}

let total = 0;
for (const [rule, testCase] of Object.entries(TABLE)) {
  describe(rule, () => {
    for (const c of testCase) {
      total++;
      const place = c.cwd === ROOT ? " (from the root, on develop)" : "";
      test(`${c.expected} : [${c.tool}] ${JSON.stringify(c.input)}${place}`, () => {
        const v = decideGuard(input(c), CTX);
        if (c.expected === "allowed") {
          assert.deepEqual(v, { allowed: true });
          return;
        }
        assert.equal(v.allowed, false, "refus attendu");
        if (!v.allowed && c.reason !== undefined) assert.ok(v.reason.includes(c.reason), `raison inattendue : ${v.reason}`);
      });
    }
  });
}

describe("POSIX root", () => {
  const ctx: GuardContext = { ...CTX, root: "/jeux/demo", allowedList: ["/tmp"], env: { HOME: "/home/agent" } };
  const decide = (tool: string, value: string) =>
    decideGuard({ tool_name: tool, tool_input: tool === "Bash" ? { command: value } : { file_path: value }, cwd: "/jeux/demo" }, ctx).allowed;
  test("allowed writes", () => {
    assert.equal(decide("Bash", "rm -rf /jeux/demo/build"), true);
    assert.equal(decide("Bash", "echo x > /tmp/x"), true);
    assert.equal(decide("Write", "src/a.gd"), true);
  });
  test("refused writes, case respected", () => {
    assert.equal(decide("Bash", "rm -rf /jeux/x"), false);
    assert.equal(decide("Bash", "rm -rf ~/x"), false);
    assert.equal(decide("Write", "/jeux/demo/../x"), false);
    assert.equal(decide("Write", "/JEUX/DEMO/a.gd"), false);
  });
});

test("the table covers at least 60 cases", () => {
  assert.ok(total >= 60, `${total} cas`);
});
