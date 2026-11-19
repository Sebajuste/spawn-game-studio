// Module files : ce qu'une story a touché, et de quoi le regarder. La liste vient de git (écart entre la base de la story
// et son worktree, non commités compris ; ou commit de fusion pour une story finie), pas des événements de l'agent : un
// fichier écrit par une commande shell compte aussi. Les types viennent de l'adaptateur de moteur (`file-types`).
//
// Les fichiers sont servis par le service, jamais hors du projet (chemin réel vérifié), avec les plages d'octets que
// demande la lecture vidéo. Un aperçu n'est proposé que si WebView2 sait vraiment l'afficher (formats relevés sur
// Edge 157 : MP4 H.264, WebM VP8/VP9/AV1 oui ; Theora, donc .ogv de Godot, et HEVC non).
import { spawn } from "node:child_process";
import { closeSync, createReadStream, existsSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { callAdapter } from "../../../kit/core/src/adapter/call.ts";
import type { FileTypesData, FileType } from "../../../kit/core/src/adapter/types.ts";
import { ledgerPath } from "../../../kit/core/src/context.ts";
import { readStory, type Story } from "../../../kit/core/src/stories.ts";
import { readDecisions } from "../../../kit/core/src/merge.ts";
import { git } from "../../../kit/core/src/git.ts";
import { readLedger } from "../../../kit/core/src/ledger.ts";
import { projectAdapter, findProject, type Project } from "../../../kit/core/src/project.ts";
import type { PreviewKind, FileState, TouchedFile, StoryFiles } from "../contract.ts";
import type { ServiceModule } from "../module.ts";
import { HttpError } from "../router.ts";
import { projectById } from "./projects.ts";

export type Opener = (path: string) => void;

// Ouverture par l'application du système (association de l'extension).
export const openWithSystem: Opener = (path) => {
  const [program, args] = process.platform === "win32" ? ["explorer.exe", [path]] : process.platform === "darwin" ? ["open", [path]] : ["xdg-open", [path]];
  spawn(program, args as string[], { detached: true, stdio: "ignore", windowsHide: false }).unref();
};

// Types connus hors moteur, quand l'adaptateur ne dit rien de l'extension.
const GENERIC: Record<string, FileType["category"]> = {
  ".md": "text", ".txt": "text", ".json": "text", ".jsonl": "text", ".yml": "text", ".yaml": "text", ".toml": "text", ".csv": "text", ".xml": "text",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image", ".svg": "image", ".bmp": "image",
  ".mp4": "video", ".webm": "video", ".ogv": "video", ".mp3": "audio", ".wav": "audio", ".ogg": "audio",
};

// Ce que WebView2 affiche vraiment.
const VIEWABLE_IMAGES = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".ico"]);
const VIEWABLE_VIDEOS = new Set([".mp4", ".webm"]);
const VIEWABLE_AUDIO = new Set([".mp3", ".wav", ".ogg", ".flac"]);
const TEXT_CATEGORIES = new Set(["code", "scene", "shader", "project", "text", "resource"]);

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".bmp": "image/bmp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac",
};

const MAX_TEXT = 512 * 1024;

function isText(path: string): boolean {
  const buffer = Buffer.alloc(8192);
  const fd = openSync(path, "r");
  try {
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return !buffer.subarray(0, read).includes(0);
  } finally {
    closeSync(fd);
  }
}

export function previewOf(path: string, category: string | null): PreviewKind | null {
  const ext = extname(path).toLowerCase();
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  if (VIEWABLE_IMAGES.has(ext)) return "image";
  if (VIEWABLE_VIDEOS.has(ext)) return "video";
  if (VIEWABLE_AUDIO.has(ext)) return "audio";
  if (category && TEXT_CATEGORIES.has(category) && statSync(path).size <= MAX_TEXT && isText(path)) return "text";
  return null;
}

const STATES: Record<string, FileState> = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "added", T: "modified" };

// Fichiers touchés par la story, relatifs à son dossier de travail.
export function touchedFiles(root: string, story: Story): { dir: string; source: StoryFiles["source"]; files: { path: string; state: FileState }[] } {
  const worktree = story.worktree ? join(root, story.worktree) : null;
  const read = (dir: string, args: string[]) => {
    const r = git(dir, ["-c", "core.quotepath=off", ...args]);
    return r.code === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : [];
  };
  const parse = (lines: string[]) =>
    lines.map((l) => {
      const [code = "", ...paths] = l.split("\t");
      return { path: (paths.at(-1) ?? "").replace(/\\/g, "/"), state: STATES[code[0] ?? "M"] ?? "modified" };
    });
  if (worktree && existsSync(worktree)) {
    const tracked = parse(read(worktree, ["diff", "--name-status", "-M", story.base]));
    const untracked = read(worktree, ["ls-files", "--others", "--exclude-standard"]).map((path) => ({ path, state: "untracked" as const }));
    return { dir: worktree, source: "worktree", files: [...tracked, ...untracked] };
  }
  // Story finie : le commit de fusion (ledger, sinon journal des fusions, qui survit au ménage), sinon la branche.
  const inLedger = readLedger(ledgerPath(root, story.story)).findLast((e) => e.type === "merged");
  const merge = inLedger?.type === "merged" ? inLedger.commit : readDecisions(root).findLast((d) => d.story === story.story && d.verdict === "merged" && d.commit)?.commit;
  const end = merge ?? (git(root, ["rev-parse", "--verify", "--quiet", story.branch]).code === 0 ? story.branch : null);
  if (!end) return { dir: root, source: "none", files: [] };
  return { dir: root, source: merge ? "merge" : "branch", files: parse(read(root, ["diff", "--name-status", "-M", story.base, end])) };
}

