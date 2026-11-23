// Vérification d'un plan au moment où l'agent l'enregistre (`spawn ledger plan`) : un plan que l'outil ne sait pas lire,
// ou qui part dans une technologie étrangère au moteur, est refusé tout de suite, avec la forme attendue. Essai de nuit
// du 18/11 : un modèle local a enregistré un plan en « ### 1. » qui prévoyait HTML, CSS et JavaScript dans un projet Godot.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { planTasks } from "./next.ts";

// Langages courants d'autres plateformes : un fichier de ce type dans le plan d'un projet est une erreur de route, sauf si
// l'adaptateur du moteur déclare l'extension comme sienne.
const FOREIGN_EXTENSIONS = ["html", "htm", "css", "scss", "js", "mjs", "jsx", "ts", "tsx", "vue", "svelte", "py", "java", "kt", "rb", "php", "go", "rs", "swift"];

export function planDefects(text: string, engineExtensions: readonly string[], engine: string, product = "projet"): string[] {
  const defects: string[] = [];
  if (planTasks(text).length === 0) {
    defects.push("aucune tâche lisible : chaque tâche commence par un titre exact « ## Tâche N : <titre> » (N = 1, 2, 3…), pas « ### 1. » ni une liste");
  }
  const known = new Set(engineExtensions.map((e) => e.replace(/^\./, "").toLowerCase()));
  const foreignFiles = new Set<string>();
  for (const m of text.matchAll(/(^|[^\w:./\\-])([\w.-][\w./\\-]*\.([a-z0-9]{1,6}))\b/gim)) {
    // Seuls les chemins du projet (relatifs) comptent : un chemin absolu désigne un outil, comme la commande de preuve
    // `node "C:\…\kit\core\src\cli.ts" moteur test` que le plan doit citer (essai 4 de la nuit : faux refus).
    const path = m[2] ?? "";
    const ext = (m[3] ?? "").toLowerCase();
    // Le mot entier, depuis l'espace, le guillemet ou l'accent grave qui le précède : un « + » dans le chemin du runtime
    // (`0.1.0+ffd3f6c\kit\…\cli.ts`) faisait repartir la recherche au milieu (essai du 19/11 : plan refusé 6 fois).
    const start = (m.index ?? 0) + (m[1] ?? "").length;
    const word = text.slice(Math.max(text.lastIndexOf(" ", start), text.lastIndexOf('"', start), text.lastIndexOf("`", start), text.lastIndexOf("\n", start)) + 1, start + path.length);
    if (/^([A-Za-z]:[\\/]|[\\/~])/.test(word)) continue;
    if (FOREIGN_EXTENSIONS.includes(ext) && !known.has(ext)) foreignFiles.add(path);
  }
  if (foreignFiles.size > 0) {
    // Le message nomme les fichiers fautifs : un modèle corrige ce qu'on lui montre, pas une liste d'extensions.
    defects.push(
      `${[...foreignFiles].slice(0, 6).join(", ")} : fichiers d'une autre plateforme ; ce projet est un ${product} ${engine}, tout se fait avec ses fichiers (${[...known].slice(0, 8).map((e) => `.${e}`).join(", ") || "voir CLAUDE.md"}). Remplace-les dans le plan, d'après CLAUDE.md et knowledge/organization.md`,
    );
  }
  return defects;
}

