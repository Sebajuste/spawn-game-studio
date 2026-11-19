import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CaptureData } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { parseLog, lines } from "../log.ts";
import { Failure, UsageError, type Report } from "../result.ts";
import { TOOLS_DIR, Session, checkProject } from "../session.ts";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((o, i) => bytes[i] !== o)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function toRes(scene: string): string {
  if (scene.startsWith("res://")) return scene;
  return `res://${scene.replaceAll("\\", "/").replace(/^\/+/, "")}`;
}

export async function capture(o: Options, r: Report): Promise<void> {
  const project = o.required("project");
  const scene = toRes(o.required("scene"));
  const output = o.required("output");
  const frames = o.integer("frames") ?? 5;
  const width = o.integer("width") ?? 640;
  const height = o.integer("height") ?? 360;
  r.data = { scene, width, height } satisfies CaptureData;
  if (!output.toLowerCase().endsWith(".png")) throw new UsageError(`--output doit finir par .png : ${output}`);

  checkProject(project);
  const rel = scene.slice("res://".length);
  if (!existsSync(join(project, rel))) throw new Failure("scene-not-found", `scène absente : ${scene}`, rel);
  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { force: true });

  const session = new Session("capture", o, r, 180, project);
  await session.importProject();
  // Pas de `--headless` : la capture exige une vraie fenêtre et un vrai rendu.
  const l = await session.run(
    ["--path", project, "--windowed", "--resolution", `${width}x${height}`, "--script", join(TOOLS_DIR, "capture.gd")],
    { user: [scene, output, String(frames)], window: true },
  );

  // Godot sort en 0 après une SCRIPT ERROR pendant le rendu : seule la relecture du journal la voit.
  for (const d of parseLog(l.output, project)) r.errors.push(d);

  const marker = lines(l.output)
    .map((x) => /^SPAWN-CAPTURE (-?\d+) (\d+)x(\d+)/.exec(x))
    .find((m) => m !== null);
  const refusal = lines(l.output).find((x) => x.startsWith("SPAWN-CAPTURE-ERROR"));
  if (refusal !== undefined) r.error("capture-failed", refusal.slice("SPAWN-CAPTURE-ERROR".length).trim());
  else if (marker === undefined || marker[1] !== "0") r.error("capture-failed", "Godot n'a pas enregistré la capture ; voir le journal");

  const size = existsSync(output) ? pngSize(new Uint8Array(readFileSync(output))) : null;
  if (size === null) {
    r.error("capture-missing", `aucune image PNG valide en ${output}`);
    return;
  }
  r.artifact(output, "capture", "png");
  if (size.width !== width || size.height !== height) {
    r.warn("size-mismatch", `capture en ${size.width}x${size.height}, demandée en ${width}x${height}`);
  }
  r.data.width = size.width;
  r.data.height = size.height;
}