// Chemin demandé → chemin réel, refusé s'il sort du projet (`..`, lien, lecteur).
export function pathInProject(root: string, requested: string): string {
  if (!requested || isAbsolute(requested)) throw new HttpError(400, "chemin attendu : relatif à la racine du projet");
  const wanted = resolve(root, requested);
  if (!existsSync(wanted)) throw new HttpError(404, `fichier absent : ${requested}`);
  const real = realpathSync(wanted);
  const base = realpathSync(root);
  if (real !== base && !real.toLowerCase().startsWith((base + sep).toLowerCase())) throw new HttpError(403, "hors du projet");
  return real;
}

export function filesModule(o: { open?: Opener } = {}): ServiceModule {
  const open = o.open ?? openWithSystem;
  return {
    id: "files",
    title: "Fichiers touchés",
    description: "Ce que le fil a ajouté ou modifié (selon git), avec un aperçu quand l'app sait l'afficher, et Ouvrir sinon.",
    defaultOn: true,
    dependencies: ["stories"],
    start({ routes }) {
      // Types du moteur, demandés une fois par projet et par montage.
      const types = new Map<string, Promise<FileType[]>>();
      const typesOf = (project: Project): Promise<FileType[]> => {
        const key = project.root;
        if (!types.has(key)) {
          types.set(
            key,
            callAdapter(projectAdapter(project), "file-types", {}, { timeoutMs: 60_000 })
              .then((r) => (r.result?.ok ? (r.result.data as unknown as FileTypesData).types : []))
              .catch(() => []),
          );
        }
        return types.get(key) as Promise<FileType[]>;
      };
      const projectOf = (id: string): Project => {
        const project = findProject(projectById(id).root);
        if (project === null) throw new HttpError(409, `le projet ${id} n'est plus un projet Spawn`);
        return project;
      };

      routes.add("GET", "/api/projects/:id/stories/:story/files", async ({ params }) => {
        const project = projectOf(params.id ?? "");
        const story = readStory(project.root, params.story ?? "");
        const captures = (name: string) => {
          const dir = join(project.root, ".spawn", "captures", name);
          if (!existsSync(dir)) return [];
          return readdirSync(dir)
            .filter((f) => VIEWABLE_IMAGES.has(extname(f).toLowerCase()) || VIEWABLE_VIDEOS.has(extname(f).toLowerCase()))
            .map((f) => ({ name: f, access: relative(project.root, join(dir, f)).replace(/\\/g, "/"), preview: VIEWABLE_VIDEOS.has(extname(f).toLowerCase()) ? ("video" as const) : ("image" as const), date: statSync(join(dir, f)).mtime.toISOString() }));
        };
        if (story === null) return { source: "none", files: [], captures: captures(params.story ?? "") } satisfies StoryFiles;
        const byExtension = new Map((await typesOf(project)).map((t) => [t.extension, t]));
        const touched = touchedFiles(project.root, story);
        const files: TouchedFile[] = touched.files.map(({ path, state }) => {
          const ext = extname(path).toLowerCase();
          const type = byExtension.get(ext);
          const category = type?.category ?? GENERIC[ext] ?? null;
          const absolute = join(touched.dir, path);
          return {
            path,
            state,
            category,
            ...(type?.language ? { language: type.language } : {}),
            access: state === "deleted" ? null : relative(project.root, absolute).replace(/\\/g, "/"),
            preview: state === "deleted" ? null : previewOf(absolute, category),
          };
        });
        return { source: touched.source, files, captures: captures(story.story) } satisfies StoryFiles;
      });

      // Le fichier lui-même. Le jeton peut venir de l'URL : une balise <img> ou <video> n'envoie pas d'en-tête.
      routes.add("GET", "/api/projects/:id/file", async ({ params, url, raw, response }) => {
        const project = projectOf(params.id ?? "");
        const path = pathInProject(project.root, url.searchParams.get("path") ?? "");
        const size = statSync(path).size;
        const type = MIME_TYPES[extname(path).toLowerCase()] ?? "text/plain; charset=utf-8";
        const headers = { "content-type": type, "accept-ranges": "bytes", "access-control-allow-origin": "*", "cache-control": "no-cache" };
        const range = /^bytes=(\d*)-(\d*)$/.exec(raw.headers.range ?? "");
        if (range && size > 0) {
          const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
          const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          if (start > end || start >= size) {
            response.writeHead(416, { ...headers, "content-range": `bytes */${size}` });
            response.end();
            return;
          }
          response.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
          await pipeline(createReadStream(path, { start, end }), response);
          return;
        }
        response.writeHead(200, { ...headers, "content-length": size });
        await pipeline(createReadStream(path), response);
      });

      routes.add("POST", "/api/projects/:id/open", ({ params, body }) => {
        const project = projectOf(params.id ?? "");
        const access = (body as { access?: unknown } | null)?.access;
        if (typeof access !== "string") throw new HttpError(400, 'corps attendu : { "access": "<chemin relatif au projet>" }');
        open(pathInProject(project.root, access));
        return { opened: true };
      });
      return undefined;
    },
  };
}

export const galleryModule: ServiceModule = {
  id: "gallery",
  title: "Galerie",
  description: "Captures du fil et images ou vidéos qu'il a produites, en vignettes.",
  defaultOn: true,
  dependencies: ["files"],
  start: () => undefined,
};
