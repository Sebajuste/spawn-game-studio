// Outil `spawn` des skills et des agents : node "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" <commande> …
// Le fil et le worktree se déduisent du dossier courant ; aucune commande ne demande de chemin du kit.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { callAdapter, type OptionValue } from "./adapter/call.ts";
import { ledgerPath, contextOf, type Context } from "./context.ts";
import { readStory, listStories, updateStory, type Status } from "./stories.ts";
import { git } from "./git.ts";
import { applyCleanup, inventory, tidyMerged } from "./cleanup.ts";
import { mergeStory, enqueue, readDecisions, readQueue, processQueue } from "./merge.ts";
import { write, LedgerError, shapes, readLedger, render, RESERVED, fromOptions, type LedgerEvent } from "./ledger.ts";
import { planDefects, planProofDefects, readPlan, specDefects } from "./plan.ts";
import { measure } from "./metrics.ts";
import { engineSettingsPath, setEngine, readEngineSettings } from "./engines.ts";
import { newGame, slug } from "./new-game.ts";
import { opencodeConfigDir, generateOpencode } from "./opencode.ts";
import { claudeAdapter } from "./agent/claude.ts";
import { opencodeAdapter } from "./agent/opencode.ts";
import { pilot } from "./pilot.ts";
import { apply, installPlan, checkPrerequisites } from "./prerequisites.ts";
import { running } from "./agents.ts";
import { createWorktree } from "./hooks/worktree.ts";
import { needsChanges, reportPath, reviewPath, finalReviewPath, finalReviewUpToDate, renderAction, relativeTo, SPAWN, nextAction, singleTaskReview, capturedRequirements, briefPath, taskBrief } from "./next.ts";
import { projectAdapter } from "./project.ts";
import { domain } from "./domain.ts";
import { readProjectSettings } from "./settings.ts";
import { recordActivity } from "./activity.ts";
import { runtimeCommand } from "./runtime.ts";
import { renderOutcome, runTasks } from "./runner.ts";

class Usage extends Error {}

const HELP = `spawn <commande>
  next [--json]                        la prochaine action exacte du fil (à refaire après chaque étape)
  story                                état du fil du worktree courant (JSON)
  story update [--status S] [--task T] [--first-step G] [--mr M]
  story list                           tous les fils du projet
  story create <nom>                   crée le fil et son worktree depuis develop (agents sans hook de worktree)
  ledger                               ledger du fil, un événement par ligne, puis son chemin
  ledger <type> [--option valeur]…     ajoute un événement typé (spawn ledger help : les formes)
  engine <sous-commande> [--opt v]…    adaptateur du moteur sur le worktree courant
  cleanup [--apply]                    worktrees sans travail : liste, puis suppression
  merge [--summary "<titre>"]          inscrit la branche du fil et rend le verdict (0 fusionnée, 1 refusée)
  merge --no-wait | process | status
  metrics [--since <date ISO>] [--json]  interventions, tokens, rounds, worktrees et branches restants
  prerequisites [--install [--yes]]    contrôle ; avec --install, plan d'installation (appliqué avec --yes)
  prerequisites --install --agent opencode [--yes]   couche OpenCode (plugin, skills, agents) dans ~/.config/opencode
  run [--agent claude-code|opencode] [--max-steps N]   enchaîne seul les tâches et leurs relectures, rend la main au jugement
  pilot <claude|opencode> --story F --intent "…" [--load]   essai sans surveillance (interventions mesurées)
  engines [set <moteur> <version> "<exécutable>"]   réglage machine des moteurs (~/.spawn/engines.json)
  limits                               limites du projet (spawn.json) et sous-agents en cours
  new-game --name N --dir D --version V [--engine godot] [--tag ABC] [--remote local|none|<url>]
  runtime status                       version active du runtime (~/.spawn/runtime) et ce qu'exécute chaque composant
  runtime install [--dry-run]          depuis le dépôt : vérifie, copie le commit, construit l'app, active la version
  runtime use <version> [--dry-run]    rend active une version installée (retour en arrière)`;

function options(args: string[]): { positionals: string[]; opts: Map<string, string[]> } {
  const positionals: string[] = [];
  const opts = new Map<string, string[]>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }
    const following = args[i + 1];
    const value = following !== undefined && !following.startsWith("--") ? (i++, following) : "";
    opts.set(a.slice(2), [...(opts.get(a.slice(2)) ?? []), value]);
  }
  return { positionals, opts };
}

// Signature d'un outil d'IA dans un message de commit : co-auteur nommé d'après un modèle ou un éditeur, ou pied « Generated with ».
const AI_NAMES = "claude|anthropic|openai|chatgpt|gpt|copilot|gemini|qwen|opencode";
const AI_ATTRIBUTION = new RegExp(`^co-authored-by:.*(${AI_NAMES})|generated with`, "im");

