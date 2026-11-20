// Ledger d'un fil : `.spawn/ledgers/<fil>.jsonl`, un événement typé par ligne, écrit par `spawn ledger <type>`.
// Un format à respecter en prose échoue (essai du morpion, constat 4) : l'outil valide chaque champ et refuse le reste.
// L'ancien ledger en prose (`<fil>.md`) se lit encore, en événements `note`, mais ne s'écrit plus.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

// Plafond des rounds de correction quand rien d'autre n'est fourni (`spawn limits` donne celui du projet).
export const MAX_ROUNDS = 5;

export type ReviewVerdict = "clean" | "changes";
export type CapturesVerdict = "valid" | "invalid" | "undecidable";

export type LedgerEvent = { date: string } & (
  | { type: "spec-proposed"; path: string }
  | { type: "spec-approved"; path: string }
  | { type: "plan"; path: string }
  | { type: "task-started"; task: number; base: string }
  | { type: "task-done"; task: number; commits: string }
  | { type: "round"; task: number; number: number; detail: string }
  | { type: "task-parked"; task: number; detail: string; ruling: string }
  | { type: "minor"; task: number; detail: string }
  | { type: "ruling"; decision: string; reason: string; cost: string }
  | { type: "final-review"; verdict: ReviewVerdict; detail?: string }
  // `detail` : motif d'une preuve refusée par l'outil, noté par lui pour que `spawn next` donne la correction.
  | { type: "captures"; paths: string[]; verdict: CapturesVerdict; detail?: string }
  | { type: "proof"; compilation: string; tests: string; launch: string; end_to_end: string }
  | { type: "acceptance-report"; summary: string; how_to_check: string }
  | { type: "changes-requested"; message: string }
  | { type: "accepted" }
  | { type: "abandoned"; reason?: string }
  | { type: "merged"; commit: string }
  | { type: "note"; text: string }
);

export type LedgerEventType = LedgerEvent["type"];

type Kind = "text" | "integer" | "number" | "list" | readonly string[];

interface Field {
  name: string;
  kind: Kind;
  placeholder: string;
  optional?: true;
}

const t = (name: string, placeholder: string): Field => ({ name, kind: "text", placeholder });
const TASK: Field = { name: "task", kind: "integer", placeholder: "<n>" };

const FIELDS: Record<LedgerEventType, readonly Field[]> = {
  "spec-proposed": [t("path", "docs/specs/<fichier>.md")],
  // Spec validée : écrite par l'app (ou le pilote) quand l'utilisateur valide, jamais par l'agent.
  "spec-approved": [t("path", "docs/specs/<fichier>.md")],
  plan: [t("path", "docs/plans/<fichier>.md")],
  "task-started": [TASK, t("base", "<sha court>")],
  "task-done": [TASK, t("commits", "<a>..<b>")],
  round: [TASK, { name: "number", kind: "number", placeholder: "<r>" }, t("detail", "<findings traités ; commits a..b>")],
  "task-parked": [TASK, t("detail", "<ce qui reste>"), t("ruling", "<décision — raison — coût si faux>")],
  minor: [TASK, t("detail", "<finding>")],
  ruling: [t("decision", "<décision>"), t("reason", "<raison>"), t("cost", "<coût si faux>")],
  "final-review": [
    { name: "verdict", kind: ["clean", "changes"], placeholder: "clean|changes" },
    // Requis quand le verdict est `changes` (findings et commits de la correction).
    { name: "detail", kind: "text", placeholder: "<findings corrigés ; commits a..b>", optional: true },
  ],
  captures: [
    // Sans chemin : seulement pour un projet sans rien à montrer, ce que l'outil vérifie auprès de l'adaptateur.
    { name: "paths", kind: "list", placeholder: "<png> [--paths <png>]…", optional: true },
    { name: "verdict", kind: ["valid", "invalid", "undecidable"], placeholder: "valid|invalid|undecidable" },
    { name: "detail", kind: "text", placeholder: "<ce que les captures ne montrent pas>", optional: true },
  ],
  // Preuve faite par l'outil lui-même (compilation et scènes, suite, lancement, bout en bout) : jamais par l'agent.
  proof: [t("compilation", "<résultat>"), t("tests", "<réussis/total>"), t("launch", "<résultat>"), t("end_to_end", "<nombre de tests>")],
  // Compte rendu montré à l'utilisateur pour qu'il juge : ce qui a été fait, et ce qu'il doit essayer pour le vérifier.
  "acceptance-report": [t("summary", "<ce qui a été fait, en mots simples>"), t("how_to_check", "<ce qu'il faut essayer pour le vérifier>")],
  // Les trois suivants sont écrits par l'app (jugement de l'utilisateur), pas par l'agent.
  "changes-requested": [t("message", "<ce qui ne va pas>")],
  accepted: [],
  abandoned: [{ name: "reason", kind: "text", placeholder: "<raison>", optional: true }],
  merged: [t("commit", "<sha>")],
  note: [t("text", "<texte libre, en dernier recours>")],
};

