// Hook de périmètre (docs/kit-perimetre.md D2 et §5) : décide si un appel d'outil reste dans le
// projet et hors de la courte liste d'actions irréversibles. Il vise les erreurs d'un agent pressé,
// pas un attaquant : seules les formes lisibles d'une commande sont analysées.
import { posix, win32, type PlatformPath } from "node:path";
import { aiAttribution } from "../git/attribution.ts";

export interface ToolInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd: string;
}

export interface GuardContext {
  root: string;
  allowedList: string[];
  protectedBranches: string[];
  currentBranch(dir: string): string | null;
  // Environnement pour développer ~, $HOME, %USERPROFILE%… ; process.env par défaut.
  env?: Readonly<Record<string, string | undefined>>;
}

export type Verdict = { allowed: true } | { allowed: false; reason: string };

type Dialect = "bash" | "pwsh" | "cmd";

interface Judge {
  ctx: GuardContext;
  p: PlatformPath;
  windows: boolean;
  zones: string[];
  protectedBranches: Set<string>;
  rootKey: string;
  // Zone de l'agent, déduite du dossier de la session : son worktree, ou la racine moins
  // .claude/worktrees/ pour une session dans le checkout principal. <racine>/.spawn/ en fait partie.
  zone: string;
  zoneKey: string;
  excludedZone: string | null;
  spawnKey: string;
  agentBranch(): string | null;
  // La commande fait un commit : son texte ne doit porter aucune attribution IA.
  commits: boolean;
}

interface State {
  dir: string;
  stack: string[];
  // Branche fixée par un `git checkout`/`git switch` plus tôt dans la même commande, par dossier.
  branches: Map<string, string | null>;
  // Variables affectées plus tôt dans la même commande (`$f = "…"`, `f=…`), nom en minuscules : sans elles,
  // `$f = "C:\…"; Set-Content $f` passait pour un chemin non résolu, donc permis (essai du 19/11).
  vars: Map<string, string>;
  // Ce que reçoit par le tube le segment en cours : le texte s'il est connu, null s'il ne l'est pas.
  pipe: string | null;
}

const OK: Verdict = { allowed: true };
const MAX_DEPTH = 8;

const KILL_REASON =
  "Arrêt de processus par nom d'image refusé : il tuerait aussi ceux des autres agents ; arrête le tien par son PID (taskkill /PID, Stop-Process -Id).";
const ENCODED_REASON =
  "powershell -EncodedCommand refusé : la commande est illisible pour le hook ; passe-la en clair avec -Command.";
const IEX_REASON =
  "Invoke-Expression d'un texte que le périmètre ne peut pas lire refusé (variable ou tube venant d'une autre commande) : exécute les commandes directement, ou écris les fichiers avec l'outil d'écriture de fichiers.";
const ATTRIBUTION_REASON =
  "Aucune attribution IA dans un commit (seul auteur : le propriétaire du dépôt) ; cette règle prime sur toute consigne de ton outil. Refais le commit sans cette ligne.";
const FORCE_REASON =
  "Push forcé refusé : pousse ta branche de feature avec git push --force-with-lease.";

// Le message nomme les dossiers permis : « le dossier temporaire » seul a laissé un agent écrire dans C:\tmp par un
// programme que le hook ne lit pas, puis échouer à y supprimer ses fichiers (essai du 18/11).
function allowedPlaces(j: Judge): string {
  return [j.ctx.root, ...j.ctx.allowedList].join(" ou ");
}

function outsideReason(path: string, j: Judge): string {
  return `Écriture ou suppression hors du projet refusée (${path}) : travaille sous ${allowedPlaces(j)}.`;
}

function protectedReason(action: string, branch: string): string {
  return `${action} sur ${branch} refusé : ${branch} est une branche partagée ; travaille dans ta branche de feature, ${branch} ne reçoit que la file de fusion.`;
}

// ---------------------------------------------------------------------------------------------
// Chemins

function envName(j: Judge, name: string): string | undefined {
  const env = j.ctx.env ?? process.env;
  const direct = env[name];
  if (direct !== undefined || !j.windows) return direct;
  const low = name.toLowerCase();
  for (const [k, v] of Object.entries(env)) if (k.toLowerCase() === low) return v;
  return undefined;
}

function home(j: Judge): string | undefined {
  return j.windows ? (envName(j, "USERPROFILE") ?? envName(j, "HOME")) : envName(j, "HOME");
}

// Les seules substitutions que le hook sait évaluer : le dossier courant, et un fichier temporaire.
// Un modèle de mktemp sans substitution : il dit où va le fichier.
const TEMPLATE = String.raw`(?!-)((?:"[^"()\x60]*"|'[^'$()\x60]*'|\$[\w{]|[^\s"'$()\x60;|&<>])+)`;
const MKTEMP = String.raw`\$\(\s*mktemp(?:\s+-d)?(?:\s+-t\s+${TEMPLATE}|\s+-p\s+${TEMPLATE}\s+${TEMPLATE}|\s+${TEMPLATE})?\s*\)`;
const KNOWN_SUBSTITUTION = new RegExp(String.raw`^(?:\$\(\s*pwd\s*\)|${MKTEMP})`);
const MKTEMP_ANYWHERE = new RegExp(MKTEMP, "g");