export function readPlan(dir: string, path: string): string | null {
  const absolute = join(dir, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
}

// Preuve de chaque exigence, décidée au cadrage et validée par l'utilisateur. Essai du 18/11 (Spawn sur Spawn) : rien
// ne disait comment prouver « le menu s'intitule Projet », et l'agent a bâti un pilote d'Edge pour tester un libellé.
// La spec fixe la preuve ; le plan n'écrit un test que là où elle en prévoit un.
export const PROOFS = ["test", "bout en bout", "capture", "aucune"] as const;
const TESTED: readonly string[] = ["test", "bout en bout"];

export type Requirement = { id: string; proof: string | null };

function idPattern(tag: string | undefined): string {
  return tag ?? "[A-Z][A-Z0-9]{1,5}";
}

// Une exigence est un élément de liste qui commence par son identifiant (« - **SGS-31** … Preuve : capture. »).
export function specRequirements(text: string, tag?: string): Requirement[] {
  const line = new RegExp(`^\\s*[-*]\\s*(?:\\*\\*)?(${idPattern(tag)}-\\d+)\\b(.*)$`, "gm");
  return [...text.matchAll(line)].map((m) => {
    const proof = /preuve\s*:\s*\**\s*([a-zà-ÿ ]+?)\s*\**\s*(?:[.;,(]|$)/i.exec(m[2] ?? "");
    return { id: m[1] ?? "", proof: proof ? (proof[1] ?? "").trim().toLowerCase() : null };
  });
}

export function specDefects(text: string, tag?: string): string[] {
  const requirements = specRequirements(text, tag);
  const form = `chaque exigence est un élément de liste « - **${tag ?? "TAG"}-NN** <phrase observable>. Preuve : <${PROOFS.join(" | ")}>. »`;
  if (requirements.length === 0) return [`aucune exigence lisible : ${form}`];
  const defects: string[] = [];
  const missing = requirements.filter((r) => r.proof === null).map((r) => r.id);
  if (missing.length > 0) defects.push(`${missing.join(", ")} : preuve absente ; ${form}`);
  for (const r of requirements) {
    if (r.proof !== null && !(PROOFS as readonly string[]).includes(r.proof)) {
      defects.push(`${r.id} : preuve « ${r.proof} » inconnue, attendu ${PROOFS.join(", ")}. Un test qui demanderait un outillage absent du projet ne s'invente pas : écris la preuve possible avec l'existant et dis, dans la spec, ce qu'un test demanderait ; l'utilisateur tranche en validant`);
    }
  }
  defects.push(...existingDefects(text));
  return defects;
}

// Une section « ## Titre » (ou « ### Titre »), titre compris, jusqu'au titre suivant de même niveau ou plus haut.
export function specSection(text: string, title: string): string | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^#{2,3}\\s+${title}\\s*$`, "i").test(l.trim()));
  if (start < 0) return null;
  const level = /^#+/.exec(lines[start]?.trim() ?? "")?.[0].length ?? 2;
  const end = lines.findIndex((l, i) => i > start && (/^#+/.exec(l)?.[0].length ?? 99) <= level);
  return lines.slice(start, end < 0 ? lines.length : end).join("\n").trim();
}

// Inventaire de l'existant, fait avant d'écrire la spec. Nuit du 22 au 23/11 : un scatter réécrit dans la démo alors que
// l'addon terrain en avait un. Chaque besoin nomme le composant étendu (un chemin), ou dit qu'il n'y en a pas et où on a
// cherché : l'utilisateur le voit en validant, l'implémenteur le reçoit dans son brief.
const PATH_LIKE = /[\w.-]+[/\\][\w./\\-]+|[\w-]+\.[a-z0-9]{1,6}\b/i;

function existingDefects(text: string): string[] {
  const form = "un élément de liste par besoin : le composant qui existe et qu'on étend, avec son chemin, ou « rien d'existant (cherché : <dossiers, dépôts>) »";
  const section = specSection(text, "Existant");
  if (section === null) {
    return [`section « ## Existant » absente : fais d'abord l'inventaire de ce qui existe (le projet, ses addons et bibliothèques, les dépôts que cite CLAUDE.md), puis écris-la : ${form}`];
  }
  // Une exigence (« - **TAG-NN** … ») n'est pas un élément de l'inventaire, même sans titre « Exigences » entre les deux.
  const items = section
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*]\s+\S/.test(l) && !/^\s*[-*]\s*(?:\*\*)?[A-Z][A-Z0-9]{1,5}-\d+\b/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim());
  if (items.length === 0) return [`« ## Existant » sans élément de liste : ${form}`];
  return items
    .filter((i) => !PATH_LIKE.test(i) && !/rien d.existant/i.test(i))
    .map((i) => `Existant, « ${i} » : ni chemin ni « rien d'existant » ; ${form}`);
}

// Un fichier de test cité (`menubar.test.ts`, `test_grille.gd`) ou « test d'abord » : la tâche écrit un test.
const WRITES_TEST = /test d'abord|(?:^|[\s`(/\\])[\w.-]*test[\w-]*\.[a-z0-9]{1,6}\b|[/\\]tests?[/\\][\w./\\-]+\.[a-z0-9]{1,6}\b/i;

const TASK_HEADING = /^#{2,3}\s*T[âa]che\s+(\d+)\s*[:—–-].*$/gim;

// Section « ## Tâche N » d'un plan, titre compris, jusqu'au titre de tâche suivant.
export function planSection(plan: string, task: number): string | null {
  const headings = [...plan.matchAll(TASK_HEADING)];
  const i = headings.findIndex((h) => Number(h[1]) === task);
  if (i < 0) return null;
  return plan.slice(headings[i]?.index ?? 0, headings[i + 1]?.index ?? plan.length).trim();
}

export function citedRequirements(text: string, tag?: string): string[] {
  return [...new Set(text.match(new RegExp(`\\b${idPattern(tag)}-\\d+\\b`, "g")) ?? [])];
}

// Lignes de la spec qui définissent les exigences citées, recopiées telles quelles (avec leur preuve).
export function requirementLines(spec: string, ids: readonly string[], tag?: string): string[] {
  const line = new RegExp(`^\\s*[-*]\\s*(?:\\*\\*)?(${idPattern(tag)}-\\d+)\\b.*$`, "gm");
  return [...spec.matchAll(line)].filter((m) => ids.includes(m[1] ?? "")).map((m) => m[0].trim());
}

export function planProofDefects(plan: string, spec: string, tag?: string): string[] {
  const requirements = new Map(specRequirements(spec, tag).map((r) => [r.id, r.proof]));
  const headings = [...plan.matchAll(TASK_HEADING)];
  const defects: string[] = [];
  headings.forEach((h, i) => {
    const section = plan.slice(h.index ?? 0, headings[i + 1]?.index ?? plan.length);
    const ids = citedRequirements(section, tag);
    const unknown = ids.filter((id) => !requirements.has(id));
    if (unknown.length > 0) defects.push(`tâche ${h[1]} : ${unknown.join(", ")} absente${unknown.length > 1 ? "s" : ""} de la spec validée`);
    if (WRITES_TEST.test(section) && !ids.some((id) => TESTED.includes(requirements.get(id) ?? ""))) {
      const covered = ids.filter((id) => requirements.has(id));
      defects.push(
        `tâche ${h[1]} : elle écrit un test, mais la spec validée n'en prévoit pas pour ${covered.length > 0 ? covered.map((id) => `${id} (preuve : ${requirements.get(id)})`).join(", ") : "les exigences qu'elle couvre (aucune citée)"}. Prouve comme la spec le dit, sans nouveau test ; si un test manque vraiment, arrête-toi et dis-le à l'utilisateur`,
      );
    }
  });
  return defects;
}
