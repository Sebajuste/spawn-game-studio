// Types du contrat des adaptateurs de moteur (kit/engine-contract.md), partagés avec l'app.
// Le schéma JSON équivalent est kit/core/schemas/adapter-result.v1.json.

export const CONTRACT_VERSION = 1;

export const SUBCOMMANDS = [
  "prerequisites",
  "new-project",
  "prepare-worktree",
  "compile",
  "test",
  "smoke-test",
  "capture",
  "launch",
  "read-log",
  "file-types",
  "git-patterns",
  "example",
  "detect",
  "adopt",
] as const;
export type Subcommand = (typeof SUBCOMMANDS)[number];

export const SCENARIOS = [
  "healthy",
  "code-error",
  "runtime-error",
  "failing-test",
  "test-not-loaded",
  "no-tests",
  "invalid-scene",
  "no-main-scene",
  "empty-main-scene",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const FILE_CATEGORIES = [
  "code",
  "scene",
  "resource",
  "shader",
  "image",
  "model-3d",
  "audio",
  "video",
  "project",
  "text",
] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export const OPEN_WITH = ["engine", "editor", "system"] as const;
export type OpenWith = (typeof OPEN_WITH)[number];

export interface Diagnostic {
  code: string;
  message: string;
  file?: string;
  line?: number;
}

export interface Artifact {
  path: string;
  role: string;
  type: string;
}

export interface AdapterResult<D = Record<string, unknown>> {
  contract: 1;
  engine: string;
  command: string;
  ok: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  artifacts: Artifact[];
  log: string | null;
  duration_ms: number;
  data: D;
}

// Vocabulaire du domaine que l'adaptateur sert (jeu vidéo pour Godot) : le cœur ne nomme ni « jeu », ni « scène
// principale », ni « joueur » ; il prend ces mots ici, ou des mots neutres si l'adaptateur n'en donne pas (D9).
export interface AdapterDomain {
  product: string;
  entry: string;
  user: string;
  // Rappel du cadre technique, ajouté aux étapes où un agent choisit sa technologie (spec, plan).
  framing?: string;
}

// Vérifications de la suite de contrat qu'un adaptateur peut déclarer sans objet pour son moteur (§1) : les scénarios
// d'échec du §5 (un moteur sans scènes n'a ni `invalid-scene` ni `empty-main-scene`) et `new-project`.
export type NotApplicable = "new-project" | Exclude<Scenario, "healthy">;
export const NOT_APPLICABLE: readonly NotApplicable[] = ["new-project", ...SCENARIOS.filter((s): s is Exclude<Scenario, "healthy"> => s !== "healthy")];

export interface AdapterDescriptor {
  contract: 1;
  engine: string;
  // Nom du moteur montré à une personne ; sans lui, `engine`.
  title?: string;
  command: string[];
  domain?: AdapterDomain;
  not_applicable?: NotApplicable[];
}

// Codes de sortie (contrat §3).
export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

// Données par sous-commande.

export interface PrerequisiteTool {
  name: string;
  present: boolean;
  version: string | null;
  path: string | null;
}

export interface PrerequisitesData {
  executable: string | null;
  version: string | null;
  expected_version: string | null;
  tools: PrerequisiteTool[];
}

export interface NewProjectData {
  files: string[];
}

export interface PrepareWorktreeData {
  cache: "none" | "copy" | "shared";
}

export interface CompileData {
  files_checked: number;
  scenes_checked: number;
}

export interface TestData {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  // Fichiers de test (relatifs) qui chargent la scène principale : les tests de bout en bout.
  end_to_end: string[];
}

// `scene` null : le projet ne déclare pas de scène principale.
export interface SmokeTestData {
  scene: string | null;
  seconds: number;
}

export interface CaptureData {
  scene: string;
  width: number;
  height: number;
}

// `scene` null : la scène principale du projet.
export interface LaunchData {
  pid: number;
  scene: string | null;
}

export interface ReadLogData {
  lines: number;
}

export interface FileType {
  extension: string;
  category: FileCategory;
  language?: string;
  open: OpenWith;
}

export interface FileTypesData {
  types: FileType[];
}

export interface GitPatternsData {
  gitignore: string[];
  gitattributes: string[];
  lfs: string[];
  lockable: string[];
}

export interface ExampleData {
  scene: string;
}

export interface DetectData {
  match: boolean;
  version: string | null;
  // Fichier relatif qui a fait reconnaître le projet.
  evidence: string | null;
}

export const ADOPT_CHANGES = ["add", "complete"] as const;
export type AdoptChange = (typeof ADOPT_CHANGES)[number];

export interface AdoptFile {
  path: string;
  change: AdoptChange;
}

// Ce que l'adaptateur ne sait pas faire seul ; l'app le montre avant et après l'adoption.
export interface AdoptGap {
  code: string;
  message: string;
}

export interface AdoptData {
  files: AdoptFile[];
  // Section du moteur dans spawn.json après l'adoption ; null si le moteur n'en a pas.
  declared: Record<string, unknown> | null;
  gaps: AdoptGap[];
}
