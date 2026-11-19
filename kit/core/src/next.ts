// Prochaine action d'un fil (docs/kit-perimetre.md §0 : l'outil porte l'enchaînement, le modèle exécute une étape).
// Déduite de l'état du fil, du ledger, du plan et des fichiers de travail : rien n'est tenu en mémoire de conversation.
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { ledgerPath, type Context } from "./context.ts";
import { domain, hasScenes } from "./domain.ts";
import { citedRequirements, planSection, readPlan, requirementLines, specRequirements } from "./plan.ts";
import { readStory, listStories } from "./stories.ts";
import { readDecisions } from "./merge.ts";
import { git } from "./git.ts";
import { readLedger, type LedgerEvent } from "./ledger.ts";
import { vocabulary, type Agent } from "./vocabulary.ts";
import { KIT_CORE, isInside, runtimeRoot } from "./location.ts";

// Ce que l'outil exécute seul (`spawn run`), sans modèle pour décider : une commande du ledger, le paquet de revue, un
// agent lancé avec son prompt exact. Absent : l'action demande du jugement, et l'orchestrateur la fait. Essai du 18/11 :
// 94 % du coût venait de l'orchestrateur qui enchaînait ces gestes un à un.
export type RunStep =
  | { kind: "ledger"; args: string[] }
  | { kind: "package"; base: string; path: string }
  | { kind: "agent"; agent: "implementer" | "task-reviewer"; model: string; prompt: string };

export interface Action {
  step: string;
  instruction: string;
  commands: string[];
  proof?: string;
  run?: RunStep[];
}

// Statut écrit par l'implémenteur dans son rapport ; la ligne « statut : X » prime sur une mention ailleurs.
export type ReportStatus = "DONE" | "DONE_WITH_CONCERNS" | "NEEDS_CONTEXT" | "BLOCKED";
export function reportStatus(text: string): ReportStatus | null {
  const m = /statut\W*(DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED|DONE)\b/i.exec(text) ?? /\b(DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED|DONE)\b/.exec(text);
  return (m?.[1]?.toUpperCase() as ReportStatus | undefined) ?? null;
}

export interface Task {
  number: number;
  title: string;
}

const CLI = join(KIT_CORE, "src", "cli.ts");
// Jamais de chemin absolu dans ce que lit un agent : il le recopie dans ses plans et ses docs (essai du 19/11, nom de
// compte de la machine dans un plan commité). Version installée : la commande `spawn` (lanceurs de `binDir()`, au PATH
// des agents). Dépôt (développement de Spawn) : le chemin relatif au dossier courant.
export const SPAWN = isInside(KIT_CORE, runtimeRoot()) ? "spawn" : `node "${relative(process.cwd(), CLI) || CLI}"`;
// Pour exécuter le kit (jamais pour l'écrire dans une consigne).
export const CLI_PATH = CLI;

// Chemins d'une consigne rendus relatifs au dossier où l'agent travaille. Les étapes que l'outil exécute (`run`)
// gardent leurs chemins absolus : elles ne sont lues par personne.
export function relativeTo(dir: string, root: string, text: string): string {
  // git donne la racine avec des « / », join écrit des « \ » sous Windows : les deux formes sont cherchées.
  const swap = (t: string, from: string, to: string, s: string) => t.split(from + s).join(to === "." ? "" : to + s).split(from).join(to);
  const d = resolve(dir);
  const r = resolve(root);
  const up = relative(d, r) || ".";
  // Le plus long d'abord : le worktree est sous la racine.
  const pairs: [string, string][] = d.length >= r.length ? [[d, "."], [r, up]] : [[r, up], [d, "."]];
  let out = text;
  for (const [from, to] of pairs) {
    if (!isAbsolute(from)) continue;
    out = swap(out, from, to, sep);
    if (sep === "\\") out = swap(out, from.replaceAll("\\", "/"), to.replaceAll("\\", "/"), "/");
  }
  return out;
}

export function nextAction(ctx: Context, agent?: Agent): Action {
  const a = stepAction(ctx, agent);
  const rel = (t: string) => relativeTo(ctx.dir, ctx.project.root, t);
  return {
    ...a,
    instruction: rel(a.instruction),
    commands: a.commands.map(rel),
    ...(a.proof === undefined ? {} : { proof: rel(a.proof) }),
    ...(a.run === undefined ? {} : { run: a.run.map((s) => (s.kind === "agent" ? { ...s, prompt: rel(s.prompt) } : s)) }),
  };
}

// Fichiers de travail des tâches d'un fil : brief, rapport de l'implémenteur, verdict du relecteur. Sous `.spawn/` de la
// racine, hors du worktree : un `git clean` d'agent dans le worktree les effaçait (essai 5 de la nuit du 18/11).
export const tasksDir = (root: string, story: string) => join(root, ".spawn", "tasks", story);
export const reviewPath = (root: string, story: string, task: number) => join(tasksDir(root, story), `${task}-review.md`);
export const reportPath = (root: string, story: string, task: number) => join(tasksDir(root, story), `${task}-report.md`);

export const finalReviewPath = (root: string, story: string) => join(tasksDir(root, story), "final-review.md");

// Le verdict final vaut s'il est plus récent que la dernière tâche close et que les dernières corrections notées.
export function finalReviewUpToDate(path: string, lastTask: string, corrections: string): boolean {
  if (!existsSync(path)) return false;
  const written = statSync(path).mtimeMs;
  return written >= (Date.parse(lastTask) || 0) && written >= (Date.parse(corrections) || 0);
}