function substitute(s: string, dir: string, j: Judge): string {
  const temp = envName(j, "TEMP") ?? envName(j, "TMP") ?? (j.windows ? undefined : "/tmp");
  return s
    .replace(/\$\(\s*(?:pwd|get-location)\s*\)/gi, () => dir)
    .replace(MKTEMP_ANYWHERE, (all, inTemp?: string, parent?: string, name?: string, template?: string) => {
      const bare = (word: string) => word.replace(/["']/g, "");
      if (parent !== undefined && name !== undefined) return `${bare(parent)}/${bare(name)}`;
      if (template !== undefined) return bare(template);
      return temp === undefined ? all : `${temp}/${inTemp === undefined ? "spawn-mktemp" : bare(inTemp)}`;
    });
}

// Rend null si une variable reste non résolue.
function expand(raw: string, dir: string, j: Judge, vars?: ReadonlyMap<string, string>): string | null {
  let missing = false;
  const value = (v: string | undefined): string => {
    if (v === undefined) missing = true;
    return v ?? "";
  };
  let s = raw;
  if (s === "~" || /^~[\\/]/.test(s)) s = value(home(j)) + s.slice(1);
  s = substitute(s, dir, j);
  s = s.replace(/\$\{env:([A-Za-z_][\w()]*)\}|\$env:([A-Za-z_]\w*)/gi, (_m, a?: string, b?: string) => value(envName(j, a ?? b ?? "")));
  s = s.replace(/%([A-Za-z_][\w()]*)%/g, (_m, name: string) => value(envName(j, name)));
  s = s.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (_m, a?: string, b?: string) => {
    const name = a ?? b ?? "";
    const local = vars?.get(name.toLowerCase());
    if (local !== undefined) return local;
    if (name.toUpperCase() === "HOME") return value(home(j));
    if (name.toUpperCase() === "PWD") return dir;
    return value(envName(j, name));
  });
  if (missing || /\$[\w{(]/.test(s)) return null;
  return s;
}

function resolvePath(raw: string, dir: string, j: Judge, d: Dialect, vars?: ReadonlyMap<string, string>): string | null {
  // Accents graves : une substitution, illisible.
  if (d === "bash" && raw.includes("`")) return null;
  let s = expand(raw, dir, j, vars);
  if (s === null) return null;
  if (j.windows && d === "bash") {
    // Chemins de Git Bash : /c/x pour C:\x, /tmp pour le dossier temporaire de Windows.
    const tmp = envName(j, "TEMP") ?? envName(j, "TMP");
    if (tmp !== undefined && /^\/tmp(?=[\\/]|$)/.test(s)) s = tmp + s.slice(4);
    s = s.replace(/^\/([a-zA-Z])(?=[\\/]|$)/, "$1:\\");
  }
  return j.p.resolve(dir, s);
}

function key(j: Judge, path: string): string {
  let k = j.p.resolve(path);
  if (j.windows) k = k.toLowerCase();
  return k.length > 1 && k.endsWith(j.p.sep) && !/^[a-z]:\\$/i.test(k) ? k.slice(0, -1) : k;
}

function subdir(j: Judge, k: string, base: string): boolean {
  return k === base || k.startsWith(base.endsWith(j.p.sep) ? base : base + j.p.sep);
}

function inside(j: Judge, abs: string): boolean {
  const k = key(j, abs);
  return j.zones.some((z) => subdir(j, k, z));
}

// Dans le projet mais hors de la zone de l'agent : le travail d'un autre fil.
function inOtherWorktree(j: Judge, abs: string): boolean {
  const k = key(j, abs);
  if (!subdir(j, k, j.rootKey) || subdir(j, k, j.spawnKey)) return false;
  // Dépôt git propre au worktree de l'agent (son index.lock après un git interrompu, essai du 19/11).
  if (j.excludedZone === null && subdir(j, k, j.p.join(j.rootKey, ".git", "worktrees", j.p.basename(j.zoneKey)))) return false;
  return !subdir(j, k, j.zoneKey) || (j.excludedZone !== null && subdir(j, k, j.excludedZone));
}

// Le même chemin dans la zone de l'agent : un agent refusé sans la bonne adresse a cherché un autre chemin
// d'écriture, par le shell (essai du 19/11, dépôt principal visé à la place du worktree).
function equivalent(j: Judge, abs: string): string | null {
  const parts = j.p.resolve(abs).slice(j.rootKey.length + 1).split(j.p.sep).filter((x) => x !== "");
  const rest = parts[0]?.toLowerCase() === ".claude" && parts[1]?.toLowerCase() === "worktrees" ? parts.slice(3) : parts;
  return rest.length === 0 ? null : j.p.join(j.zone, ...rest);
}

function zoneReason(action: string, path: string, j: Judge): string {
  const target = equivalent(j, path);
  const proposal = target === null ? "" : ` Le même chemin dans ta zone : ${target}`;
  return j.excludedZone === null
    ? `${action} (${path}) : tu travailles dans le worktree ${j.zone} ; reste sous ${j.zone}, le reste du projet appartient à d'autres fils.${proposal}`
    : `${action} (${path}) : c'est le worktree d'un autre fil ; tu travailles dans le checkout principal ${j.zone}, n'y touche pas.${proposal}`;
}

function checkPath(raw: string, state: State, j: Judge, d: Dialect, recursive: boolean): string | null {
  if (raw === "") return null;
  const abs = resolvePath(raw, state.dir, j, d, state.vars);
  if (abs === null) {
    // Un chemin que le hook ne sait pas lire peut viser n'importe où : `$filePath` défini dans un texte passé à
    // iex a écrit dans le dépôt principal (essai du 19/11).
    return recursive
      ? `Suppression récursive d'un chemin non résolu refusée (${raw}) : écris le chemin en clair, sous ta zone ${j.zone}.`
      : `Écriture vers un chemin non résolu refusée (${raw}) : le périmètre ne peut pas savoir où elle va. Écris le chemin en clair, sous ta zone ${j.zone}, ou affecte-le dans la même commande ($f = "…" ou f=…), ou utilise l'outil d'écriture de fichiers.`;
  }
  if (!inside(j, abs)) return outsideReason(abs, j);
  return inOtherWorktree(j, abs) ? zoneReason(recursive ? "Suppression récursive refusée" : "Écriture ou suppression refusée", abs, j) : null;
}

function checkPaths(raws: readonly string[], state: State, j: Judge, d: Dialect, recursive = false): string | null {
  for (const b of raws) {
    const r = checkPath(b, state, j, d, recursive);
    if (r !== null) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Découpage

type Lexeme = { t: "word" | "sep" | "redir"; v: string };

interface Segment {
  words: string[];
  redirs: { op: string; target: string | null }[];
  piped: boolean;
}

const BASH_ESCAPES = " \t'\"\\;&|()<>$`{}#\n";

function lexer(s: string, d: Dialect): Lexeme[] {
  const out: Lexeme[] = [];
  let buf = "";
  let inWord = false;
  let quoted = false;
  const heredocs: { end: string; tabs: boolean }[] = [];
  const finish = () => {
    if (inWord) out.push({ t: "word", v: buf });
    buf = "";
    inWord = false;
    quoted = false;
  };
  const escaped = d === "pwsh" ? "`" : d === "cmd" ? "^" : "\\";
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    const nextChar = s.charAt(i + 1);
    if (c === "\n") {
      finish();
      out.push({ t: "sep", v: "\n" });
      i++;
      for (const h of heredocs.splice(0)) {
        while (i < s.length) {
          let end = s.indexOf("\n", i);
          if (end < 0) end = s.length;
          let line = s.slice(i, end).replace(/\r$/, "");
          if (h.tabs) line = line.replace(/^\t+/, "");
          i = end + 1;
          if (line === h.end) break;
        }
      }
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      finish();
      i++;
      continue;
    }
    if (c === "#" && !inWord && d !== "cmd") {
      const end = s.indexOf("\n", i);
      i = end < 0 ? s.length : end;
      continue;
    }
    if (d === "pwsh" && c === "<" && nextChar === "#") {
      const end = s.indexOf("#>", i + 2);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    if (d === "pwsh" && c === "@" && !inWord && (nextChar === "'" || nextChar === '"') && /^[ \t]*\r?\n/.test(s.slice(i + 2))) {
      const start = s.indexOf("\n", i) + 1;
      const end = s.indexOf(`\n${nextChar}@`, start - 1);
      buf = s.slice(start, end < 0 ? s.length : end).replace(/\r$/, "");
      inWord = true;
      quoted = true;
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    if (c === "'" && d !== "cmd") {
      i++;
      while (i < s.length) {
        const x = s.charAt(i);
        if (x === "'") {
          if (d === "pwsh" && s.charAt(i + 1) === "'") {
            buf += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        buf += x;
        i++;
      }
      inWord = true;
      quoted = true;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < s.length) {
        const x = s.charAt(i);
        const y = s.charAt(i + 1);
        if (x === '"') {
          if (d === "pwsh" && y === '"') {
            buf += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (d === "bash" && x === "\\" && y !== "" && '"\\$`\n'.includes(y)) {
          if (y !== "\n") buf += y;
          i += 2;
          continue;
        }
        if (d === "pwsh" && x === "`" && y !== "") {
          buf += y;
          i += 2;
          continue;
        }
        buf += x;
        i++;
      }
      inWord = true;
      quoted = true;
      continue;
    }
    if (c === escaped && nextChar !== "") {
      if (nextChar === "\n") i += 2;
      else if (nextChar === "\r" && s.charAt(i + 2) === "\n") i += 3;
      else if (d === "bash" && !BASH_ESCAPES.includes(nextChar)) {
        // Hors de ces caractères, la barre garde son sens de séparateur Windows (C:\x).
        buf += c;
        inWord = true;
        i++;
      } else {
        buf += nextChar;
        inWord = true;
        i += 2;
      }
      continue;
    }
    if (c === "&") {
      finish();
      if (nextChar === "&") {
        out.push({ t: "sep", v: "&&" });
        i += 2;
      } else if (nextChar === ">" && d === "bash") {
        i += 2;
        let op = "&>";
        if (s.charAt(i) === ">") {
          op += ">";
          i++;
        }
        out.push({ t: "redir", v: op });
      } else {
        out.push({ t: "sep", v: "&" });
        i++;
      }
      continue;
    }
    if (c === "|") {
      finish();
      const double = nextChar === "|";
      out.push({ t: "sep", v: double ? "||" : "|" });
      i += double ? 2 : 1;
      continue;
    }
    if (c === "$" && d === "bash") {
      const known = KNOWN_SUBSTITUTION.exec(s.slice(i))?.[0];
      if (known !== undefined) {
        buf += known;
        inWord = true;
        i += known.length;
        continue;
      }
    }
    // `$(…)` hors guillemets : le mot reste non résolu (`d=$` passait pour un chemin de la zone, constat du 22/11) et
    // ce qu'elle exécute est analysé comme une commande.
    if (c === "(" && d !== "cmd" && buf.endsWith("$")) buf += c;
    if (c === ";" || c === "(" || c === ")" || ((c === "{" || c === "}") && !inWord && d !== "cmd")) {
      finish();
      out.push({ t: "sep", v: c });
      i++;
      continue;
    }
    if (c === ">") {
      let op = "";
      if (inWord && !quoted && /^(\d|\*)$/.test(buf)) {
        op = buf;
        buf = "";
        inWord = false;
      } else finish();
      op += ">";
      i++;
      if (s.charAt(i) === ">") {
        op += ">";
        i++;
      }
      if (s.charAt(i) === "|") i++;
      if (s.charAt(i) === "&") {
        i++;
        while (i < s.length && /[\d-]/.test(s.charAt(i))) i++;
        continue;
      }
      out.push({ t: "redir", v: op });
      continue;
    }
    if (c === "<") {
      finish();
      if (d === "bash" && nextChar === "<") {
        if (s.charAt(i + 2) === "<") {
          out.push({ t: "redir", v: "<<<" });
          i += 3;
          continue;
        }
        i += 2;
        let tabs = false;
        if (s.charAt(i) === "-") {
          tabs = true;
          i++;
        }
        while (s.charAt(i) === " " || s.charAt(i) === "\t") i++;
        let end = "";
        while (i < s.length && !/[\s;&|<>()]/.test(s.charAt(i))) {
          const x = s.charAt(i);
          if (x !== "'" && x !== '"' && x !== "\\") end += x;
          i++;
        }
        heredocs.push({ end, tabs });
        continue;
      }
      out.push({ t: "redir", v: "<" });
      i++;
      continue;
    }
    buf += c;
    inWord = true;
    i++;
  }
  finish();
  return out;
}

function segment(tokens: Lexeme[]): Segment[] {
  const res: Segment[] = [];
  let cur: Segment = { words: [], redirs: [], piped: false };
  for (let k = 0; k < tokens.length; k++) {
    const l = tokens[k];
    if (l === undefined) continue;
    if (l.t === "word") cur.words.push(l.v);
    else if (l.t === "redir") {
      const n = tokens[k + 1];
      if (n?.t === "word") {
        cur.redirs.push({ op: l.v, target: n.v });
        k++;
      } else cur.redirs.push({ op: l.v, target: null });
    } else if (cur.words.length === 0 && cur.redirs.length === 0) {
      // Un bloc `{ … }` ou un retour à la ligne après `|` ne coupe pas le tube.
      cur.piped ||= l.v === "|";
    } else {
      res.push(cur);
      cur = { words: [], redirs: [], piped: l.v === "|" };
    }
  }
  if (cur.words.length > 0 || cur.redirs.length > 0) res.push(cur);
  return res;
}

// ---------------------------------------------------------------------------------------------
// Lecture des arguments

function commandName(word: string): string {
  const base = word.split(/[\\/]/).pop() ?? word;
  return base.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "");
}

const PREFIXES = new Set(["sudo", "command", "builtin", "exec", "nohup", "time", "nice", "env"]);

function withoutPrefixes(words: string[]): string[] {
  let k = 0;
  while (k < words.length) {
    const m = words[k] ?? "";
    if (/^[A-Za-z_]\w*=/.test(m)) k++;
    else if (PREFIXES.has(commandName(m))) {
      k++;
      while ((words[k] ?? "").startsWith("-")) k++;
    } else break;
  }
  return words.slice(k);
}

interface UnixArgs {
  positionals: string[];
  shortOptions: Map<string, string | true>;
  longOptions: Map<string, string | true>;
}

function readUnix(args: readonly string[], shortWithValue = "", longWithValue: readonly string[] = []): UnixArgs {
  const r: UnixArgs = { positionals: [], shortOptions: new Map(), longOptions: new Map() };
  let endOfOptions = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k] ?? "";
    if (endOfOptions || a === "-" || !a.startsWith("-")) r.positionals.push(a);
    else if (a === "--") endOfOptions = true;
    else if (a.startsWith("--")) {
      const same = a.indexOf("=");
      const name = same < 0 ? a.slice(2) : a.slice(2, same);
      let val: string | true = same < 0 ? true : a.slice(same + 1);
      if (val === true && longWithValue.includes(name) && k + 1 < args.length) val = args[++k] ?? "";
      r.longOptions.set(name, val);
    } else {
      for (let x = 1; x < a.length; x++) {
        const letter = a.charAt(x);
        if (shortWithValue.includes(letter)) {
          const rest = a.slice(x + 1);
          r.shortOptions.set(letter, rest !== "" ? rest : (args[++k] ?? ""));
          break;
        }
        r.shortOptions.set(letter, true);
      }
    }
  }
  return r;
}

interface PsParams {
  positionals: string[];
  values: Map<string, string>;
  switches: Set<string>;
}

// PowerShell accepte tout préfixe non ambigu d'un nom de paramètre ; en cas d'ambiguïté on prend le
// premier de la liste, qui est rangé du plus probable au moins probable.
function readPs(args: readonly string[], takesValue: readonly string[], switches: readonly string[] = []): PsParams {
  const r: PsParams = { positionals: [], values: new Map(), switches: new Set() };
  const everyone = [...takesValue, ...switches];
  for (let k = 0; k < args.length; k++) {
    const a = args[k] ?? "";
    if (!/^-[A-Za-z]/.test(a)) {
      r.positionals.push(a);
      continue;
    }
    const colon = a.indexOf(":");
    const raw = (colon < 0 ? a.slice(1) : a.slice(1, colon)).toLowerCase();
    const name = everyone.includes(raw) ? raw : (everyone.find((t) => t.startsWith(raw)) ?? raw);
    if (takesValue.includes(name)) r.values.set(name, colon < 0 ? (args[++k] ?? "") : a.slice(colon + 1));
    else r.switches.add(name);
  }
  return r;
}

function psList(...values: (string | undefined)[]): string[] {
  return values.flatMap((v) => (v === undefined ? [] : v.split(","))).filter((v) => v !== "");
}

// ---------------------------------------------------------------------------------------------
// Analyse

function analyzeText(text: string, d: Dialect, state: State, j: Judge, depth: number): string | null {
  if (depth > MAX_DEPTH) return null;
  let output: string | null = null;
  for (const seg of segment(lexer(text, d))) {
    state.pipe = seg.piped ? output : null;
    if (assign(seg, d, state, j)) {
      output = null;
      continue;
    }
    const r = analyzeSegment(seg, d, state, j, depth);
    if (r !== null) return r;
    output = emitted(seg, d, state);
  }
  return null;
}

// `$f = <un seul mot>` (PowerShell) ou `f=…` seuls (shell Unix) : la variable est notée pour la suite de la commande.
// Une affectation que le hook ne sait pas évaluer (`$f = Join-Path a b`) oublie la variable : la lire rend un chemin
// non résolu, donc refusé pour une écriture.
function assign(seg: Segment, d: Dialect, state: State, j: Judge): boolean {
  const w = seg.words;
  if (d === "pwsh") {
    const m = /^\$([A-Za-z_]\w*)$/.exec(w[0] ?? "");
    if (m === null || w[1] !== "=" || seg.redirs.length > 0) return false;
    const name = (m[1] ?? "").toLowerCase();
    // Valeur brute : un here-string @'…'@ est littéral, et c'est ce texte qu'un `| iex` exécutera. Les variables
    // qu'elle cite sont développées à la lecture (expand), et restent non résolues si elles sont inconnues.
    if (w.length === 3) state.vars.set(name, w[2] ?? "");
    else state.vars.delete(name);
    return true;
  }
  if (w.length === 0 || seg.redirs.length > 0 || !w.every((x) => /^[A-Za-z_]\w*=/.test(x))) return false;
  for (const x of w) {
    const k = x.indexOf("=");
    const raw = x.slice(k + 1);
    // Les variables d'un modèle se lisent à l'affectation, comme dans le shell.
    const value = raw.includes("$(mktemp") ? (expand(raw, state.dir, j, state.vars) ?? "$(") : substitute(raw, state.dir, j);
    // Illisible, la variable reste non résolue : l'oublier laisserait lire celle de l'environnement du même nom.
    state.vars.set(x.slice(0, k).toLowerCase(), /\$\(|`/.test(value) ? "$(" : value);
  }
  return true;
}

// Ce qu'un segment envoie dans le tube, quand le hook le connaît : un mot seul (`'texte'`, `$script`) en PowerShell.
function emitted(seg: Segment, d: Dialect, state: State): string | null {
  const word = seg.words[0];
  if (d !== "pwsh" || word === undefined || seg.words.length !== 1 || seg.redirs.length > 0) return null;
  const m = /^\$([A-Za-z_]\w*)$/.exec(word);
  if (m !== null) return state.vars.get((m[1] ?? "").toLowerCase()) ?? null;
  return word.startsWith("$") ? null : word;
}

// Un shell enfant (bash -c, powershell -Command) ne voit pas les variables du parent ; iex, si.
function copy(state: State, dir = state.dir, sameScope = false): State {
  return { dir, stack: [...state.stack], branches: new Map(state.branches), vars: sameScope ? new Map(state.vars) : new Map(), pipe: null };
}

const NEUTRAL_TARGETS = new Set(["$null", "nul", "nul:", "con"]);

function analyzeSegment(seg: Segment, d: Dialect, state: State, j: Judge, depth: number): string | null {
  for (const r of seg.redirs) {
    if (r.op === "<" || r.op === "<<<" || r.target === null) continue;
    const target = r.target.toLowerCase();
    if (NEUTRAL_TARGETS.has(target) || target.startsWith("/dev/")) continue;
    const reason = checkPath(r.target, state, j, d, false);
    if (reason !== null) return reason;
  }
  const words = withoutPrefixes(seg.words);
  const first = words[0];
  if (first === undefined) return null;
  const name = commandName(first);
  const args = words.slice(1);

  switch (name) {
    case "cd":
    case "chdir":
    case "set-location":
    case "sl":
    case "pushd":
    case "push-location":
      changeDir(name, args, d, state, j);
      return null;
    case "popd":
    case "pop-location":
      state.dir = state.stack.pop() ?? state.dir;
      return null;
    case "git":
      return analyzeGit(args, d, state, j);
    case "bash":
    case "sh":
    case "zsh":
    case "dash":
      return runBash(args, state, j, depth);
    case "powershell":
    case "pwsh":
      return runPowershell(args, state, j, depth);
    case "cmd": {
      const k = args.findIndex((a) => /^\/[ck]$/i.test(a));
      return k < 0 ? null : analyzeText(args.slice(k + 1).join(" "), "cmd", copy(state), j, depth + 1);
    }
    case "invoke-expression":
    case "iex": {
      // Le texte exécuté vient de l'argument ou du tube (`$script | iex`) ; inconnu, il peut tout faire. Le tube
      // non lu a laissé six écritures dans le dépôt principal (essai du 19/11).
      if (d !== "pwsh") return null;
      const p = readPs(args, ["command"]);
      const given = psList(p.values.get("command")).concat(p.positionals);
      const parts = given.length > 0 ? given.map((x) => (/^\$[A-Za-z_]\w*$/.test(x) ? (state.vars.get(x.slice(1).toLowerCase()) ?? null) : x.includes("$(") ? null : x)) : [seg.piped ? state.pipe : null];
      if (parts.some((x) => x === null)) return IEX_REASON;
      return analyzeText(parts.join(" "), "pwsh", copy(state, state.dir, true), j, depth + 1);
    }
    case "taskkill": {
      // Sous Git Bash, `//IM` évite la conversion de chemin de MSYS : même option (essai du 18/11, service tué).
      const low = args.map((a) => a.toLowerCase().replace(/^\/\//, "/"));
      if (low.some((a) => a === "/im" || a === "-im")) return KILL_REASON;
      if (low.some((a, k) => (a === "/fi" || a === "-fi") && (low[k + 1] ?? "").includes("imagename"))) return KILL_REASON;
      return null;
    }
    case "pkill":
    case "killall":
      return KILL_REASON;
    case "wmic": {
      const text = args.join(" ").toLowerCase();
      return /\bprocess\b/.test(text) && /\bname\b/.test(text) && /\b(delete|terminate)\b/.test(text) ? KILL_REASON : null;
    }
    case "stop-process":
    case "spps":
      return analyzeStopProcess(args, seg.piped);
    case "kill":
      return d === "pwsh" ? analyzeStopProcess(args, seg.piped) : null;
  }
  return d === "pwsh" ? psWrites(name, args, state, j) : d === "cmd" ? cmdWrites(name, args, state, j) : unixWrites(name, args, state, j);
}

function changeDir(name: string, args: string[], d: Dialect, state: State, j: Judge): void {
  let target: string | undefined;
  if (d === "pwsh") {
    const p = readPs(args, ["path", "literalpath", "stackname"], ["passthru"]);
    target = p.values.get("path") ?? p.values.get("literalpath") ?? p.positionals[0];
  } else {
    target = args.find((a) => !a.startsWith("-") && !(d === "cmd" && /^\/d$/i.test(a)));
  }
  if (name === "pushd" || name === "push-location") state.stack.push(state.dir);
  if (target === "-") return;
  const abs = target === undefined ? (home(j) ?? null) : resolvePath(target, state.dir, j, d, state.vars);
  if (abs !== null) state.dir = abs;
}

function runBash(args: string[], state: State, j: Judge, depth: number): string | null {
  for (let k = 0; k < args.length; k++) {
    const a = args[k] ?? "";
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(a)) {
      const text = args[k + 1];
      return text === undefined ? null : analyzeText(text, "bash", copy(state), j, depth + 1);
    }
    if (!a.startsWith("-") && !a.startsWith("+")) return null;
    if (["-o", "-O", "+O", "+o", "--rcfile", "--init-file"].includes(a)) k++;
  }
  return null;
}

const PS_WITH_VALUE = ["executionpolicy", "ep", "ex", "windowstyle", "w", "configurationname", "version", "v", "psconsolefile", "inputformat", "outputformat", "of", "custompipename", "settingsfile"];

function runPowershell(args: string[], state: State, j: Judge, depth: number): string | null {
  let dir = state.dir;
  for (let k = 0; k < args.length; k++) {
    const a = args[k] ?? "";
    if (!/^[-/]/.test(a)) return analyzeText(args.slice(k).join(" "), "pwsh", copy(state, dir), j, depth + 1);
    const n = (a.replace(/^[-/]+/, "").split(":")[0] ?? "").toLowerCase();
    if (n === "e" || n === "ec" || (n.length >= 2 && "encodedcommand".startsWith(n))) return ENCODED_REASON;
    if (n === "c" || (n.length >= 2 && "command".startsWith(n))) {
      const rest = args.slice(k + 1);
      return rest[0] === "-" ? null : analyzeText(rest.join(" "), "pwsh", copy(state, dir), j, depth + 1);
    }
    if (n === "f" || (n.length >= 2 && "file".startsWith(n))) return null;
    if (n === "wd" || (n.length >= 2 && "workingdirectory".startsWith(n))) {
      const abs = resolvePath(args[++k] ?? ".", dir, j, "pwsh");
      if (abs !== null) dir = abs;
    } else if (PS_WITH_VALUE.some((p) => p === n || (n.length >= 3 && p.startsWith(n)))) k++;
  }
  return null;
}

function analyzeStopProcess(args: string[], piped: boolean): string | null {
  const p = readPs(args, ["id", "name", "processname", "inputobject"], ["force", "passthru", "whatif", "confirm"]);
  if (p.values.has("name") || p.values.has("processname") || p.values.has("inputobject")) return KILL_REASON;
  // Sans -Id ni Id positionnel, Stop-Process tue ce que le tube lui passe, en général un Get-Process <nom>.
  if (piped && !p.values.has("id") && p.positionals.length === 0) return KILL_REASON;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Écritures par le shell

function unixWrites(name: string, args: string[], state: State, j: Judge): string | null {
  switch (name) {
    case "rm": {
      const a = readUnix(args);
      const recursive = a.shortOptions.has("r") || a.shortOptions.has("R") || a.longOptions.has("recursive");
      return checkPaths(a.positionals, state, j, "bash", recursive);
    }
    case "rmdir":
    case "tee":
      return checkPaths(readUnix(args).positionals, state, j, "bash");
    case "mkdir":
      return checkPaths(readUnix(args, "m", ["mode"]).positionals, state, j, "bash");
    case "touch":
      return checkPaths(readUnix(args, "dtr", ["date", "reference", "time"]).positionals, state, j, "bash");
    case "mv":
    case "cp": {
      const a = readUnix(args, "tS", ["target-directory", "suffix"]);
      const t = a.shortOptions.get("t") ?? a.longOptions.get("target-directory");
      const targets = typeof t === "string" ? [t] : [];
      if (name === "mv") targets.push(...a.positionals);
      else if (targets.length === 0 && a.positionals.length >= 2) targets.push(a.positionals[a.positionals.length - 1] ?? "");
      return checkPaths(targets, state, j, "bash");
    }
  }
  return null;
}

function cmdWrites(name: string, args: string[], state: State, j: Judge): string | null {
  const paths = args.filter((a) => !a.startsWith("/"));
  const recursive = args.some((a) => /^\/s$/i.test(a));
  switch (name) {
    case "del":
    case "erase":
    case "rd":
    case "rmdir":
      return checkPaths(paths, state, j, "cmd", recursive);
    case "mkdir":
    case "md":
    case "move":
      return checkPaths(paths, state, j, "cmd");
    case "copy":
      return paths.length >= 2 ? checkPaths(paths.slice(-1), state, j, "cmd") : null;
  }
  return null;
}

const PS_REMOVE = new Set(["remove-item", "ri", "rm", "rmdir", "del", "erase", "rd"]);
const PS_MOVE = new Set(["move-item", "mi", "mv", "move"]);
const PS_COPY = new Set(["copy-item", "cpi", "cp", "copy"]);
const PS_NEW = new Set(["new-item", "ni", "mkdir", "md"]);
const PS_CONTENT = new Set(["set-content", "sc", "add-content", "ac"]);
const PS_OUTPUT = new Set(["out-file", "tee-object", "tee"]);

function psWrites(name: string, args: string[], state: State, j: Judge): string | null {
  if (PS_REMOVE.has(name)) {
    const p = readPs(args, ["path", "literalpath", "filter", "include", "exclude", "credential", "stream"], ["recurse", "force", "whatif", "confirm"]);
    const recursive = p.switches.has("recurse") || p.switches.has("rf") || p.switches.has("fr");
    return checkPaths(psList(p.values.get("path"), p.values.get("literalpath"), ...p.positionals), state, j, "pwsh", recursive);
  }
  if (PS_MOVE.has(name) || PS_COPY.has(name)) {
    const p = readPs(args, ["path", "literalpath", "destination", "filter", "include", "exclude", "credential"], ["recurse", "force", "container", "passthru", "whatif", "confirm"]);
    const destination = p.values.get("destination") ?? (p.values.has("path") || p.values.has("literalpath") ? p.positionals[0] : p.positionals[1]);
    const targets = PS_COPY.has(name) ? psList(destination) : psList(p.values.get("path"), p.values.get("literalpath"), destination, ...p.positionals);
    return checkPaths(targets, state, j, "pwsh");
  }
  if (PS_NEW.has(name)) {
    const p = readPs(args, ["path", "name", "itemtype", "value", "target", "credential"], ["force", "whatif", "confirm"]);
    const folders = psList(p.values.get("path") ?? p.positionals[0]);
    const elementName = p.values.get("name");
    const targets = elementName === undefined ? folders : (folders.length > 0 ? folders : ["."]).map((x) => j.p.join(x, elementName));
    return checkPaths(targets, state, j, "pwsh");
  }
  if (PS_CONTENT.has(name) || PS_OUTPUT.has(name)) {
    const p = readPs(args, ["path", "filepath", "literalpath", "value", "encoding", "filter", "include", "exclude", "stream", "width", "inputobject", "variable", "credential"], ["append", "force", "noclobber", "nonewline", "passthru", "whatif", "confirm"]);
    if (p.values.has("variable")) return null;
    const paths = psList(p.values.get("path") ?? p.values.get("filepath") ?? p.values.get("literalpath") ?? p.positionals[0]);
    return checkPaths(paths, state, j, "pwsh");
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// git

// Dépôt git d'un autre fil : son index, son arbre et la pile de stash partagée. Le dépôt propre
// d'un worktree est <racine>/.git/worktrees/<nom> ; <racine>/.git est celui du checkout principal.
function gitDirElsewhere(j: Judge, abs: string): boolean {
  const k = key(j, abs);
  const gitWorktrees = j.p.join(j.rootKey, ".git", "worktrees");
  if (subdir(j, k, gitWorktrees)) {
    return j.excludedZone !== null || !subdir(j, k, j.p.join(gitWorktrees, j.p.basename(j.zoneKey)));
  }
  return inOtherWorktree(j, abs);
}

const GIT_READ = new Set(["status", "log", "diff", "show", "rev-parse", "rev-list", "ls-files", "ls-tree", "cat-file", "describe", "blame", "grep", "shortlog"]);

function gitReadOnly(sub: string | undefined, rest: string[]): boolean {
  if (sub === undefined || GIT_READ.has(sub)) return true;
  if (sub === "stash") return rest[0] === "list" || rest[0] === "show";
  if (sub === "config") return rest.some((a) => ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(a));
  if (sub === "branch") {
    const a = readUnix(rest, "u", ["set-upstream-to", "contains", "no-contains", "merged", "no-merged", "points-at", "sort", "format"]);
    const modified = ["d", "D", "m", "M", "c", "C", "f", "u"].some((l) => a.shortOptions.has(l))
      || ["delete", "move", "copy", "force", "set-upstream-to", "unset-upstream", "edit-description"].some((l) => a.longOptions.has(l));
    return !modified && (a.positionals.length === 0 || a.shortOptions.has("l") || a.longOptions.has("list"));
  }
  return false;
}

function analyzeGit(args: string[], d: Dialect, state: State, j: Judge): string | null {
  let dir = state.dir;
  // Premier --git-dir / --work-tree qui sort de la zone de l'agent.
  let elsewhere: string | null = null;
  let k = 0;
  while (k < args.length) {
    const a = args[k] ?? "";
    const v = args[k + 1];
    if (a === "-C" || a === "--work-tree" || a.startsWith("--work-tree=")) {
      const val = a.startsWith("--work-tree=") ? a.slice(12) : v;
      const abs = val === undefined ? null : resolvePath(val, dir, j, d);
      if (abs !== null) {
        if (a !== "-C" && elsewhere === null && inOtherWorktree(j, abs)) elsewhere = abs;
        dir = abs;
      }
      k += a.includes("=") ? 1 : 2;
    } else if (a === "--git-dir" || a.startsWith("--git-dir=")) {
      const val = a.startsWith("--git-dir=") ? a.slice(10) : v;
      const abs = val === undefined ? null : resolvePath(val, dir, j, d);
      if (abs !== null && elsewhere === null && gitDirElsewhere(j, abs)) elsewhere = abs;
      if (abs !== null && j.p.basename(abs).toLowerCase() === ".git") dir = j.p.dirname(abs);
      k += a.includes("=") ? 1 : 2;
    } else if (["-c", "--namespace", "--config-env", "--attr-source"].includes(a)) k += 2;
    else if (a.startsWith("-")) k++;
    else break;
  }
  const sub = args[k];
  const rest = args.slice(k + 1);
  if (elsewhere !== null && !gitReadOnly(sub, rest)) {
    return `git ${sub ?? ""} avec --git-dir/--work-tree hors de ta zone refusé (${elsewhere}) : l'index, l'arbre et la pile de stash visés sont ceux d'un autre fil ; travaille avec git tout court depuis ton worktree ${j.zone}, sans --git-dir ni --work-tree.`;
  }
  const dirKey = key(j, dir);
  const branch = (): string | null => (state.branches.has(dirKey) ? (state.branches.get(dirKey) ?? null) : j.ctx.currentBranch(dir));
  const protectedBranch = (ref: string | null): ref is string => ref !== null && j.protectedBranches.has(ref.replace(/^refs\/heads\//, "").toLowerCase());
  const onProtected = (action: string): string | null => {
    const b = branch();
    return protectedBranch(b) ? protectedReason(action, b) : null;
  };
  const other = (ref: string): boolean => ref.replace(/^refs\/heads\//, "") !== j.agentBranch();

  if (inOtherWorktree(j, dir)) {
    const action = gitDestructive(sub, rest);
    if (action !== null) return zoneReason(`${action} refusé`, dir, j);
  }

  switch (sub) {
    case "push":
      return analyzePush(rest, branch, protectedBranch, other);
    case "stash":
      return rest[0] === "clear"
        ? "git stash clear refusé : la pile de stash est commune à tous les worktrees ; retire seulement tes entrées avec git stash drop <n>."
        : null;
    case "worktree":
      return rest[0] === "add" || rest[0] === "remove"
        ? `git worktree ${rest[0]} refusé : crée ou quitte un worktree par l'outil de worktree de Claude Code (EnterWorktree / ExitWorktree) ; le hook du kit fait l'import et l'état du fil.`
        : null;
    case "reset":
      return rest.includes("--hard") ? onProtected("git reset --hard") : null;
    case "rebase": {
      if (rest.some((a) => ["--abort", "--continue", "--skip", "--quit", "--edit-todo", "--show-current-patch"].includes(a))) return null;
      const a = readUnix(rest, "sXx", ["onto", "strategy", "strategy-option", "exec"]);
      const target = a.positionals.length >= 2 ? (a.positionals[1] ?? null) : branch();
      return protectedBranch(target) ? protectedReason("git rebase", target) : null;
    }
    case "commit": {
      j.commits = true;
      const a = readUnix(rest, "mFCct", ["message", "file", "reuse-message", "reedit-message", "template", "author", "date", "fixup", "squash", "trailer", "cleanup"]);
      return a.longOptions.has("amend") ? onProtected("git commit --amend") : null;
    }
    case "filter-branch":
    case "filter-repo": {
      if (rest.includes("--all")) {
        return `git ${sub} --all refusé : il réécrirait aussi les branches partagées ; limite-le à ta branche de feature.`;
      }
      return onProtected(`git ${sub}`);
    }
    case "branch": {
      const a = readUnix(rest, "u", ["set-upstream-to", "contains", "no-contains", "merged", "no-merged", "points-at", "sort", "format"]);
      const c = (l: string) => a.shortOptions.has(l);
      const force = c("f") || a.longOptions.has("force");
      const removal = c("D") || ((c("d") || a.longOptions.has("delete")) && force);
      const renaming = c("M") || c("C") || ((c("m") || c("c") || a.longOptions.has("move") || a.longOptions.has("copy")) && force);
      const targets = removal || renaming ? a.positionals : force ? a.positionals.slice(0, 1) : [];
      const touched = targets.find((x) => protectedBranch(x));
      if (touched !== undefined) return protectedReason("git branch forcé", touched);
      // -M/-C renomment ou copient : la branche nommée peut être la nouvelle, on ne la juge pas.
      const forcedList = removal ? a.positionals : force && !renaming ? a.positionals.slice(0, 1) : [];
      const foreign = forcedList.find(other);
      return foreign === undefined ? null : otherBranchReason("git branch forcé", foreign, j);
    }
    case "update-ref": {
      const a = readUnix(rest, "m");
      const ref = a.positionals[0] ?? "";
      if (!ref.startsWith("refs/heads/")) return null;
      const refName = ref.slice(11);
      if (protectedBranch(ref)) return protectedReason("git update-ref", refName);
      return (a.shortOptions.has("d") || a.longOptions.has("delete")) && other(ref) ? otherBranchReason("git update-ref -d", refName, j) : null;
    }
    case "checkout":
    case "switch": {
      const strong = sub === "checkout" ? "B" : "C";
      const weak = sub === "checkout" ? "b" : "c";
      const a = readUnix(rest, `${strong}${weak}`, ["force-create", "create", "orphan"]);
      const forced = a.shortOptions.get(strong) ?? a.longOptions.get("force-create");
      if (typeof forced === "string" && protectedBranch(forced)) return protectedReason(`git ${sub} -${strong}`, forced);
      const created = forced ?? a.shortOptions.get(weak) ?? a.longOptions.get("create");
      if (typeof created === "string") state.branches.set(dirKey, created);
      else if (a.longOptions.has("detach")) state.branches.set(dirKey, null);
      else if (!rest.includes("--")) {
        const target = a.positionals[0];
        // `git checkout <x>` peut viser un fichier : on ne retient que les branches certaines.
        if (target !== undefined && (sub === "switch" || protectedBranch(target))) state.branches.set(dirKey, target);
      }
      return null;
    }
  }
  return null;
}

function otherBranchReason(action: string, branch: string, j: Judge): string {
  const own = j.agentBranch();
  return `${action} sur ${branch} refusé : ce n'est pas ta branche (${own ?? "aucune"}), elle porte peut-être le travail d'un autre fil ; le ménage de fin de feature s'en charge.`;
}

function gitDestructive(sub: string | undefined, rest: string[]): string | null {
  switch (sub) {
    case "clean": {
      const a = readUnix(rest, "e", ["exclude"]);
      return a.shortOptions.has("f") || a.longOptions.has("force") ? "git clean -f" : null;
    }
    case "checkout": {
      const a = readUnix(rest, "bB", ["orphan"]);
      return rest.includes("--") || a.positionals.includes(".") ? "git checkout -- <chemins>" : null;
    }
    case "restore": {
      const a = readUnix(rest, "s", ["source"]);
      const index = a.shortOptions.has("S") || a.longOptions.has("staged");
      const tree = a.shortOptions.has("W") || a.longOptions.has("worktree");
      return index && !tree ? null : "git restore";
    }
    case "reset":
      return rest.includes("--hard") ? "git reset --hard" : null;
    case "stash":
      // Tout sauf la lecture touche l'index ou l'arbre du dossier visé.
      return rest[0] === "list" || rest[0] === "show" ? null : `git stash ${rest[0] ?? "push"}`;
  }
  return null;
}

function analyzePush(
  rest: string[],
  branch: () => string | null,
  protectedBranch: (ref: string | null) => ref is string,
  other: (ref: string) => boolean,
): string | null {
  const a = readUnix(rest, "o", ["repo", "receive-pack", "exec", "push-option"]);
  const refspecs = a.positionals.slice(1);
  const force =
    a.shortOptions.has("f") || a.longOptions.has("force") || a.longOptions.has("force-if-includes") || a.longOptions.has("mirror") || refspecs.some((r) => r.startsWith("+"));
  if (force) return FORCE_REASON;
  if (a.longOptions.has("all") || a.longOptions.has("branches")) {
    return "git push --all refusé : il pousserait aussi les branches partagées ; pousse seulement ta branche de feature.";
  }
  const removal = a.shortOptions.has("d") || a.longOptions.has("delete");
  const destinations: (string | null)[] = [];
  if (refspecs.length === 0) {
    if (!removal && !a.longOptions.has("tags")) destinations.push(branch());
  } else {
    for (const r of refspecs) {
      if (removal) destinations.push(r);
      else if (r.includes(":")) destinations.push(r.slice(r.lastIndexOf(":") + 1));
      else destinations.push(r === "HEAD" || r === "@" ? branch() : r);
    }
  }
  const touched = destinations.find((x) => protectedBranch(x));
  if (touched !== undefined && touched !== null) return protectedReason("Push", touched.replace(/^refs\/heads\//, ""));
  const removed = removal ? refspecs : refspecs.filter((r) => r.startsWith(":")).map((r) => r.slice(1));
  const foreign = removed.find(other);
  return foreign === undefined
    ? null
    : `Suppression de la branche distante ${foreign} refusée : ce n'est pas ta branche, elle porte peut-être le travail d'un autre fil ; seule la tienne se supprime ici.`;
}

// ---------------------------------------------------------------------------------------------

// Le texte d'où peut venir un message de commit : arguments et heredocs, un par ligne. Une commande qui cherche ou
// retire l'attribution (grep, sed) ne la porte pas.
function messageText(command: string): string {
  // La recherche part avec ses motifs entre guillemets : leurs `|` ne séparent pas des commandes.
  return command
    .replace(/(^|[\n;|&])[ \t]*(?:grep|rg|sed|findstr|select-string)[ \t](?:'[^']*'|"[^"]*"|[^'"\n;|&])*/gi, "$1")
    .split(/[\n;|&]/)
    .join("\n")
    .replace(/["']|\\n|`n/g, "\n");
}

const FILE_TOOLS: Readonly<Record<string, string>> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

export function decideGuard(input: ToolInput, ctx: GuardContext): Verdict {
  const windows = /^[a-zA-Z]:[\\/]|^\\\\/.test(ctx.root);
  const p = windows ? win32 : posix;
  const cwd = p.resolve(ctx.root, input.cwd || ctx.root);
  const root = p.resolve(ctx.root);
  const worktrees = p.join(root, ".claude", "worktrees");
  const j: Judge = {
    ctx,
    p,
    windows,
    zones: [],
    protectedBranches: new Set(ctx.protectedBranches.map((b) => b.toLowerCase())),
    rootKey: "",
    zone: root,
    zoneKey: "",
    excludedZone: null,
    spawnKey: "",
    agentBranch: () => null,
    commits: false,
  };
  j.zones = [ctx.root, ...ctx.allowedList].map((z) => key(j, z));
  j.rootKey = key(j, root);
  j.spawnKey = key(j, p.join(root, ".spawn"));
  const worktreesKey = key(j, worktrees);
  const cwdKey = key(j, cwd);
  if (cwdKey.startsWith(worktreesKey + p.sep)) {
    const name = cwd.slice(worktrees.length + 1).split(p.sep)[0] ?? "";
    j.zone = p.join(worktrees, name);
  } else j.excludedZone = worktreesKey;
  j.zoneKey = key(j, j.zone);
  let agentBranch: string | null | undefined;
  j.agentBranch = () => (agentBranch === undefined ? (agentBranch = ctx.currentBranch(j.zone)) : agentBranch);

  const field = FILE_TOOLS[input.tool_name];
  if (field !== undefined) {
    const path = input.tool_input[field];
    if (typeof path !== "string" || path === "") return OK;
    const abs = p.resolve(cwd, path);
    if (!inside(j, abs)) {
      return { allowed: false, reason: `Écriture hors du projet refusée (${abs}) : écris sous ${allowedPlaces(j)}.` };
    }
    return inOtherWorktree(j, abs) ? { allowed: false, reason: zoneReason("Écriture refusée", abs, j) } : OK;
  }

  if (input.tool_name === "Bash" || input.tool_name === "PowerShell") {
    const command = input.tool_input.command;
    if (typeof command !== "string") return OK;
    const state: State = { dir: cwd, stack: [], branches: new Map(), vars: new Map(), pipe: null };
    const reason = analyzeText(command, input.tool_name === "Bash" ? "bash" : "pwsh", state, j, 0);
    if (reason !== null) return { allowed: false, reason };
    // Refusée avant le commit : le hook git manque dans un dépôt pas adopté, ou pointe une version purgée, et le refus
    // n'arrivait qu'à la fin de la tâche (constat du 22/11).
    const attribution = j.commits ? aiAttribution(messageText(command)) : null;
    return attribution === null ? OK : { allowed: false, reason: `Commit refusé : ${attribution}. ${ATTRIBUTION_REASON}` };
  }
  return OK;
}