export const TYPES = Object.keys(FIELDS) as LedgerEventType[];

// Événements qui disent ce que l'utilisateur a décidé : l'app les écrit, l'agent ne peut pas (essai de nuit du 18/11 :
// le modèle local a validé sa propre spec). La raison donne à l'agent le geste qui lui revient.
export const RESERVED: Partial<Record<LedgerEventType, string>> = {
  "spec-approved": "la spec est validée par l'utilisateur, pas par toi : propose-la (spawn ledger spec-proposed --path <spec>), mets le fil en attente (spawn story update --status blocked:spec-approval --task \"valider la spec\") et arrête-toi",
  "changes-requested": "une redemande vient de l'utilisateur, depuis l'app",
  accepted: "seul l'utilisateur accepte une feature, depuis l'app",
  abandoned: "seul l'utilisateur abandonne une feature, depuis l'app",
  proof: "la preuve est faite et notée par l'outil (spawn ledger captures --verdict valid la lance), jamais à la main",
  merged: "la fusion est notée par l'outil de fusion quand elle réussit (spawn merge), jamais à la main ; un refus se corrige, puis spawn merge de nouveau",
};

export class LedgerError extends Error {}

const isType = (type: string): type is LedgerEventType => Object.hasOwn(FIELDS, type);

export function shape(type: LedgerEventType, cap = MAX_ROUNDS): string {
  const fields = FIELDS[type].map((c) => {
    const placeholder = c.kind === "number" ? `<1..${cap}>` : c.placeholder;
    const value = c.kind === "text" ? `"${placeholder}"` : placeholder;
    return c.optional ? `[--${c.name} ${value}]` : `--${c.name} ${value}`;
  });
  return `spawn ledger ${type} ${fields.join(" ")}`;
}

export function shapes(cap = MAX_ROUNDS): string {
  return TYPES.map((type) => `  ${shape(type, cap)}`).join("\n");
}

// Convertit et vérifie une valeur ; `cap` null ne borne pas `number` (relecture d'un ledger déjà écrit).
function convert(field: Field, raw: unknown, cap: number | null): string | number | string[] {
  const { kind } = field;
  if (kind === "list") {
    const list = (Array.isArray(raw) ? raw : [raw]).map((v) => (typeof v === "string" ? v.trim() : ""));
    if (list.length === 0 || list.some((v) => v === "")) throw new LedgerError(`--${field.name} : au moins un chemin, aucun vide`);
    return list;
  }
  if (Array.isArray(raw)) throw new LedgerError(`--${field.name} donné plusieurs fois : une seule valeur attendue`);
  if (kind === "integer" || kind === "number") {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
    const max = kind === "number" && cap !== null ? cap : Infinity;
    if (!Number.isInteger(n) || n < 1 || n > max) {
      throw new LedgerError(`--${field.name} : entier attendu${max === Infinity ? " à partir de 1" : ` de 1 à ${max}`}, reçu « ${String(raw ?? "")} »`);
    }
    return n;
  }
  const text = typeof raw === "string" ? raw.replace(/\r?\n/g, " ").trim() : "";
  if (text === "") throw new LedgerError(`--${field.name} : texte vide`);
  if (typeof kind !== "string" && !kind.includes(text)) throw new LedgerError(`--${field.name} : ${kind.join(" ou ")} attendu, reçu « ${text} »`);
  return text;
}

// Valide un événement brut (options de la commande, ou ligne relue) : champs connus, requis, bien formés.
export function validate(type: string, values: Record<string, unknown>, date: string, cap: number | null = MAX_ROUNDS): LedgerEvent {
  if (!isType(type)) throw new LedgerError(`type d'événement inconnu : « ${type} ». Formes attendues :\n${shapes(cap ?? MAX_ROUNDS)}`);
  const fields = FIELDS[type];
  const expected = `forme attendue : ${shape(type, cap ?? MAX_ROUNDS)}`;
  const unknown = Object.keys(values).filter((k) => !fields.some((c) => c.name === k));
  if (unknown.length > 0) throw new LedgerError(`${type} : option inconnue ${unknown.map((k) => `--${k}`).join(", ")} ; ${expected}`);
  const ev: Record<string, unknown> = { date, type };
  for (const field of fields) {
    const raw = values[field.name];
    if (raw === undefined) {
      if (field.optional) continue;
      throw new LedgerError(`${type} : --${field.name} manquant ; ${expected}`);
    }
    try {
      ev[field.name] = convert(field, raw, cap);
    } catch (e) {
      throw new LedgerError(`${type} : ${(e as Error).message} ; ${expected}`, { cause: e });
    }
  }
  if (type === "final-review" && ev.verdict === "changes" && ev.detail === undefined) {
    throw new LedgerError(`final-review : --detail requis avec le verdict changes ; ${expected}`);
  }
  if (type === "captures" && ev.paths === undefined) ev.paths = [];
  return ev as LedgerEvent;
}