// Exigences de la spec validée dont la preuve est une capture.
export function capturedRequirements(ctx: Context, specPath: string): string[] {
  const text = readPlan(ctx.dir, specPath);
  return text === null ? [] : specRequirements(text, ctx.project.config.tag).filter((r) => r.proof === "capture").map((r) => r.id);
}

export const briefPath = (root: string, story: string, task: number) => join(tasksDir(root, story), `${task}-brief.md`);

// Brief d'une tâche, écrit par l'outil à `ledger task-started` : ce n'est que de la recopie (section du plan, exigences
// citées avec leur preuve, commits des tâches closes, Rulings). Essai du 18/11 : l'orchestrateur opus le rédigeait.
export function taskBrief(ctx: Context, specPath: string, planPath: string, task: number, evs: readonly LedgerEvent[]): string | null {
  const plan = readPlan(ctx.dir, planPath);
  const section = plan === null ? null : planSection(plan, task);
  if (section === null) return null;
  const tag = ctx.project.config.tag;
  const spec = readPlan(ctx.dir, specPath) ?? "";
  const requirements = requirementLines(spec, citedRequirements(section, tag), tag);
  const closed = evs.flatMap((e) => (e.type === "task-done" ? [`- tâche ${e.task} : commits ${e.commits}`] : []));
  const rulings = evs.flatMap((e) =>
    e.type === "ruling" ? [`- ${e.decision} — ${e.reason} — ${e.cost}`] : e.type === "task-parked" ? [`- tâche ${e.task} parquée : ${e.ruling}`] : [],
  );
  return [
    `# Brief de la tâche ${task}`,
    `Plan : ${planPath} ; spec validée : ${specPath}.`,
    "",
    section,
    "",
    "## Exigences couvertes (spec validée)",
    ...(requirements.length > 0 ? requirements : ["- aucune citée par la tâche"]),
    "",
    "## Tâches précédentes (leurs interfaces sont dans ces commits)",
    ...(closed.length > 0 ? closed : ["- aucune"]),
    "",
    "## Rulings",
    ...(rulings.length > 0 ? rulings : ["- aucun"]),
    "",
  ].join("\n");
}

// Story d'une seule tâche, approuvée, sans tâche parquée ni redemande : la relecture de cette tâche a déjà lu toute la
// branche et tient lieu de relecture finale (essai du 18/11 : une seconde relecture, sur opus, pour une ligne changée).
export function singleTaskReview(root: string, story: string, evs: readonly LedgerEvent[]): string | null {
  const started = new Set(evs.flatMap((e) => (e.type === "task-started" ? [e.task] : [])));
  if (started.size !== 1 || evs.some((e) => e.type === "task-parked" || e.type === "changes-requested")) return null;
  const [n] = [...started];
  if (n === undefined || !evs.some((e) => e.type === "task-done" && e.task === n)) return null;
  const review = reviewPath(root, story, n);
  return existsSync(review) && !needsChanges(readFileSync(review, "utf8")) ? review : null;
}

// Verdict du relecteur : sa ligne « VERDICT : APPROUVÉ » ou « VERDICT : À CORRIGER » fait foi ; à défaut, un finding
// Critique ou Important sans approbation demande un round.
// Un finding Critique ou Important : « 3. [Important] … », « 1. Important : … », « - **Critique** … ». « Non critique » n'en est pas un.
const BLOCKING_FINDING = /\[\s*(critique|important)\s*\]|(^|\s)(\d+[.)]|[-*])\s*\**\s*(critique|important)\b/im;

export function needsChanges(text: string): boolean {
  const line = /VERDICT\s*:\s*([^\n]+)/i.exec(text)?.[1] ?? "";
  // Approuvé mais avec un finding Important : le verdict se contredit, le finding prime (essai du 19/11, tâche 1).
  if (/approuv/i.test(line)) return BLOCKING_FINDING.test(text);
  if (/corrig/i.test(line)) return true;
  return /critique|important/i.test(text) && !/approved|approuv/i.test(text);
}

