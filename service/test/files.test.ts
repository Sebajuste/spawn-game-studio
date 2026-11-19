// Module files : liste tirée de git (non commités compris, puis commit de fusion), types du moteur, aperçu seulement
// s'il est vraiment affichable, fichiers servis par plages et jamais hors du projet, Ouvrir.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ledgerPath } from "../../kit/core/src/context.ts";
import { updateStory } from "../../kit/core/src/stories.ts";
import { gitOk } from "../../kit/core/src/git.ts";
import { createWorktree } from "../../kit/core/src/hooks/worktree.ts";
import { write } from "../../kit/core/src/ledger.ts";
import { tempDir, cleanDirs, spawnProject } from "../../kit/core/test/git-helper.ts";
import { filesModule, galleryModule } from "../src/modules/files.ts";
import { storiesModule } from "../src/modules/stories.ts";
import { projectsModule } from "../src/modules/projects.ts";
import { startService, type Service } from "../src/server.ts";

process.env.SPAWN_ENGINES = fileURLToPath(new URL("../../kit/core/test/adapters/", import.meta.url));
const services: Service[] = [];
after(async () => {
  for (const s of services) await s.close();
  cleanDirs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- réponses JSON lues champ par champ dans les assertions
type Body = Record<string, any>;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

test("touched files: worktree git, engine types, real previews, captures, ranges, access bounded to the project, Open", async () => {
  const opened: string[] = [];
  const s = await startService({ modules: [projectsModule, storiesModule, filesModule({ open: (c) => opened.push(c) }), galleryModule], log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return r;
  };
  for (const m of ["stories", "files", "gallery"]) await api("PUT", `/api/modules/${m}`, { active: true });

  const root = spawnProject();
  const id = ((await (await api("POST", "/api/projects", { dir: root })).json()) as Body).id as string;
  const wt = await createWorktree({ cwd: root, name: "grille" }, { log: () => {} });
  mkdirSync(join(wt, "core", "grille"), { recursive: true });
  writeFileSync(join(wt, "core", "grille", "grille.fx"), "code factice\n");
  writeFileSync(join(wt, "core", "grille", "grille.scene"), "scène\n");
  gitOk(wt, ["add", "."]);
  gitOk(wt, ["commit", "-q", "-m", "grille"]);
  writeFileSync(join(wt, "core", "grille", "grille.fx"), "code factice modifié\n");
  writeFileSync(join(wt, "fond.png"), PNG);
  writeFileSync(join(wt, "intro.ogv"), "theora");
  writeFileSync(join(wt, "binaire.fx"), Buffer.from([0x41, 0x00, 0x42]));
  mkdirSync(join(root, ".spawn", "captures", "grille"), { recursive: true });
  writeFileSync(join(root, ".spawn", "captures", "grille", "vide.png"), PNG);

  const list = (await (await api("GET", `/api/projects/${id}/stories/grille/files`)).json()) as Body;
  assert.equal(list.source, "worktree");
  const by = Object.fromEntries((list.files as Body[]).map((f) => [f.path, f]));
  assert.deepEqual(Object.keys(by).sort(), ["binaire.fx", "core/grille/grille.fx", "core/grille/grille.scene", "fond.png", "intro.ogv"]);
  assert.equal(by["core/grille/grille.fx"]?.state, "added", "écart avec la base, commits et non commités");
  assert.equal(by["core/grille/grille.fx"]?.category, "code", "type donné par l'adaptateur de moteur");
  assert.equal(by["core/grille/grille.fx"]?.language, "fake");
  assert.equal(by["core/grille/grille.fx"]?.preview, "text");
  assert.equal(by["fond.png"]?.state, "untracked");
  assert.equal(by["fond.png"]?.preview, "image");
  assert.equal(by["intro.ogv"]?.preview, null, "Theora : WebView2 ne le lit pas, seulement Ouvrir");
  assert.equal(by["binaire.fx"]?.preview, null, "un « code » binaire n'est pas montré comme du texte");
  assert.deepEqual((list.captures as Body[]).map((c) => [c.name, c.access]), [["vide.png", ".spawn/captures/grille/vide.png"]]);

  // Le fichier, entier puis par plage ; le jeton peut venir de l'URL (balises <img>, <video>).
  const access = encodeURIComponent(by["fond.png"]?.access as string);
  const whole = await fetch(`http://127.0.0.1:${s.port}/api/projects/${id}/file?path=${access}&token=${s.token}`);
  assert.equal(whole.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), PNG);
  const range = await api("GET", `/api/projects/${id}/file?path=${access}`, undefined, { range: "bytes=1-3" });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), `bytes 1-3/${PNG.length}`);
  assert.equal(Buffer.from(await range.arrayBuffer()).toString("latin1"), "PNG");

  const outside = tempDir("dehors");
  writeFileSync(join(outside, "secret.txt"), "x");
  const rel = encodeURIComponent(join("..", outside.split(/[\\/]/).at(-1) ?? "", "secret.txt"));
  assert.equal((await api("GET", `/api/projects/${id}/file?path=${rel}`)).status, 403);
  assert.equal((await api("GET", `/api/projects/${id}/file?path=${encodeURIComponent(join(outside, "secret.txt"))}`)).status, 400);
  assert.equal((await api("GET", `/api/projects/${id}/file?path=absent.png`)).status, 404);

  assert.equal((await api("POST", `/api/projects/${id}/open`, { access: by["intro.ogv"]?.access })).status, 200);
  assert.match(opened[0] ?? "", /intro\.ogv$/);
  assert.equal((await api("POST", `/api/projects/${id}/open`, { access: rel ? decodeURIComponent(rel) : "" })).status, 403);

  // Story finie, worktree parti : la liste vient du commit de fusion noté au ledger.
  const head = gitOk(wt, ["rev-parse", "HEAD"]);
  write(ledgerPath(root, "grille"), { date: new Date().toISOString(), type: "merged", commit: head });
  gitOk(root, ["worktree", "remove", "--force", wt]);
  updateStory(root, "grille", { worktree: null });
  const done = (await (await api("GET", `/api/projects/${id}/stories/grille/files`)).json()) as Body;
  assert.equal(done.source, "merge");
  assert.deepEqual((done.files as Body[]).map((f) => f.path).sort(), ["core/grille/grille.fx", "core/grille/grille.scene"]);

  await api("PUT", "/api/modules/files", { active: false });
  assert.equal((await api("GET", `/api/projects/${id}/stories/grille/files`)).status, 404);
  const states = (await (await api("GET", "/api/modules")).json()) as Body[];
  assert.equal(states.find((e) => e.id === "gallery")?.active, false, "la galerie s'éteint avec les fichiers");
  await api("PUT", "/api/modules/files", { active: true });
});