// Un plan s'enregistre seulement s'il est lisible par spawn next et fait pour le moteur du projet.
async function checkPlan(ctx: Context, path: string, events: readonly LedgerEvent[]): Promise<void> {
  const text = readPlan(ctx.dir, path);
  if (text === null) throw new LedgerError(`plan : ${path} introuvable dans ${ctx.dir} ; écris-le là, commite-le, puis recommence`);
  let extensions: string[] = [];
  try {
    const r = await callAdapter(projectAdapter(ctx.project), "file-types", {}, { timeoutMs: 60_000 });
    const types = (r.result?.data as { types?: { extension: string }[] } | undefined)?.types ?? [];
    extensions = types.map((t) => t.extension);
  } catch {
    // Adaptateur muet : seule la forme du plan est vérifiée.
  }
  const defects = planDefects(text, extensions, ctx.project.config.engine, domain(ctx.project).product);
  // Le plan exécute la spec validée : pas de test là où elle n'en prévoit pas.
  const approved = events.findLast((e) => e.type === "spec-approved");
  const spec = approved?.type === "spec-approved" ? readPlan(ctx.dir, approved.path) : null;
  if (spec !== null) defects.push(...planProofDefects(text, spec, ctx.project.config.tag));
  if (defects.length > 0) throw new LedgerError(`plan refusé, ${path} : ${defects.join(" ; ")}. Corrige le fichier, commite, puis relance cette commande`);
}

// La spec dit, pour chaque exigence, comment elle sera prouvée : l'utilisateur valide aussi cela.
function checkSpec(ctx: Context, path: string): void {
  const text = readPlan(ctx.dir, path);
  if (text === null) throw new LedgerError(`spec : ${path} introuvable dans ${ctx.dir} ; écris-la là, commite-la, puis recommence`);
  const defects = specDefects(text, ctx.project.config.tag);
  if (defects.length > 0) throw new LedgerError(`spec refusée, ${path} : ${defects.join(" ; ")}. Corrige le fichier, commite, puis relance cette commande`);
}

// Chaque exigence « Preuve : capture » de la spec validée a sa capture, nommée par son identifiant, sur le disque.
function checkCaptures(ctx: Context, paths: readonly string[], events: readonly LedgerEvent[]): void {
  const approved = events.findLast((e) => e.type === "spec-approved");
  if (approved?.type !== "spec-approved") return;
  const missing = capturedRequirements(ctx, approved.path).filter((id) => !paths.some((p) => basename(p).startsWith(`${id}.`) && existsSync(p)));
  if (missing.length > 0) {
    throw new LedgerError(`captures : aucune capture pour ${missing.join(", ")} (preuve « capture » dans ${approved.path}) ; attendu un fichier nommé <identifiant>.png par exigence, existant. Si l'outil ne peut pas montrer ce qu'elle promet, ne note rien et arrête-toi pour le dire à l'utilisateur`);
  }
}

// Le brief d'une tâche lancée, écrit par l'outil s'il n'existe pas déjà (une relance garde le premier).
function writeBrief(ctx: Context, task: number, events: readonly LedgerEvent[]): void {
  const spec = events.findLast((e) => e.type === "spec-approved");
  const plan = events.findLast((e) => e.type === "plan");
  if (spec?.type !== "spec-approved" || plan?.type !== "plan") return;
  const path = briefPath(ctx.project.root, requireStory(ctx), task);
  if (existsSync(path)) return;
  const text = taskBrief(ctx, spec.path, plan.path, task, events);
  if (text === null) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`brief écrit : ${path}`);
}

// Une tâche se ferme sur un verdict de relecture plus récent que le rapport, et sans toucher la spec validée (elle
// appartient à l'utilisateur). Essai de nuit du 18/11 : tâche close sans relecture, spec modifiée par l'implémenteur.
// Rien ne se note sur des fichiers non commités : ils ne sont ni relus, ni fusionnés (essai du 19/11). `paths` vide : tout
// le worktree ; sinon ces fichiers seulement.
function checkCommitted(ctx: Context, type: string, paths: string[]): void {
  const dirty = git(ctx.dir, ["status", "--porcelain", "--untracked-files=all", "--", ...paths]).stdout.split(/\r?\n/).filter(Boolean);
  if (dirty.length === 0) return;
  const shown = dirty.slice(0, 8).map((l) => l.trim()).join(" ; ");
  throw new LedgerError(`${type} : fichiers non commités dans ${ctx.dir} (${shown}${dirty.length > 8 ? ` ; ${dirty.length - 8} de plus` : ""}). Ce qui n'est pas commité n'est ni relu ni fusionné : commite-les (git add puis git commit), ou retire ceux qui ne font pas partie du travail, puis relance cette commande`);
}