// Les tâches d'un plan sont des titres `## Tâche N : <titre>` : un format qu'un outil lit, pas une prose à interpréter.
export function planTasks(text: string): Task[] {
  const tasks: Task[] = [];
  for (const m of text.matchAll(/^#{2,3}\s*T[âa]che\s+(\d+)\s*[:—–-]\s*(.+?)\s*$/gim)) {
    tasks.push({ number: Number(m[1]), title: m[2] ?? "" });
  }
  return tasks.sort((a, b) => a.number - b.number);
}

const date = () => new Date().toISOString().slice(0, 10);

// Le cadre technique du projet, rappelé là où un modèle choisit sa technologie (spec, plan). Essai de nuit du 18/11 : sans
// lui, un modèle local a planifié du HTML et du JavaScript dans un projet Godot.
function framing(ctx: Context): string {
  const { engine, version } = ctx.project.config;
  const d = domain(ctx.project);
  const read = ["CLAUDE.md", "knowledge/organization.md"].filter((f) => existsSync(join(ctx.dir, f)));
  return `Projet de ${d.product} ${engine} ${version}${d.framing ? ` : ${d.framing}` : ""}.${read.length > 0 ? ` Lis d'abord ${read.map((f) => join(ctx.dir, f)).join(" et ")} (ceux du projet, dans ton worktree).` : ""}`;
}

function last<T extends LedgerEvent["type"]>(evs: readonly LedgerEvent[], type: T): Extract<LedgerEvent, { type: T }> | undefined {
  return [...evs].reverse().find((e): e is Extract<LedgerEvent, { type: T }> => e.type === type);
}

// `agent` : celui à qui l'action est donnée ; sans lui, celui de l'environnement (le CLI lancé par l'agent). Le service n'en a pas :
// il le passe, sinon l'enchaîneur parlait Claude Code à OpenCode (essai du 19/11 : « spawnstudio:implementer », « outil Agent »).
function stepAction(ctx: Context, agent?: Agent): Action {
  const { root, config } = ctx.project;
  const dom = domain(ctx.project);
  const { limits } = config;
  const v = vocabulary(agent ?? process.env.SPAWN_AGENT);

  if (ctx.story === null) {
    const alive = listStories(root).filter((f) => f.status !== "cleaned");
    if (alive.length === 0) {
      return {
        step: "aucun fil",
        instruction: `Pour une feature : choisir un nom court en kebab-case tiré de l'intention (ex. saut-mural), puis ${v.enterWorktree("<nom>")}.`,
        commands: [`${SPAWN} next`],
      };
    }
    return {
      step: "fils en cours",
      instruction: `Reprendre un fil : ${v.enterWorktree("<nom du fil>")}, puis ${SPAWN} next. Fils : ${alive.map((f) => `${f.story} (${f.status}${f.task ? `, ${f.task}` : ""})`).join(" ; ")}.`,
      commands: [],
    };
  }

  const story = readStory(root, ctx.story);
  if (story === null) return { step: "état absent", instruction: `Aucun état pour le fil ${ctx.story} : ce worktree n'a pas été créé par le kit. En créer un : ${v.enterWorktree("<nom>")}.`, commands: [] };
  if (story.status === "cleaned") return { step: "terminé", instruction: `Le fil ${story.story} est fusionné et nettoyé : rien à faire.`, commands: [] };
  if (story.status.startsWith("blocked:")) {
    return {
      step: "en attente de l'utilisateur",
      instruction: `Le fil attend une réponse de l'utilisateur (${story.task ?? story.status}). Ne rien faire d'autre. Quand il a répondu : intégrer sa réponse, remettre le fil actif, puis relancer.`,
      commands: [`${SPAWN} story update --status active`, `${SPAWN} next`],
    };
  }

  if (story.status === "in-acceptance") {
    return {
      step: "à juger",
      instruction: "L'utilisateur juge la feature dans l'app (accepter, redemander ou abandonner). Ne rien faire : l'app relance le fil s'il redemande.",
      commands: [],
    };
  }

  const evs = readLedger(ledgerPath(root, ctx.story));
  const merge = last(evs, "merged");
  if (merge) {
    return {
      step: "après fusion",
      // Le rangement n'est plus demandé à l'agent : depuis le worktree il échouait (dossier ouvert, EPERM), et ExitWorktree
      // ne fait rien dans une session de l'app. L'outil range à la fin du tour (service, pilote) ou par `spawn cleanup`.
      instruction: `Fusionné (${merge.commit.slice(0, 10)}). Fais le rapport final à l'utilisateur (ce qu'il peut voir ou jouer d'abord), puis arrête-toi. Ne supprime pas le worktree et n'en sors pas : l'outil le range quand ton tour se termine.`,
      commands: [],
    };
  }
  const spec = last(evs, "spec-approved");
  if (!spec) {
    // La spec est proposée par l'agent et validée par l'utilisateur dans l'app : l'agent n'écrit jamais la validation.
    const proposed = last(evs, "spec-proposed");
    const path = proposed?.path ?? `docs/specs/${date()}-${story.story}.md`;
    const propose = [`${SPAWN} ledger spec-proposed --path ${path}`, `${SPAWN} story update --status blocked:spec-approval --task "valider la spec"`];
    // Proposée, mais le fil n'a pas bougé depuis : l'agent n'a pas encore mis le fil en attente, l'utilisateur n'a rien
    // dit (essai du 19/11 : « l'utilisateur a répondu » affiché juste après la proposition, spec réécrite pour rien).
    if (proposed && story.updated <= proposed.date) {
      return {
        step: "spec proposée, fil à mettre en attente",
        instruction: `La spec ${path} est proposée, mais le fil n'est pas en attente : l'utilisateur ne la voit pas encore. Mets le fil en attente par la commande, puis arrête-toi : il la validera dans l'app.`,
        commands: [propose[1] ?? ""],
        proof: "fil en attente de validation",
      };
    }
    if (proposed) {
      return {
        step: "spec à revoir",
        instruction: `L'utilisateur a répondu sans valider ${path} : sa réponse est son dernier message. Corrige la spec en conséquence, commite-la, puis propose-la de nouveau par les deux commandes, et arrête-toi : il la validera dans l'app.`,
        commands: propose,
        proof: "spec corrigée, commitée et proposée",
      };
    }
    return {
      step: "spec",
      instruction:
        `${framing(ctx)} Écrire ${join(ctx.dir, path)} (une page) : « Résultat attendu » (ce que l'utilisateur pourra voir ou jouer, et comment, en 3 à 5 lignes), « Exigences » (numérotées ${config.tag ?? "TAG"}-01, ${config.tag ?? "TAG"}-02, ${config.tag ?? "TAG"}-03…, une phrase observable chacune, en élément de liste « - **${config.tag ?? "TAG"}-NN** <phrase>. Preuve : <test | bout en bout | capture | aucune>. » ; une preuve « test » nomme son contrôle négatif, le cas qui doit échouer), « Hors périmètre ». La preuve dit ce qui sera testé, et ce qui ne le sera pas : l'utilisateur la valide avec le reste. « test » et « bout en bout » s'écrivent avec l'outillage de test qui existe déjà ; si un test demanderait un outillage absent, la preuve est « capture » ou « aucune », et la spec dit ce qu'un test demanderait. Une capture montre ce que le projet affiche au lancement (sa scène ou sa page), sans clic ni touche : une exigence qui demande une action (menu déplié, saut, survol) n'a pas la preuve « capture », mais « test », ou « aucune » quand l'utilisateur la regarde lui-même à la recette. Le projet garde au moins un test de bout en bout (la preuve de l'outil l'exige) : s'il n'en a pas encore, une exigence a la preuve « bout en bout ». ` +
        "La commiter, puis la proposer et mettre le fil en attente par les deux commandes, et t'arrêter : c'est l'utilisateur qui la valide, dans l'app. C'est la seule question de la feature.",
      commands: propose,
      proof: "spec commitée et proposée, fil en attente de validation",
    };
  }

  const plan = last(evs, "plan");
  if (!plan) {
    const path = `docs/plans/${date()}-${story.story}.md`;
    return {
      step: "plan",
      instruction:
        `${framing(ctx)} Écrire ${join(ctx.dir, path)}, en-tête « **Spec :** ${spec.path} ». Chaque tâche sous un titre exact « ## Tâche N : <titre> » (2 à 5 minutes, autonome) : fichiers touchés, exigences couvertes, interfaces produites. Un test s'écrit seulement pour une exigence dont la preuve, dans la spec validée, est « test » ou « bout en bout » : test d'abord (le test qui doit rougir) et commande de preuve (${SPAWN} engine test --filter <motif>) ; un test de bout en bout charge la scène principale (celle que le projet lance) et rejoue « Résultat attendu ». Pour une preuve « capture » ou « aucune », la tâche n'écrit aucun test et sa preuve est la suite existante (${SPAWN} engine test). Le commiter.`,
      commands: [`${SPAWN} ledger plan --path ${path}`],
      proof: "plan commité dont les tâches sont lisibles par spawn next",
    };
  }

  const planPath = join(ctx.dir, plan.path);
  if (!existsSync(planPath)) return { step: "plan introuvable", instruction: `Le ledger cite ${plan.path}, absent du worktree : le restaurer ou réécrire le plan.`, commands: [] };
  const tasks = planTasks(readFileSync(planPath, "utf8"));
  if (tasks.length === 0) {
    return { step: "plan illisible", instruction: `${plan.path} n'a aucune tâche au format « ## Tâche N : <titre> » : corriger les titres et commiter.`, commands: [`${SPAWN} next`] };
  }

  const work = tasksDir(root, story.story);
  for (const t of tasks) {
    const done = evs.some((e) => (e.type === "task-done" || e.type === "task-parked") && e.task === t.number);
    if (done) continue;
    const n = t.number;
    const position = `tâche ${n}/${tasks.length} : ${t.title}`;
    const started = [...evs].reverse().find((e): e is Extract<LedgerEvent, { type: "task-started" }> => e.type === "task-started" && e.task === n);
    const brief = briefPath(root, story.story, n);
    const report = join(work, `${n}-report.md`);
    // Le lancement de l'implémenteur est un geste d'outil (sous-agent), pas une commande : il est écrit en toutes
    // lettres, avec son prompt exact. Essai de nuit du 18/11 : le modèle a noté « lancée » sans lancer, puis attendu.
    const prompt = `Tâche ${n} du fil ${story.story}. Le ${dom.product} est dans le dossier courant (le worktree du fil) : tous ses fichiers s'écrivent là, chemins relatifs à ce dossier. Lis d'abord ${brief} et fais exactement ce qu'il demande (test d'abord s'il en prévoit un), commite, puis écris ton rapport dans ${report} : statut DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT ou BLOCKED, ce qui a été fait, les commits.`;
    const run = `lance UN agent ${v.subagent("implementer")}${v.model(limits.model)}, par ${v.subagentTool}, avec exactement ce prompt : « ${prompt} » Aucun historique collé. Tu reprends la main quand il a fini.`;
    const implement: RunStep = { kind: "agent", agent: "implementer", model: limits.model, prompt };
    if (!started) {
      return {
        step: `${position}, lancer`,
        instruction:
          `1) Noter le lancement par la commande : l'outil note la base et écrit le brief ${brief} (section du plan, exigences, tâches précédentes, Rulings) ; ne l'écris pas toi-même. 2) Puis ${run}`,
        commands: [`${SPAWN} ledger task-started --task ${n}`],
        proof: `rapport ${report} écrit par l'implémenteur`,
        run: [{ kind: "ledger", args: ["task-started", "--task", String(n)] }, implement],
      };
    }
    const rounds = evs.filter((e) => e.type === "round" && e.task === n).length;
    // Un sous-agent bloque l'orchestrateur jusqu'à sa fin : sans rapport, il n'a pas tourné ou s'est arrêté avant.
    if (!existsSync(report)) {
      return {
        step: `${position}, implémenteur à lancer`,
        instruction: existsSync(brief)
          ? `Aucun rapport ${report} : l'implémenteur n'a pas été lancé, ou s'est arrêté avant d'écrire son rapport. N'attends pas : ${run}`
          : `Le brief ${brief} n'existe pas : écris-le d'abord (la section « Tâche ${n} » de ${plan.path} recopiée, les exigences qu'elle couvre recopiées de ${spec.path}), puis ${run}`,
        commands: [],
        proof: `rapport ${report} écrit par l'implémenteur`,
        ...(existsSync(brief) ? { run: [implement] } : {}),
      };
    }
    const pkg = join(work, `${n}-package.diff`);
    if (rounds >= limits.rounds) {
      return {
        step: `${position}, plafond de rounds atteint`,
        instruction: `${rounds} rounds de correction sans relecture propre : parquer la tâche avec un Ruling et passer à la suivante ; la relecture finale la reprendra.`,
        commands: [`${SPAWN} ledger task-parked --task ${n} --detail "<ce qui reste>" --ruling "<décision> — <raison> — <coût si faux>"`, `${SPAWN} next`],
      };
    }
    const upcoming = rounds + 1;
    const escalation = upcoming > limits.rounds - 2;
    // La relecture est un sous-agent qui écrit son verdict dans un fichier : sans ce fichier (plus récent que le rapport),
    // pas de verdict, et `spawn ledger task-done` refuse. Essai de nuit du 18/11 : tâche close sans relecture.
    const review = reviewPath(root, story.story, n);
    const reviewed = existsSync(review) && statSync(review).mtimeMs >= statSync(report).mtimeMs;
    // NEEDS_CONTEXT ou BLOCKED : il faut répondre à l'implémenteur, ce que seul l'orchestrateur sait faire.
    const status = reportStatus(readFileSync(report, "utf8"));
    const answerable = status === "DONE" || status === "DONE_WITH_CONCERNS";
    if (!reviewed) {
      const reviewPrompt = `Relis la tâche ${n} du fil ${story.story} ; le ${dom.product} est dans le dossier courant (le worktree du fil). Brief : ${brief}. Rapport de l'implémenteur : ${report}. Paquet (diff et commits) : ${pkg}. Vérifie la conformité au brief et à la spec ${spec.path}, puis la qualité. Écris ton verdict dans ${review}, en commençant par une ligne exacte « VERDICT : APPROUVÉ » (aucun finding Critique ni Important) ou « VERDICT : À CORRIGER », puis « spec OK » ou les écarts, puis les findings numérotés (Critique, Important, Mineur).`;
      return {
        step: `${position}, relecture${rounds > 0 ? ` après le round ${rounds}` : ""}`,
        instruction:
          `Lire le statut du rapport ${report} (DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED ; autre chose que DONE : y répondre d'abord). Puis 1) écrire le paquet de revue par les deux commandes ; ` +
          `2) lance UN agent ${v.subagent("task-reviewer")}${v.model(limits.model)}, par ${v.subagentTool}, avec exactement ce prompt : « ${reviewPrompt} » Jamais de correction faite par toi.`,
        commands: [`git diff ${started.base}..HEAD > "${pkg}"`, `git log --oneline ${started.base}..HEAD >> "${pkg}"`],
        proof: `verdict du relecteur écrit dans ${review}`,
        ...(answerable
          ? { run: [{ kind: "package", base: started.base, path: pkg }, { kind: "agent", agent: "task-reviewer", model: limits.model, prompt: reviewPrompt }] satisfies RunStep[] }
          : {}),
      };
    }
    // L'outil lit le verdict et ne donne qu'une action : un choix entre branches décrit en prose bloquait le modèle
    // local (essai 5 de la nuit : spawn next relancé en boucle devant un verdict « Critique »).
    const verdict = readFileSync(review, "utf8");
    if (!needsChanges(verdict)) {
      return {
        step: `${position}, terminer`,
        instruction: `Le relecteur approuve (${review}). Note la tâche terminée ; s'il cite des findings Mineurs, note-les aussi (une commande mineur par finding), ils iront à la relecture finale.`,
        commands: [`${SPAWN} ledger task-done --task ${n}`, `${SPAWN} ledger minor --task ${n} --detail "<finding mineur>"`],
        proof: "tâche terminée",
        run: [
          { kind: "ledger", args: ["task-done", "--task", String(n)] },
          // La relecture finale relit le fichier de verdict : un renvoi suffit, l'outil ne résume rien.
          ...(/\bmineur/i.test(verdict) ? [{ kind: "ledger", args: ["minor", "--task", String(n), "--detail", `findings mineurs dans ${review}`] } satisfies RunStep] : []),
        ],
      };
    }
    // Date d'événement à la milliseconde, date de fichier plus fine : on arrondit, sinon un round noté dans la même
    // milliseconde que la relecture paraît plus ancien qu'elle.
    const roundNote = evs.some((e) => e.type === "round" && e.task === n && Date.parse(e.date) >= Math.floor(statSync(review).mtimeMs));
    const fixModel = escalation ? limits.escalation_model : limits.model;
    const fixPrompt = `Round ${roundNote ? rounds : upcoming} de la tâche ${n} du fil ${story.story}. Le ${dom.product} est dans le dossier courant (le worktree du fil) : tous ses fichiers s'écrivent là. Lis ${brief}, puis les findings de ${review}. Corrige chaque finding Critique et Important (test d'abord si la spec prévoit un test pour l'exigence en cause), commite, puis réécris ton rapport ${report}.`;
    const fix = `lance UN agent ${v.subagent("implementer")}${v.model(fixModel)}, par ${v.subagentTool}, avec exactement ce prompt : « ${fixPrompt} » Jamais de correction faite par toi.`;
    const fixing: RunStep = { kind: "agent", agent: "implementer", model: fixModel, prompt: fixPrompt };
    if (roundNote) {
      return { step: `${position}, correction du round ${rounds}`, instruction: `Le round ${rounds} est noté. Maintenant ${fix}`, commands: [], proof: `rapport ${report} réécrit après correction`, run: [fixing] };
    }
    return {
      step: `${position}, round ${upcoming}/${limits.rounds}`,
      instruction: `Le relecteur demande des corrections (${review}). 1) Note le round par la commande. 2) Puis ${fix}`,
      commands: [`${SPAWN} ledger round --task ${n} --number ${upcoming} --detail "<findings Critique et Important, en une ligne>"`],
      proof: `rapport ${report} réécrit après correction`,
      run: [{ kind: "ledger", args: ["round", "--task", String(n), "--number", String(upcoming), "--detail", `findings de ${review}`] }, fixing],
    };
  }

  // Chaque étape de fin doit être plus récente que la dernière tâche close : une correction ajoutée après une
  // relecture, des captures ou un refus de fusion les rend caduques.
  const lastTask = [...evs].reverse().find((e) => e.type === "task-done" || e.type === "task-parked")?.date ?? "";
  const changesRequested = last(evs, "changes-requested");
  if (changesRequested && changesRequested.date > lastTask) {
    return {
      step: "correction demandée",
      instruction: `L'utilisateur a jugé la feature et redemande : « ${changesRequested.message} ». Ajouter à la fin de ${plan.path} une tâche « ## Tâche ${(tasks.at(-1)?.number ?? 0) + 1} : <titre de la correction> » qui y répond (test d'abord si la spec prévoit un test pour l'exigence en cause), commiter le plan, puis la mener comme les autres.`,
      commands: [`${SPAWN} next`],
      proof: "tâche de correction ajoutée au plan et commitée",
    };
  }

  // Preuve refusée par l'outil, plus récente que la dernière tâche : la seule suite est une tâche de correction.
  const refusedProof = last(evs, "captures");
  if (refusedProof?.verdict === "invalid" && refusedProof.detail && refusedProof.date > lastTask) {
    return {
      step: "correction de la preuve",
      instruction: `La preuve est refusée : ${refusedProof.detail}. Refaire les captures ne changera rien. Ajouter à la fin de ${plan.path} une tâche « ## Tâche ${(tasks.at(-1)?.number ?? 0) + 1} : correction de la preuve » qui corrige ce motif (fichiers en cause, correction attendue, commande de preuve), commiter le plan, puis la mener comme les autres : un implémenteur la fait, jamais toi.`,
      commands: [`${SPAWN} next`],
      proof: "tâche de correction ajoutée au plan et commitée",
    };
  }

  const review = last(evs, "final-review");
  if (review?.verdict !== "clean" || review.date < lastTask) {
    // Comme pour une tâche : le relecteur écrit son verdict dans un fichier, l'outil le lit et ne donne qu'une action
    // (essai 5 de la nuit : relecture finale déclarée propre en 6 secondes, sans relecteur).
    const single = singleTaskReview(root, story.story, evs);
    if (single !== null) {
      return {
        step: "relecture finale",
        instruction: `Une seule tâche, approuvée par son relecteur (${single}) : cette relecture tient lieu de relecture finale. Note-le.`,
        commands: [`${SPAWN} ledger final-review --verdict clean`],
        proof: "relecture finale notée propre",
        run: [{ kind: "ledger", args: ["final-review", "--verdict", "clean"] }],
      };
    }
    const final = finalReviewPath(root, story.story);
    const corrections = evs.findLast((e) => e.type === "final-review" && e.verdict === "changes")?.date ?? "";
    if (!finalReviewUpToDate(final, lastTask, corrections)) {
      const finalPrompt = `Relecture finale du fil ${story.story} ; le ${dom.product} est dans le dossier courant (le worktree du fil). Relis toute la branche (git diff $(git merge-base develop HEAD)..HEAD) contre la spec ${spec.path} et le plan ${plan.path}, avec les findings mineurs et les tâches parquées du ledger (${SPAWN} ledger). Écris ton verdict dans ${final}, en commençant par une ligne exacte « VERDICT : APPROUVÉ » (aucun finding Critique ni Important) ou « VERDICT : À CORRIGER », puis les findings numérotés (Critique, Important, Mineur).`;
      return {
        step: "relecture finale",
        instruction: `Toutes les tâches sont terminées ou parquées. Lance UN agent ${v.subagent("task-reviewer")}${v.model(limits.escalation_model)}, par ${v.subagentTool}, avec exactement ce prompt : « ${finalPrompt} » Jamais de relecture faite par toi.`,
        commands: [],
        proof: `verdict écrit dans ${final}`,
        run: [{ kind: "agent", agent: "task-reviewer", model: limits.escalation_model, prompt: finalPrompt }],
      };
    }
    const finalFix = `Corrections finales du fil ${story.story} ; le ${dom.product} est dans le dossier courant (le worktree du fil) : tous ses fichiers s'écrivent là. Corrige chaque finding Critique et Important de ${final} (test d'abord si la spec prévoit un test pour l'exigence en cause), commite, et résume ce que tu as fait.`;
    if (needsChanges(readFileSync(final, "utf8"))) {
      return {
        step: "corrections de la relecture finale",
        instruction: `La relecture finale demande des corrections (${final}). 1) Lance UN agent ${v.subagent("implementer")}${v.model(limits.escalation_model)}, par ${v.subagentTool}, avec exactement ce prompt : « ${finalFix} » 2) Puis note les corrections par la commande : le relecteur relira.`,
        commands: [`${SPAWN} ledger final-review --verdict changes --detail "<ce qui a été corrigé ; commits a..b>"`],
        proof: "corrections commitées et notées",
        // `{commits}` : l'enchaîneur y met la plage des commits que l'agent vient de faire.
        run: [
          { kind: "agent", agent: "implementer", model: limits.escalation_model, prompt: finalFix },
          { kind: "ledger", args: ["final-review", "--verdict", "changes", "--detail", `corrections des findings de ${final} ; commits {commits}`] },
        ],
      };
    }
    return {
      step: "relecture finale approuvée",
      instruction: `Le relecteur approuve la branche (${final}) : note-le.`,
      commands: [`${SPAWN} ledger final-review --verdict clean`],
      proof: "relecture finale notée propre",
      run: [{ kind: "ledger", args: ["final-review", "--verdict", "clean"] }],
    };
  }

  const captures = last(evs, "captures");
  if (captures?.verdict !== "valid" || captures.date < review.date) {
    const dir = join(root, ".spawn", "captures", story.story);
    // Une capture par exigence « Preuve : capture », nommée par son identifiant : `ledger captures` les exige toutes
    // (essai du 18/11 : SGS-32 promettait le menu déplié, la seule capture le montrait fermé, vu à la relecture finale).
    const required = capturedRequirements(ctx, spec.path);
    const pngs = required.length > 0 ? required.map((id) => join(dir, `${id}.png`)) : [join(dir, "capture-1.png")];
    // Ce que l'outil sait, il le remplit : un moteur sans scènes (Node) capture sa page déclarée, sans --scene à deviner
    // (essai du 18/11 : « --scene <scène> » a fait lire scripts/launch.mjs à l'agent pour trouver quoi capturer).
    const sceneless = !hasScenes(ctx.project);
    const capture = (png: string) => (sceneless ? `${SPAWN} engine capture --output "${png}"` : `${SPAWN} engine capture --scene <scène> --output "${png}"`);
    return {
      step: "preuve et captures",
      instruction:
        `Import du moteur (commite les fichiers qu'il génère à côté des tiens, comme les .uid de Godot). Puis ${required.length > 0 ? `une capture par exigence « Preuve : capture » de ${spec.path} (${required.join(", ")}), nommée par son identifiant, regardée : elle doit montrer ce que l'exigence promet ; sinon, ne la note pas et arrête-toi pour le dire à l'utilisateur` : `pour chaque élément de « Résultat attendu » de ${spec.path}, une capture`} dans ${dir} (${sceneless ? "sans --scene, la capture montre la page que le projet déclare" : `ou l'agent ${v.subagent("scene-validator")} pour une scène qui évolue`}), ${v.viewImage} avant d'être montrée. ` +
        `Ne lance ni compilation, ni suite, ni smoke test : la commande des captures fait la preuve elle-même (compilation, suite complète, smoke test) et refuse avec la raison au moindre rouge ; un rouge devient une tâche « ## Tâche N : correction » ajoutée au plan.` +
        (captures ? ` Dernières captures : ${captures.verdict}, à corriger d'abord.` : ""),
      commands: [...pngs.map(capture), `${SPAWN} ledger captures --paths ${pngs.map((p) => `"${p}"`).join(" ")} --verdict valid`],
      proof: "captures regardées, preuve faite par l'outil (compilation, tests, smoke test)",
    };
  }

  // Rien ne se juge ni ne fusionne avec des fichiers non commités : ceux du jeu se commitent, le reste se supprime.
  const dirty = git(ctx.dir, ["status", "--porcelain"]).stdout.trim();
  if (dirty) {
    return {
      step: "worktree à commiter",
      instruction: `Le worktree du fil a des fichiers non commités. Commite ceux du ${dom.product}, y compris les fichiers que le moteur génère à côté des tiens (les .uid de Godot) ; supprime les autres (journaux, essais, fichiers aux noms étranges). Puis relance spawn next. État : ${dirty.split(/\r?\n/).slice(0, 12).join(" ; ")}`,
      commands: ["git status --porcelain", `git add <fichiers du ${dom.product}>`, 'git commit -m "<message court>"'],
      proof: "git status --porcelain vide",
    };
  }

  // L'utilisateur juge avant toute fusion : develop ne reçoit que ce qu'il a vu. Une acceptation tient jusqu'à une
  // redemande ; après un refus de fusion corrigé, l'agent inscrit de nouveau sans redemander de jugement.
  const acceptance = last(evs, "acceptance-report");
  const accepted = last(evs, "accepted");
  if (!accepted || (changesRequested && changesRequested.date > accepted.date)) {
    if (acceptance && acceptance.date >= captures.date) {
      return { step: "à juger", instruction: "Compte rendu écrit : mettre le fil à juger et s'arrêter.", commands: [`${SPAWN} story update --status in-acceptance --task "à juger"`] };
    }
    return {
      step: "compte rendu à juger",
      instruction:
        `Écrire le compte rendu que l'utilisateur lira pour juger, en mots de ${dom.user}, sans jargon : ce qui a été fait (deux ou trois phrases, d'après « Résultat attendu » de ${spec.path}) et comment le vérifier (ce qu'il doit essayer en jouant). Puis mettre le fil à juger et s'arrêter : l'app lui montre le compte rendu et les captures.`,
      commands: [`${SPAWN} ledger acceptance-report --summary "<ce qui a été fait>" --how_to_check "<ce qu'il faut essayer>"`, `${SPAWN} story update --status in-acceptance --task "à juger"`],
      proof: "fil à juger",
    };
  }

  const decisions = readDecisions(root).filter((d) => d.story === story.story && d.verdict !== "queued" && d.date > captures.date);
  const refusal = decisions.at(-1);
  if (refusal && refusal.verdict !== "merged") {
    const step = `fusion refusée (${refusal.cause ?? refusal.verdict})`;
    const detail = refusal.detail ?? "voir spawn merge status";
    const requeue = [`${SPAWN} story update --status done --task fusion`, `${SPAWN} merge --summary "<titre court de la feature>"`];
    // Intégrer develop ou réinscrire n'est pas une tâche : ni brief, ni implémenteur, ni relecteur (essai du 18/11 : une
    // tâche « intégrer develop » a coûté 20 appels de sous-agents pour zéro ligne de code).
    if (refusal.cause === "head-changed") {
      return { step, instruction: `${detail}. La branche a avancé après son inscription : réinscris-la.`, commands: requeue };
    }
    if (refusal.cause === "conflict") {
      return {
        step,
        instruction: `${detail}. Dans le worktree du fil : intègre develop, résous chaque conflit en gardant les deux intentions, commite, vérifie la suite, puis réinscris. Si une résolution demande plus que de réunir deux versions (du code à réécrire), ajoute plutôt une tâche « ## Tâche N : correction » au plan.`,
        commands: ["git merge develop", `${SPAWN} engine test`, ...requeue],
      };
    }
    if (refusal.cause === "failing") {
      // Deux refus rouges de suite alors que la suite de la branche est verte : la cause est hors de la branche.
      if (decisions.filter((d) => d.cause === "failing").length >= 2) {
        return {
          step,
          instruction: `${detail}. Deuxième refus rouge : ne réinscris plus et n'ajoute pas de tâche. Lis le journal cité, mets le fil en attente et dis à l'utilisateur, en mots simples, ce qui échoue et pourquoi tu penses que la branche n'en est pas la cause.`,
          commands: [`${SPAWN} story update --status blocked:decision --task "fusion refusée deux fois"`],
        };
      }
      return {
        step,
        instruction: `${detail}. Dans le worktree du fil : intègre develop, puis lance la suite. Rouge : la branche est en cause, ajoute une tâche « ## Tâche N : correction » au plan. Verte : la cause est hors de la branche (machine, test instable), réinscris une fois.`,
        commands: ["git merge develop", `${SPAWN} engine test`, ...requeue],
      };
    }
    return {
      step,
      instruction: `${detail}. Corriger par une tâche ajoutée à la fin du plan (« ## Tâche N : correction … »), puis réinscrire.`,
      commands: [`${SPAWN} merge status`, `${SPAWN} next`],
    };
  }

  return {
    step: "fusion",
    instruction: "Inscrire la branche dans la file de fusion et lire le verdict : fusionnée (code 0, notée au ledger par l'outil) ou refusée avec sa cause et son premier geste (code 1), à corriger avant de réinscrire.",
    commands: [`${SPAWN} story update --status done --task fusion`, `${SPAWN} merge --summary "<titre court de la feature>"`],
    proof: "verdict merged",
  };
}

// Sous le service, l'enchaîneur fait les étapes automatiques entre deux tours (SPAWN_RUNNER=service) : l'orchestrateur
// s'arrête au lieu de les enchaîner lui-même (essai du 18/11 : 137 appels opus pour ces gestes).
export const RUNNER_ENV = "SPAWN_RUNNER";

export function renderAction(a: Action): string {
  if (a.run && process.env[RUNNER_ENV] === "service") {
    return [
      `étape : ${a.step}`,
      "faire : l'outil fait cette étape seul, après ton tour (enchaîneur du service). Termine ton tour maintenant, sans rien faire d'autre ni relancer next : il te rendra la main avec le résultat.",
    ].join("\n");
  }
  return [
    `étape : ${a.step}`,
    `faire : ${a.instruction}`,
    ...(a.commands.length > 0 ? ["commandes :", ...a.commands.map((c) => `  ${c}`)] : []),
    ...(a.proof ? [`preuve attendue : ${a.proof}`] : []),
    "règle : une commande par appel, copiée telle quelle (pas de && ni de ; entre deux commandes)",
    `ensuite : ${SPAWN} next`,
  ].join("\n");
}
