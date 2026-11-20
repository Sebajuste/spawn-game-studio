import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FileType, FileTypesData, GitPatternsData, NewProjectData, ReadLogData } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { lines, parseErrors, Paths } from "../parse.ts";
import { workspaceDirs } from "../project.ts";
import { Failure, type Report } from "../result.ts";
import { starter } from "./example.ts";

export function readLog(o: Options, r: Report): Promise<void> {
  r.data = { lines: 0 } satisfies ReadLogData;
  const file = o.required("file");
  if (!existsSync(file)) throw new Failure("file-not-found", `journal absent : ${file}`);
  const text = readFileSync(file, "utf8");
  r.data.lines = lines(text).length;
  const project = o.text("project");
  r.errors.push(...parseErrors(text, new Paths(project, project === undefined ? new Map() : workspaceDirs(project))));
  return Promise.resolve();
}

// Gabarit minimal : une app Node sans dépendance (package.json, un serveur, un test unitaire, un test de bout en bout,
// un smoke test), et la section "node" de spawn.json que le cœur a déjà créé sans elle.
export function newProject(o: Options, r: Report): Promise<void> {
  r.data = { files: [] } satisfies NewProjectData;
  const project = o.required("project");
  const name = o.required("name");
  if (existsSync(join(project, "package.json"))) throw new Failure("project-exists", `package.json existe déjà dans ${project}`);
  const { files, node } = starter(name);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(project, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const config = join(project, "spawn.json");
  const current = existsSync(config) ? (JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>) : {};
  writeFileSync(config, `${JSON.stringify({ ...current, node }, null, 2)}\n`);
  r.data = { files: Object.keys(files) } satisfies NewProjectData;
  return Promise.resolve();
}

const TYPES: readonly FileType[] = [
  { extension: ".ts", category: "code", language: "typescript", open: "editor" },
  { extension: ".tsx", category: "code", language: "typescript", open: "editor" },
  { extension: ".mts", category: "code", language: "typescript", open: "editor" },
  { extension: ".cts", category: "code", language: "typescript", open: "editor" },
  { extension: ".js", category: "code", language: "javascript", open: "editor" },
  { extension: ".jsx", category: "code", language: "javascript", open: "editor" },
  { extension: ".mjs", category: "code", language: "javascript", open: "editor" },
  { extension: ".cjs", category: "code", language: "javascript", open: "editor" },
  { extension: ".rs", category: "code", language: "rust", open: "editor" },
  { extension: ".css", category: "code", language: "css", open: "editor" },
  { extension: ".html", category: "code", language: "html", open: "editor" },
  { extension: ".json", category: "text", language: "json", open: "editor" },
  { extension: ".toml", category: "project", language: "toml", open: "editor" },
  { extension: ".yaml", category: "text", language: "yaml", open: "editor" },
  { extension: ".yml", category: "text", language: "yaml", open: "editor" },
  { extension: ".md", category: "text", language: "markdown", open: "editor" },
  { extension: ".txt", category: "text", open: "editor" },
  { extension: ".csv", category: "text", language: "csv", open: "editor" },
  { extension: ".svg", category: "image", open: "system" },
  { extension: ".png", category: "image", open: "system" },
  { extension: ".jpg", category: "image", open: "system" },
  { extension: ".jpeg", category: "image", open: "system" },
  { extension: ".webp", category: "image", open: "system" },
  { extension: ".gif", category: "image", open: "system" },
  { extension: ".ico", category: "image", open: "system" },
  { extension: ".icns", category: "image", open: "system" },
  { extension: ".mp3", category: "audio", open: "system" },
  { extension: ".wav", category: "audio", open: "system" },
  { extension: ".ogg", category: "audio", open: "system" },
  { extension: ".mp4", category: "video", open: "system" },
  { extension: ".webm", category: "video", open: "system" },
  { extension: ".ttf", category: "resource", open: "system" },
  { extension: ".otf", category: "resource", open: "system" },
  { extension: ".woff", category: "resource", open: "system" },
  { extension: ".woff2", category: "resource", open: "system" },
];

export function fileTypes(_o: Options, r: Report): Promise<void> {
  r.data = { types: [...TYPES] } satisfies FileTypesData;
  return Promise.resolve();
}

// Dépendances et sorties de construction (JavaScript et Rust) régénérées, jamais versionnées. Pas de LFS.
const GIT_PATTERNS: GitPatternsData = {
  gitignore: ["node_modules/", "dist/", "target/", ".spawn/", "*.log"],
  gitattributes: ["*.ts text eol=lf", "*.tsx text eol=lf", "*.js text eol=lf", "*.mjs text eol=lf", "*.json text eol=lf", "*.css text eol=lf", "*.md text eol=lf", "*.rs text eol=lf", "*.html text eol=lf"],
  lfs: [],
  lockable: [],
};

export function gitPatterns(_o: Options, r: Report): Promise<void> {
  r.data = { ...GIT_PATTERNS };
  return Promise.resolve();
}
