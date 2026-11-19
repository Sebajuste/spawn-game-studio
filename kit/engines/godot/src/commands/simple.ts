import { existsSync, readFileSync } from "node:fs";
import type {
  ReadLogData,
  GitPatternsData,
  PrepareWorktreeData,
  FileTypesData,
  FileType,
} from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { parseLog, lines } from "../log.ts";
import { Failure, type Report } from "../result.ts";
import { isDir, Session, checkProject } from "../session.ts";

export async function prepareWorktree(o: Options, r: Report): Promise<void> {
  r.data = { cache: "none" } satisfies PrepareWorktreeData;
  const project = o.required("project");
  checkProject(project);
  const source = o.text("source");
  if (source !== undefined && !isDir(source)) throw new Failure("source-not-found", `dossier source absent : ${source}`);
  const session = new Session("prepare-worktree", o, r, 900, project);
  await session.importProject();
}

export function readLog(o: Options, r: Report): Promise<void> {
  r.data = { lines: 0 } satisfies ReadLogData;
  const file = o.required("file");
  if (!existsSync(file)) throw new Failure("file-not-found", `journal absent : ${file}`);
  const text = readFileSync(file, "utf8");
  r.data.lines = lines(text).length;
  for (const d of parseLog(text, o.text("project"))) r.errors.push(d);
  return Promise.resolve();
}

const TYPES: readonly FileType[] = [
  { extension: ".gd", category: "code", language: "gdscript", open: "editor" },
  { extension: ".cs", category: "code", language: "csharp", open: "editor" },
  { extension: ".gdshader", category: "shader", language: "gdshader", open: "editor" },
  { extension: ".gdshaderinc", category: "shader", language: "gdshader", open: "editor" },
  { extension: ".tscn", category: "scene", open: "engine" },
  { extension: ".scn", category: "scene", open: "engine" },
  { extension: ".tres", category: "resource", open: "engine" },
  { extension: ".res", category: "resource", open: "engine" },
  { extension: ".godot", category: "project", language: "ini", open: "engine" },
  { extension: ".gdextension", category: "project", language: "ini", open: "editor" },
  { extension: ".cfg", category: "text", language: "ini", open: "editor" },
  { extension: ".import", category: "text", language: "ini", open: "editor" },
  { extension: ".uid", category: "text", open: "editor" },
  { extension: ".json", category: "text", language: "json", open: "editor" },
  { extension: ".md", category: "text", language: "markdown", open: "editor" },
  { extension: ".txt", category: "text", open: "editor" },
  { extension: ".csv", category: "text", language: "csv", open: "editor" },
  { extension: ".png", category: "image", open: "system" },
  { extension: ".jpg", category: "image", open: "system" },
  { extension: ".jpeg", category: "image", open: "system" },
  { extension: ".webp", category: "image", open: "system" },
  { extension: ".svg", category: "image", open: "system" },
  { extension: ".bmp", category: "image", open: "system" },
  { extension: ".tga", category: "image", open: "system" },
  { extension: ".exr", category: "image", open: "system" },
  { extension: ".hdr", category: "image", open: "system" },
  { extension: ".ktx", category: "image", open: "system" },
  { extension: ".glb", category: "model-3d", open: "system" },
  { extension: ".gltf", category: "model-3d", open: "system" },
  { extension: ".fbx", category: "model-3d", open: "system" },
  { extension: ".obj", category: "model-3d", open: "system" },
  { extension: ".blend", category: "model-3d", open: "system" },
  { extension: ".wav", category: "audio", open: "system" },
  { extension: ".ogg", category: "audio", open: "system" },
  { extension: ".mp3", category: "audio", open: "system" },
  { extension: ".ogv", category: "video", open: "system" },
  { extension: ".ttf", category: "resource", open: "system" },
  { extension: ".otf", category: "resource", open: "system" },
  { extension: ".woff2", category: "resource", open: "system" },
];

export function fileTypes(_o: Options, r: Report): Promise<void> {
  r.data = { types: [...TYPES] } satisfies FileTypesData;
  return Promise.resolve();
}

const LFS_BINARIES = [
  "*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp", "*.tga", "*.exr", "*.hdr", "*.ktx",
  "*.glb", "*.gltf", "*.bin", "*.fbx", "*.obj", "*.blend",
  "*.wav", "*.ogg", "*.mp3", "*.ogv",
  "*.ttf", "*.otf", "*.woff2",
  "*.scn", "*.res",
];

// `.godot/` est un cache local régénéré par l'import ; les `.uid` restent versionnés car
// les scènes y font référence. Scènes et ressources texte en LF pour rester fusionnables.
const GIT_PATTERNS: GitPatternsData = {
  gitignore: [".godot/", ".spawn/", "/android/"],
  gitattributes: [
    "*.gd text eol=lf",
    "*.tscn text eol=lf",
    "*.tres text eol=lf",
    "*.gdshader text eol=lf",
    "*.gdshaderinc text eol=lf",
    "*.godot text eol=lf",
    "*.cfg text eol=lf",
    "*.import text eol=lf",
    "*.uid text eol=lf",
    "*.gdextension text eol=lf",
  ],
  lfs: LFS_BINARIES,
  lockable: [],
};

export function gitPatterns(_o: Options, r: Report): Promise<void> {
  r.data = { ...GIT_PATTERNS };
  return Promise.resolve();
}