// Événement depuis les options de `spawn ledger <type> --option valeur…` ; une option répétée devient une liste.
export function fromOptions(type: string, options: Map<string, string[]>, cap = MAX_ROUNDS, date = new Date().toISOString()): LedgerEvent {
  const values: Record<string, unknown> = {};
  for (const [name, v] of options) values[name] = v.length === 1 ? v[0] : v;
  return validate(type, values, date, cap);
}

export const legacyPath = (path: string) => path.replace(/\.jsonl$/, ".md");

function readLegacy(path: string): LedgerEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => {
      const m = /^- (\d{4}-\d\d-\d\dT\S+) (.*)$/.exec(l);
      return { date: m?.[1] ?? "", type: "note", text: (m?.[2] ?? l.replace(/^- /, "")).trim() };
    });
}

// Ledger d'un fil : l'ancien `.md` d'abord (plus ancien), puis les événements typés. Une ligne illisible reste visible en note.
export function readLedger(path: string): LedgerEvent[] {
  const legacyEvents = readLegacy(legacyPath(path));
  if (!existsSync(path)) return legacyEvents;
  const events = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .flatMap((raw, i): LedgerEvent[] => {
      if (raw.trim() === "") return [];
      try {
        const { date, type, ...values } = JSON.parse(raw) as Record<string, unknown>;
        if (typeof date !== "string" || typeof type !== "string") throw new LedgerError("date ou type absent");
        return [validate(type, values, date, null)];
      } catch (e) {
        return [{ date: "", type: "note", text: `ligne ${i + 1} illisible (${(e as Error).message.split("\n")[0]}) : ${raw}` }];
      }
    });
  return [...legacyEvents, ...events];
}

export function write(path: string, ev: LedgerEvent): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(ev) + "\n");
}

// Rendu lisible : les verdicts gardent leurs mots français.
const REVIEW_WORDS: Record<ReviewVerdict, string> = { clean: "propre", changes: "corrections" };
const CAPTURES_WORDS: Record<CapturesVerdict, string> = { valid: "valide", invalid: "invalide", undecidable: "indecidable" };

export function render(ev: LedgerEvent): string {
  const date = ev.date ? ev.date.slice(0, 16).replace("T", " ") : "(sans date)";
  const body = ((): string => {
    switch (ev.type) {
      case "spec-proposed":
        return `spec proposée : ${ev.path}`;
      case "spec-approved":
        return `spec validée : ${ev.path}`;
      case "plan":
        return `plan : ${ev.path}`;
      case "task-started":
        return `tâche ${ev.task} lancée (base ${ev.base})`;
      case "task-done":
        return `tâche ${ev.task} terminée (commits ${ev.commits})`;
      case "round":
        return `tâche ${ev.task} round ${ev.number} : ${ev.detail}`;
      case "task-parked":
        return `tâche ${ev.task} parquée : ${ev.detail} — Ruling: ${ev.ruling}`;
      case "minor":
        return `tâche ${ev.task} mineur reporté : ${ev.detail}`;
      case "ruling":
        return `Ruling: ${ev.decision} — ${ev.reason} — coût si faux : ${ev.cost}`;
      case "final-review":
        return `relecture finale ${REVIEW_WORDS[ev.verdict]}${ev.detail ? ` : ${ev.detail}` : ""}`;
      case "captures":
        return `captures ${CAPTURES_WORDS[ev.verdict]} : ${ev.paths.length > 0 ? ev.paths.join(", ") : "rien à montrer"}${ev.detail ? ` (${ev.detail})` : ""}`;
      case "proof":
        return `preuve vérifiée par l'outil : compilation ${ev.compilation}, tests ${ev.tests}, lancement ${ev.launch}, bout en bout ${ev.end_to_end}`;
      case "acceptance-report":
        return `à juger : ${ev.summary} — vérifier : ${ev.how_to_check}`;
      case "changes-requested":
        return `redemandée : ${ev.message}`;
      case "accepted":
        return "acceptée par l'utilisateur";
      case "abandoned":
        return `abandonnée${ev.reason ? ` : ${ev.reason}` : ""}`;
      case "merged":
        return `fusion : ${ev.commit}`;
      case "note":
        return `note : ${ev.text}`;
    }
  })();
  return `${date} ${body}`;
}
