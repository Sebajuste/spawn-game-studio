// Couche OpenCode (D8) : plugin de périmètre, skills et agents générés depuis les sources du kit, installés dans la
// config OpenCode de l'utilisateur. Le plugin ne fait rien hors d'un projet Spawn ; dans un projet Spawn, il échoue fermé.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { embeddedNode, KIT_CORE } from "./location.ts";

const toSlash = (p: string) => p.split("\\").join("/");

export function opencodeConfigDir(): string {
  return process.env.SPAWN_OPENCODE_CONFIG || join(homedir(), ".config", "opencode");
}

// Mots propres à Claude Code → équivalents OpenCode. L'ordre compte : les phrases avant les mots.
const SUBSTITUTIONS: readonly [RegExp, string][] = [
  [/EnterWorktree avec ce nom/g, "`spawn story create <nom>` (puis la session est relancée dans le worktree du fil par le pilote ou l'app)"],
  [/ExitWorktree en gardant le worktree/g, "fin de la session dans le worktree"],
  [/EnterWorktree/g, "`spawn story create <nom>`"],
  [/ExitWorktree/g, "la fin de la session"],
  [/\s*\(SendMessage\)/g, " (en le relançant avec le brief et les findings)"],
  [/avec Read\b/g, "avec l'outil de lecture de fichiers"],
  [/spawnstudio:([a-z-]+)/g, "spawn-$1"],
];

export const CLAUDE_WORDS = /CLAUDE_PLUGIN_ROOT|EnterWorktree|ExitWorktree|SendMessage|spawnstudio:/;

// Aucun chemin n'est écrit : les commandes des sources sont déjà entières (`spawn next`, la commande des lanceurs du
// runtime), un petit modèle n'a aucun raccourci à traduire (essai de nuit du 18/11 : commandes inventées).
export function adaptText(text: string): string {
  let t = text;
  for (const [pattern, by] of SUBSTITUTIONS) t = t.replace(pattern, by);
  return t;
}

// `name: story` → `name: spawn-story` : les noms d'OpenCode ne sont pas rangés sous le nom du plugin.
function rename(frontmatter: string, prefix: string): string {
  return frontmatter.replace(/^name:\s*(.+)$/m, (_l, name: string) => `name: ${prefix}${name.trim()}`);
}

function splitFrontmatter(text: string): { header: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error("frontmatter absent");
  return { header: m[1] ?? "", body: m[2] ?? "" };
}

export function skillOpencode(source: string): string {
  const { header, body } = splitFrontmatter(source);
  return `---\n${adaptText(rename(header, "spawn-"))}\n---\n${adaptText(body)}`;
}

// Agent OpenCode : sous-agent appelé par l'outil de délégation, avec le modèle de la session (modèle local unique).
export function opencodeAgent(source: string): string {
  const { header, body } = splitFrontmatter(source);
  const description = /^description:\s*(.+)$/m.exec(header)?.[1]?.trim() ?? "";
  return `---\ndescription: ${description}\nmode: subagent\n---\n${adaptText(body)}`;
}

export function pluginOpencode(core = KIT_CORE): string {
  const input = toSlash(join(core, "src", "hooks", "pre-tool-use.ts"));
  // Le plugin tourne dans le runtime d'OpenCode, pas dans Node : le Node du hook est celui de la version, s'il existe.
  const embedded = embeddedNode(core);
  const node = existsSync(embedded) ? toSlash(embedded) : "node";
  return `// Généré par spawn prerequisites --install --agent opencode : ne pas modifier, regénérer.
// Périmètre Spawn pour OpenCode : chaque décision de permission passe par le hook de périmètre du kit
// (même analyse, même journal que sous Claude Code). Hors projet Spawn : rien. Dans un projet Spawn : toute panne refuse.
import { Plugin } from "@opencode/plugin"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"

const ENTRY = ${JSON.stringify(input)}
const NODE = ${JSON.stringify(node)}
// Grammaire des commandes pour le hook : celle du shell qu'OpenCode choisit sans réglage « shell » (son code, v2) :
// $SHELL s'il est défini, sinon PowerShell sous Windows. Lues en Bash, ses commandes PowerShell passaient sans être
// comprises (essai du 19/11 : écritures dans le dépôt principal par $script | iex).
const SHELL = process.env.SHELL ?? ""
const SHELL_NAME = basename(SHELL).toLowerCase().replace(/[.]exe$/, "")
const SHELL_TOOL = SHELL_NAME === "pwsh" || SHELL_NAME === "powershell" || (SHELL === "" && process.platform === "win32") ? "PowerShell" : "Bash"

function isSpawnProject(dir: string): boolean {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, "spawn.json")) && existsSync(join(d, ".git"))) return true
    if (dirname(d) === d) return false
  }
}

type Call = { tool_name: string; tool_input: Record<string, unknown> }

function translate(action: string, resources: readonly string[], dir: string): Call[] {
  if (action === "shell") return resources.map((command) => ({ tool_name: SHELL_TOOL, tool_input: { command } }))
  if (action === "edit") return resources.map((p) => ({ tool_name: "Write", tool_input: { file_path: isAbsolute(p) ? p : resolve(dir, p) } }))
  return []
}

export default Plugin.define({
  id: "spawn-game-studio",
  async setup(ctx) {
    const dir = ctx.location.directory
    if (!isSpawnProject(dir)) return
    await ctx.permission.hook("evaluate", async (e) => {
      const resources = Array.isArray(e.resources) ? e.resources.map(String) : [String(e.resources ?? "")]
      for (const call of translate(String(e.action), resources, dir)) {
        const r = spawnSync(NODE, [ENTRY], {
          input: JSON.stringify({ cwd: dir, session_id: e.sessionID, ...call }),
          encoding: "utf8",
          timeout: 60_000,
        })
        if (r.status !== 0) {
          e.effect = "deny"
          e.message = (r.stderr || "").trim() || "périmètre Spawn indisponible : appel bloqué par prudence"
          return
        }
      }
    })
  },
})
`;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

// Couche générée dans `dir` depuis le kit `core` : celui qui s'exécute, ou une version du runtime (SGS-05).
export function generateOpencode(dir = opencodeConfigDir(), core = KIT_CORE): GeneratedFile[] {
  const files: GeneratedFile[] = [{ path: join(dir, "plugins", "spawn-game-studio", "index.ts"), content: pluginOpencode(core) }];
  const skills = join(core, "skills");
  for (const name of readdirSync(skills)) {
    const source = join(skills, name, "SKILL.md");
    if (existsSync(source)) files.push({ path: join(dir, "skills", `spawn-${name}`, "SKILL.md"), content: skillOpencode(readFileSync(source, "utf8")) });
  }
  const agents = join(core, "agents");
  for (const f of readdirSync(agents).filter((x) => x.endsWith(".md"))) {
    files.push({ path: join(dir, "agents", `spawn-${f}`), content: opencodeAgent(readFileSync(join(agents, f), "utf8")) });
  }
  return files;
}