async function checkTaskDone(ctx: Context, task: number, events: readonly LedgerEvent[]): Promise<void> {
  const review = reviewPath(ctx.project.root, requireStory(ctx), task);
  const report = reportPath(ctx.project.root, requireStory(ctx), task);
  if (!existsSync(review) || (existsSync(report) && statSync(review).mtimeMs < statSync(report).mtimeMs)) {
    throw new LedgerError(`task-done : aucune relecture de la tâche ${task} depuis le dernier rapport (${review} absent ou plus ancien). La relecture est faite par l'agent task-reviewer, pas par toi : lance ${SPAWN} next, il donne le prompt exact`);
  }
  if (needsChanges(readFileSync(review, "utf8"))) {
    throw new LedgerError(`task-done : le relecteur demande des corrections (${review}) ; un finding Critique ou Important n'est pas mineur. Lance ${SPAWN} next : il donne le round et le prompt de correction`);
  }
  const spec = events.findLast((e) => e.type === "spec-approved");
  const started = events.findLast((e) => e.type === "task-started" && e.task === task);
  // Aucune attribution IA dans les commits : une consigne ne suffit pas (essai du 18/11 : « Co-Authored-By: Claude »
  // ajouté par l'implémenteur malgré la sienne). Les commits de la tâche ne sont pas publiés : on les réécrit.
  if (started?.type === "task-started") {
    const log = git(ctx.dir, ["log", "--format=%H%x1f%B%x1e", `${started.base}..HEAD`]).stdout;
    const tainted = log
      .split("\x1e")
      .map((c) => c.trim().split("\x1f"))
      .filter(([, body]) => body !== undefined && AI_ATTRIBUTION.test(body))
      .map(([sha]) => (sha ?? "").slice(0, 10));
    if (tainted.length > 0) {
      throw new LedgerError(
        `task-done : attribution IA dans ${tainted.join(", ")} (Co-Authored-By, Generated with…) ; ce projet n'en veut aucune. Réécris les messages par cette commande exacte, puis relance : git -c core.editor=true rebase ${started.base} --exec "git log -1 --format=%B | grep -viE '^co-authored-by:.*(${AI_NAMES})|generated with' | git commit --amend -F -"`,
      );
    }
  }
  if (spec?.type === "spec-approved" && started?.type === "task-started") {
    const touchedFiles = git(ctx.dir, ["diff", "--name-only", `${started.base}..HEAD`]).stdout.split(/\r?\n/);
    if (touchedFiles.includes(spec.path)) {
      throw new LedgerError(`task-done : la tâche ${task} modifie la spec validée ${spec.path}, qui appartient à l'utilisateur. Annule ce changement par un nouveau commit (git checkout ${started.base} -- ${spec.path}, puis commit), puis relance cette commande`);
    }
  }
  // Une tâche ne se ferme pas sur une compilation rouge (lint compris quand le moteur le déclare) : la tâche suivante
  // en hériterait. Essai du 18/11 : lint rouge porté de tâche en tâche jusqu'à la fusion.
  const r = await callAdapter(projectAdapter(ctx.project), "compile", { project: ctx.dir }, { timeoutMs: 600_000 });
  if (!r.result?.ok) {
    const errors = r.result?.errors.map((e) => `${e.file ? `${e.file}${e.line ? `:${e.line}` : ""} ` : ""}${e.message}`) ?? [r.stderr.trim() || "sans réponse"];
    throw new LedgerError(`task-done : la compilation est rouge (${errors.slice(0, 5).join(" ; ")}${errors.length > 5 ? ` ; ${errors.length - 5} de plus` : ""}). Ce n'est pas à toi de corriger : relance l'implémenteur de cette tâche avec ces erreurs (il corrige et commite), puis relance cette commande`);
  }
}

// Preuve faite par l'outil, pas déclarée par l'agent : compilation (scripts et scènes), suite complète, smoke test de
// la scène principale, et au moins un test qui charge la scène principale. Essai de nuit du 18/11 : tout était « vert »
// alors qu'une scène était illisible et que la scène principale n'avait pas de script.
async function checkProof(ctx: Context): Promise<Extract<LedgerEvent, { type: "proof" }>> {
  const adapter = projectAdapter(ctx.project);
  const defects: string[] = [];
  const results: Record<string, Record<string, unknown>> = {};
  for (const command of ["compile", "test", "smoke-test"] as const) {
    const r = await callAdapter(adapter, command, { project: ctx.dir }, { timeoutMs: 600_000 });
    if (r.result?.ok) results[command] = r.result.data;
    if (!r.result?.ok) {
      const errors = r.result?.errors.map((e) => `${e.file ? `${e.file}${e.line ? `:${e.line}` : ""} ` : ""}${e.message}`) ?? [r.stderr.trim() || "sans réponse"];
      defects.push(`${command} : ${errors.slice(0, 5).join(" ; ")}`);
    } else if (command === "test" && ((r.result.data as { end_to_end?: string[] }).end_to_end ?? []).length === 0) {
      defects.push(`test : aucun test ne charge la ${domain(ctx.project).entry} ; ajoute un test de bout en bout qui la lance et rejoue le résultat attendu de la spec`);
    }
  }
  if (defects.length > 0) throw new LedgerError(`captures : la preuve n'est pas faite (${defects.join(" | ")})`);
  const c = results.compile ?? {};
  const t = results.test ?? {};
  const f = results["smoke-test"] ?? {};
  return {
    date: new Date().toISOString(),
    type: "proof",
    compilation: `ok (${String(c.files_checked ?? "?")} scripts, ${String(c.scenes_checked ?? "?")} scènes)`,
    tests: `${String(t.passed ?? "?")}/${String(t.total ?? "?")}`,
    launch: `ok (${String(f.scene ?? domain(ctx.project).entry)})`,
    end_to_end: String((t.end_to_end as unknown[] | undefined)?.length ?? 0),
  };
}

function requireContext(): Context {
  const ctx = contextOf(process.cwd());
  if (ctx === null) throw new Usage("pas dans un projet Spawn (aucun spawn.json à la racine du dépôt)");
  return ctx;
}

function requireStory(ctx: Context): string {
  if (ctx.story === null) throw new Usage("pas dans le worktree d'un fil (.claude/worktrees/<fil>)");
  return ctx.story;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { positionals, opts } = options(rest);
  const opt = (name: string) => opts.get(name)?.[0];

  switch (command) {
    case "story": {
      const ctx = requireContext();
      if (positionals[0] === "list") {
        console.log(JSON.stringify(listStories(ctx.project.root), null, 2));
        return 0;
      }
      if (positionals[0] === "create") {
        // Pour un agent sans hook de création de worktree (OpenCode) : même chemin que le hook WorktreeCreate.
        const wanted = positionals[1];
        if (!wanted) throw new Usage("story create <nom> : nom court en kebab-case attendu");
        const path = await createWorktree({ cwd: ctx.project.root, name: wanted });
        console.log(path);
        console.error(`ensuite : relancer la session dans ${path}`);
        return 0;
      }
      const name = requireStory(ctx);
      if (positionals[0] === "update") {
        const change: Parameters<typeof updateStory>[2] = {};
        if (opt("status") !== undefined) change.status = opt("status") as Status;
        if (opt("task") !== undefined) change.task = opt("task") ?? null;
        if (opt("first-step") !== undefined) change.first_step = opt("first-step") ?? null;
        if (opt("mr") !== undefined) change.mr = opt("mr") ?? null;
        console.log(JSON.stringify(updateStory(ctx.project.root, name, change), null, 2));
        return 0;
      }
      if (positionals.length > 0) throw new Usage(`story ${positionals[0]} : inconnu`);
      const story = readStory(ctx.project.root, name);
      if (story === null) throw new Usage(`aucun état pour le fil « ${name} »`);
      console.log(JSON.stringify(story, null, 2));
      return 0;
    }
    case "ledger": {
      const ctx = requireContext();
      const path = ledgerPath(ctx.project.root, requireStory(ctx));
      const cap = ctx.project.config.limits.rounds;
      const [type, ...extra] = positionals;
      if (type === "help") {
        console.log(`spawn ledger <type> [--option valeur]…\n${shapes(cap)}`);
        return 0;
      }
      const events = readLedger(path);
      if (type === undefined) {
        for (const ev of events) console.log(render(ev));
        if (events.length === 0) console.log("(ledger vide)");
        console.log(path);
        return 0;
      }
      try {
        const reservedReason = RESERVED[type as keyof typeof RESERVED];
        if (reservedReason) throw new LedgerError(`${type} : ${reservedReason}`);
        // Ce que l'outil sait, il le remplit : la base d'une tâche (tête du worktree), ses commits (base..tête). Un modèle
        // qui recopie un sha se trompe (essai 5 de la nuit : base lue sur develop).
        const head = () => git(ctx.dir, ["rev-parse", "HEAD"]).stdout.trim();
        if (type === "task-started" && !opts.has("base")) opts.set("base", [head()]);
        // Les commits d'une tâche : toujours ceux que git donne depuis sa base, jamais une plage recopiée.
        if (type === "task-done") {
          const n = Number(opts.get("task")?.[0]);
          const started = events.findLast((e) => e.type === "task-started" && e.task === n);
          if (started?.type === "task-started") opts.set("commits", [`${started.base.slice(0, 10)}..${head().slice(0, 10)}`]);
        }
        const given = fromOptions(type, opts, cap);
        // Les chemins des captures arrivent relatifs au worktree (consignes sans chemin absolu) : le ledger, lu depuis
        // l'app et la racine, les garde absolus.
        const ev = (given.type === "captures" ? { ...given, paths: given.paths.map((p) => resolve(ctx.dir, p)) } : given) as typeof given;
        if (ev.type === "spec-proposed") checkSpec(ctx, ev.path);
        if (ev.type === "plan") {
          // Le contenu d'abord : inutile de commiter un plan que l'outil va refuser.
          await checkPlan(ctx, ev.path, events);
          checkCommitted(ctx, "plan", [ev.path]);
        }
        if (ev.type === "task-done") {
          checkCommitted(ctx, "task-done", []);
          await checkTaskDone(ctx, ev.task, events);
        }
        // La preuve est faite ici, par l'outil, et notée avant les captures : c'est elle que l'app montre comme vérifiée.
        if (ev.type === "captures" && ev.verdict === "valid") {
          checkCaptures(ctx, ev.paths, events);
          // Une preuve refusée est notée : sans trace, `spawn next` redonnait la même étape et l'agent rejouait captures
          // et refus en boucle, le motif perdu (essai du 19/11 : une heure, ~95 next d'affilée).
          let proof: Extract<LedgerEvent, { type: "proof" }>;
          try {
            proof = await checkProof(ctx);
          } catch (e) {
            if (!(e instanceof LedgerError)) throw e;
            write(path, { date: new Date().toISOString(), type: "captures", paths: ev.paths, verdict: "invalid", detail: e.message.replace(/^captures : /, "") });
            throw new LedgerError(`${e.message}. Refus noté au ledger : lance ${SPAWN} next, il donne la tâche de correction à ajouter au plan`);
          }
          write(path, proof);
        }
        if (ev.type === "final-review" && ev.verdict === "clean") {
          const final = finalReviewPath(ctx.project.root, requireStory(ctx));
          const latest = events.findLast((e) => e.type === "task-done" || e.type === "task-parked")?.date ?? "";
          const previous = events.findLast((e) => e.type === "final-review");
          if (previous?.type === "final-review" && previous.verdict === "clean" && previous.date > latest) {
            throw new LedgerError(`final-review : la relecture finale est déjà notée propre (${previous.date}) et rien n'a changé depuis. Lance ${SPAWN} next : il donne l'étape suivante`);
          }
          const corrections = events.findLast((e) => e.type === "final-review" && e.verdict === "changes")?.date ?? "";
          const single = singleTaskReview(ctx.project.root, requireStory(ctx), events) !== null;
          if (!single && (!finalReviewUpToDate(final, latest, corrections) || needsChanges(readFileSync(final, "utf8")))) {
            throw new LedgerError(`final-review : aucun verdict « VERDICT : APPROUVÉ » à jour dans ${final}. La relecture finale est faite par l'agent task-reviewer, pas par toi : lance ${SPAWN} next, il donne le prompt exact`);
          }
        }
        // La base d'une tâche est la tête du worktree au lancement ; une autre (souvent develop, lue depuis la racine)
        // ferait relire toute la feature (essai 5 de la nuit).
        if (ev.type === "task-started") {
          // Relancer une tâche ouverte déplace sa base : sa relecture perdrait ses premiers commits (essai du 19/11 :
          // tâche 2 relancée après le round 1).
          const open = events.findLast((e) => (e.type === "task-started" || e.type === "task-done" || e.type === "task-parked") && e.task === ev.task);
          if (open?.type === "task-started") {
            throw new LedgerError(`task-started : la tâche ${ev.task} est déjà lancée (base ${open.base.slice(0, 10)}, ${open.date}) et ni terminée ni parquée. La noter de nouveau déplacerait sa base et ferait perdre ses premiers commits à la relecture. Pour une correction, c'est un round : lance ${SPAWN} next, il donne la commande exacte`);
          }
          const head = git(ctx.dir, ["rev-parse", "HEAD"]).stdout.trim();
          if (head && !head.startsWith(ev.base.trim())) {
            throw new LedgerError(`task-started : --base ${ev.base} n'est pas la tête du worktree ${ctx.dir} ; relance avec --base ${head}`);
          }
        }
        if (extra.length > 0) throw new LedgerError(`texte hors option : « ${extra.join(" ")} » ; un texte avec espaces se met entre guillemets après son option`);
        write(path, ev);
        console.log(render(ev));
        if (ev.type === "task-started") writeBrief(ctx, ev.task, events);
        // L'action suivante tout de suite : un `spawn next` de moins par étape (essai du 18/11 : 24 next pour 16 ledger).
        let following: string;
        try {
          following = renderAction(nextAction(ctx));
        } catch {
          following = `ensuite : ${SPAWN} next`;
        }
        console.log(`\naction suivante, à faire sans relancer next :\n${following}`);
      } catch (e) {
        if (!(e instanceof LedgerError)) throw e;
        console.error(`spawn ledger : ${relativeTo(ctx.dir, ctx.project.root, e.message)}`);
        return 2;
      }
      return 0;
    }
    case "engine": {
      const ctx = requireContext();
      const sub = positionals[0];
      if (!sub) throw new Usage("engine <sous-commande> : sous-commande attendue (compile, test, capture…)");
      const forwarded: Record<string, OptionValue> = {};
      for (const [name, values] of opts) {
        // Le contrat veut des chemins absolus : un chemin relatif se résout depuis le dossier courant.
        const absolutes = values.map((v) => (["output", "file", "logs"].includes(name) && v && !isAbsolute(v) ? resolve(v) : v));
        forwarded[name] = absolutes.length === 1 && absolutes[0] === "" ? true : absolutes.length === 1 ? (absolutes[0] as string) : absolutes;
      }
      if (sub !== "read-log" && forwarded.project === undefined) forwarded.project = ctx.dir;
      // Une capture prépare d'abord le worktree (import du moteur, dépendances) : idempotent par contrat, et une commande
      // de moins à donner à l'agent (essai du 18/11).
      if (sub === "capture") {
        const prep = await callAdapter(projectAdapter(ctx.project), "prepare-worktree", { project: forwarded.project as string }, { timeoutMs: 600_000 });
        if (prep.result === null || !prep.result.ok) {
          console.error(`capture : préparation du worktree en échec, aucune capture faite
${prep.result ? JSON.stringify(prep.result, null, 2) : prep.defects.join(" ; ")}`);
          return 1;
        }
      }
      const r = await callAdapter(projectAdapter(ctx.project), sub, forwarded);
      if (r.result === null) {
        console.error(`adaptateur non conforme : ${r.defects.join(" ; ")}\n${r.stderr}`);
        return 2;
      }
      // « ensuite » : la première erreur située, et la commande qui reprouvera ; un petit modèle n'a pas à le déduire.
      const firstError = r.result.errors.find((e) => e.file) ?? r.result.errors[0];
      const restart = `${SPAWN} engine ${sub}${typeof forwarded.filter === "string" ? ` --filter ${forwarded.filter}` : ""}`;
      const next = r.result.ok
        ? null
        : firstError
          ? `corriger ${firstError.file ? `${firstError.file}${firstError.line ? `:${firstError.line}` : ""} ` : ""}(${firstError.code} : ${firstError.message.slice(0, 200)}) ; puis ${restart}${r.result.errors.length > 1 ? ` (${r.result.errors.length - 1} autre(s) erreur(s) dans la sortie)` : ""}`
          : null;
      console.log(JSON.stringify({ ...r.result, ...(next ? { next } : {}) }, null, 2));
      for (const d of r.defects) console.error(`défaut de l'adaptateur : ${d}`);
      return r.result.ok ? 0 : 1;
    }
    case "next": {
      const action = nextAction(requireContext());
      console.log(opts.has("json") ? JSON.stringify(action, null, 2) : renderAction(action));
      return 0;
    }
    case "cleanup": {
      const ctx = requireContext();
      const { candidates, kept } = inventory(ctx.project.root, process.cwd());
      for (const c of candidates) console.log(`à supprimer : ${c.name} (${c.reason})`);
      for (const g of kept) console.log(`gardé : ${g.name} (${g.reason})`);
      // Fils fusionnés laissés en route (rangement interrompu) : fermés aussi.
      if (opts.has("apply")) {
        for (const f of listStories(ctx.project.root)) if (f.status !== "cleaned" && !candidates.some((c) => c.name === f.story) && tidyMerged(ctx.project.root, f.story)) console.log(`fil fusionné rangé : ${f.story}`);
      }
      if (candidates.length === 0) console.log("rien à supprimer");
      else if (opts.has("apply")) console.log(`supprimés : ${applyCleanup(ctx.project.root, candidates).join(", ")}`);
      else console.log("relancer avec --apply pour supprimer");
      return 0;
    }
    case "prerequisites": {
      if (opts.has("install") && opt("agent") === "opencode") {
        // Couche OpenCode : fichiers générés dans la config OpenCode de l'utilisateur, montrés avant écriture.
        const files = generateOpencode();
        const changes = files.filter((f) => !existsSync(f.path) || readFileSync(f.path, "utf8") !== f.content);
        for (const f of files) console.log(`${changes.includes(f) ? (existsSync(f.path) ? "modifié " : "nouveau ") : "identique"} ${f.path}`);
        if (changes.length === 0) {
          console.log("rien à installer");
          return 0;
        }
        if (!opts.has("yes")) {
          console.log("rien n'a été modifié : relancer avec --yes pour appliquer");
          return 0;
        }
        for (const f of changes) {
          mkdirSync(dirname(f.path), { recursive: true });
          writeFileSync(f.path, f.content);
        }
        console.log(`${changes.length} fichier(s) écrit(s) dans ${opencodeConfigDir()}`);
        return 0;
      }
      if (opts.has("install")) {
        const actions = installPlan(process.cwd());
        if (actions.length === 0) {
          console.log("rien à installer");
          return 0;
        }
        for (const a of actions) {
          console.log(`- ${a.description}`);
          if (a.command) console.log(`    ${a.command.program} ${a.command.args.join(" ")}   (dans ${a.command.cwd})`);
          if (a.file) console.log(`    avant :\n${a.file.before || "    (fichier absent)\n"}    après :\n${a.file.after}`);
        }
        if (!opts.has("yes")) {
          console.log("rien n'a été modifié : relancer avec --yes pour appliquer");
          return 0;
        }
        const failures = apply(actions);
        for (const e of failures) console.error(`échec : ${e}`);
        return failures.length === 0 ? 0 : 1;
      }
      const checks = await checkPrerequisites(process.cwd());
      for (const c of checks) console.log(`${c.ok ? "ok " : "KO "} ${c.name} : ${c.detail}${c.correction ? `  →  ${c.correction}` : ""}`);
      return checks.every((c) => c.ok) ? 0 : 1;
    }
    case "merge": {
      const ctx = requireContext();
      if (positionals[0] === "status") {
        for (const { entry: i } of readQueue(ctx.project.root)) console.log(`en file : ${i.story} (${i.branch} ${i.head.slice(0, 10)}, inscrite ${i.enqueued})`);
        for (const d of readDecisions(ctx.project.root).slice(-10)) console.log(`${d.date} ${d.story} ${d.verdict}${d.cause ? ` (${d.cause})` : ""}${d.commit ? ` ${d.commit.slice(0, 10)}` : ""}${d.detail ? ` : ${d.detail}` : ""}`);
        return 0;
      }
      if (positionals[0] === "process") {
        console.log(`file : ${await processQueue(ctx.project)}`);
        return 0;
      }
      if (positionals.length > 0) throw new Usage(`merge ${positionals[0]} : inconnu`);
      const story = requireStory(ctx);
      if (opts.has("no-wait")) {
        const i = enqueue(ctx.project, story, ctx.dir, opt("summary") ?? "");
        console.log(`inscrite : ${i.branch} ${i.head.slice(0, 10)} ; « spawn merge process » ou une prochaine inscription la traitera`);
        return 0;
      }
      const d = await mergeStory(ctx.project, story, ctx.dir, opt("summary") ?? "");
      // La fusion se note au ledger par l'outil, sur un verdict réel : jamais par l'agent (essai 5 de la nuit).
      if (d.verdict === "merged" && d.commit) write(ledgerPath(ctx.project.root, story), { date: new Date().toISOString(), type: "merged", commit: d.commit });
      console.log(JSON.stringify(d, null, 2));
      return d.verdict === "merged" ? 0 : 1;
    }
    case "metrics": {
      const ctx = requireContext();
      const m = measure(ctx.project.root, opt("since") ?? null);
      if (opts.has("json")) {
        console.log(JSON.stringify(m, null, 2));
        return 0;
      }
      const t = m.tokens;
      console.log(`sessions : ${m.sessions} (${m.transcripts} transcripts, sous-agents compris)`);
      console.log(`interventions de l'utilisateur : ${m.interventions.length}`);
      for (const i of m.interventions) console.log(`  ${i.date} ${i.text.replace(/\s+/g, " ").slice(0, 120)}`);
      console.log(`tokens : entrée ${t.input}, écriture cache ${t.cache_write}, lecture cache ${t.cache_read}, sortie ${t.output}`);
      for (const [model, u] of Object.entries(m.by_model)) console.log(`  ${model} : sortie ${u.output}, lecture cache ${u.cache_read}`);
      const usd = (n: number) => `${n.toFixed(2)} $`;
      console.log(`coût estimé par Claude Code (tarif API) : ${usd(m.cost.usd)} sur ${m.cost.sessions} session(s), conversation et enchaîneur`);
      for (const [model, c] of Object.entries(m.cost.by_model)) console.log(`  ${model} : ${usd(c)}`);
      if (m.cost.unmeasured.length > 0) console.log(`  non mesurés (aucun résultat, ni dans la suite de leur session) : ${m.cost.unmeasured.join(", ")}`);
      console.log(`rounds de correction : ${m.rounds} ; tâches parquées : ${m.parked_tasks}`);
      console.log(`restants : worktrees ${m.remaining_worktrees.length} [${m.remaining_worktrees.join(", ")}], branches feature ${m.remaining_feature_branches.length} [${m.remaining_feature_branches.join(", ")}]`);
      return 0;
    }
    case "limits": {
      const ctx = requireContext();
      const { agents } = running(ctx.project.root);
      console.log(JSON.stringify(ctx.project.config.limits, null, 2));
      console.log(`sous-agents en cours dans le projet : ${agents.length}/${ctx.project.config.limits.parallel_agents}`);
      return 0;
    }
    case "run": {
      const ctx = requireContext();
      requireStory(ctx);
      const name = opt("agent") ?? readProjectSettings(ctx.project.root).agent;
      const agent = name === "opencode" ? opencodeAdapter({ model: opt("model") ?? readProjectSettings(ctx.project.root).localModel, context: readProjectSettings(ctx.project.root).localContext }) : claudeAdapter();
      const stop = new AbortController();
      process.once("SIGINT", () => stop.abort());
      const outcome = await runTasks({ ctx, agent, signal: stop.signal, log: (l) => console.log(l), ...(opt("max-steps") ? { maxSteps: Number(opt("max-steps")) } : {}) });
      console.log(`
${renderOutcome(outcome, renderAction)}`);
      return outcome.reason === "handed-back" ? 0 : 1;
    }
    case "pilot": {
      const agentName = positionals[0];
      if (agentName !== "opencode" && agentName !== "claude") {
        throw new Usage("pilot <claude|opencode> --story <nom> (--intent \"<texte>\" | --intent-file <f>) [--model M] [--restarts N] [--max-hours H] [--load]");
      }
      const ctx = requireContext();
      const story = opt("story");
      const file = opt("intent-file");
      const intent = opt("intent") ?? (file ? readFileSync(file, "utf8").trim() : undefined);
      if (!story || !intent) throw new Usage("pilot : --story et --intent (ou --intent-file) sont requis");
      const model = opt("model");
      const agent =
        agentName === "opencode"
          ? opencodeAdapter({ model: model ?? readProjectSettings(ctx.project.root).localModel, load: opts.has("load"), context: Number(opt("context")) || readProjectSettings(ctx.project.root).localContext })
          : claudeAdapter(model ? { model } : {});
      console.log(`vérifications avant l'essai (${agent.name}, périmètre compris)…`);
      const problems = await agent.check(ctx.project.root);
      if (problems.length > 0) {
        for (const c of problems) console.error(`KO ${c}`);
        return 1;
      }
      console.log("prêt : essai lancé");
      // Pilote lancé : le runtime refuse d'être réinstallé ou changé jusqu'à la fin de l'essai (SGS-09).
      recordActivity("pilot", [story]);
      let report: Awaited<ReturnType<typeof pilot>>;
      try {
        report = await pilot({
          root: ctx.project.root,
          story,
          intent,
          agent,
          ...(opt("restarts") ? { restarts: Number(opt("restarts")) } : {}),
          ...(opt("max-hours") ? { maxDurationMs: Number(opt("max-hours")) * 3600_000 } : {}),
        });
      } finally {
        recordActivity("pilot", []);
      }
      console.log(JSON.stringify({ agent: report.agent, verdict: report.verdict, reason: report.reason, duration_min: report.duration_min, interventions: report.interventions.length, tokens: report.metrics?.tokens }, null, 2));
      console.log(`bilan : ${join(ctx.project.root, ".spawn", "pilot", story, "report.json")}`);
      return report.verdict === "merged" ? 0 : 1;
    }
    case "engines": {
      if (positionals[0] === "set") {
        const [, engine, version, executable] = positionals;
        if (!engine || !version || !executable) throw new Usage('engines set <moteur> <version> "<exécutable>"');
        console.log(`${engine} ${version} : ${setEngine(engine, version, executable)} (dans ${engineSettingsPath()})`);
        return 0;
      }
      if (positionals.length > 0) throw new Usage(`engines ${positionals[0]} : inconnu`);
      console.log(`${engineSettingsPath()}\n${JSON.stringify(readEngineSettings(), null, 2)}`);
      return 0;
    }
    case "new-game": {
      const name = opt("name");
      const parent = opt("dir");
      const version = opt("version");
      if (!name || !parent || !version) throw new Usage("new-game : --name, --dir et --version sont requis");
      const tag = opt("tag") ?? (slug(name).replace(/-/g, "").slice(0, 3).toUpperCase() || "JEU");
      const game = await newGame({ name, parent: resolve(parent), engine: opt("engine") ?? "godot", version, tag, remote: opt("remote") ?? "local" });
      console.log(`\njeu créé : ${game.root}${game.remote ? `\ndistant : ${game.remote}` : ""}\npréfixe d'exigences : ${tag}`);
      console.log(`ouvrir une session : cd "${game.root}" && claude --permission-mode bypassPermissions`);
      return 0;
    }
    case "runtime":
      return runtimeCommand(positionals, opts);
    case undefined:
    case "help":
    case "--help":
      console.log(HELP);
      return 0;
    default:
      // Un modèle qui invente une commande doit retrouver le chemin, pas lire toute l'aide.
      console.error(`spawn : commande inconnue : ${command}. N'invente pas de commande : lance ${SPAWN} next et fais exactement l'action qu'il donne.`);
      return 2;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  if (e instanceof Usage) {
    console.error(`spawn : ${e.message}\n\n${HELP}`);
    process.exitCode = 2;
  } else {
    console.error(`spawn : ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
