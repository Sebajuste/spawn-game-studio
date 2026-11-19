// Hook PreToolUse de périmètre (D2). La sortie 2 bloque l'appel, y compris en bypassPermissions ; stderr est lu
// par l'agent. Toute autre issue laisse passer l'appel (doc des hooks) : ce hook échoue donc fermé, même si un
// module ne se charge pas, d'où les imports dynamiques dans le `try`. La déclaration du plugin ajoute
// `onFailure: "block"` pour les pannes qu'il ne peut pas voir (node absent, délai dépassé).
// Hors projet Spawn, rien n'est jugé.

function block(message: string): never {
  process.stderr.write(`[spawn] ${message}\n`);
  process.exit(2);
}

try {
  const { readInput } = await import("./input.ts");
  const input = await readInput<{
    cwd: string;
    tool_name: string;
    tool_input: Record<string, unknown>;
    session_id?: string;
    scratchpad_dir?: string;
  }>();
  if (typeof input?.cwd !== "string" || typeof input.tool_name !== "string" || typeof input.tool_input !== "object" || input.tool_input === null) {
    block("entrée du hook inattendue : périmètre non vérifiable");
  }

  const { findProject } = await import("../project.ts");
  let project: ReturnType<typeof findProject>;
  try {
    project = findProject(input.cwd);
  } catch (e) {
    // Périmètre inconnu : on bloque, sauf la réparation de spawn.json elle-même.
    const target = String(input.tool_input.file_path ?? "");
    if (!/[\\/]spawn\.json$/i.test(target)) block(`périmètre inconnu, ${(e as Error).message} ; réparer spawn.json d'abord`);
    project = null;
  }

  if (project !== null) {
    const { tmpdir } = await import("node:os");
    const { currentBranch } = await import("../git.ts");
    const { decideGuard } = await import("../guard/analysis.ts");
    const verdict = decideGuard(input, {
      root: project.root,
      allowedList: [tmpdir(), ...(input.scratchpad_dir ? [input.scratchpad_dir] : [])],
      protectedBranches: ["develop", "main"],
      currentBranch,
    });
    if (!verdict.allowed) {
      const { recordRefusal } = await import("../guard/log.ts");
      recordRefusal(project.root, input, verdict.reason);
      block(`refusé par le périmètre du projet : ${verdict.reason}`);
    }
    // Boucle d'une même commande shell, d'une même session, sans autre outil entre deux : refusée, avec quoi faire à la
    // place. Tout autre appel d'outil (une modification de fichier) remet le compte à zéro.
    if (input.session_id) {
      const command = input.tool_input.command;
      const shell = typeof command === "string";
      const key = shell ? command : `${input.tool_name} ${String(input.tool_input.file_path ?? "")}`;
      const { repetition } = await import("../guard/repetitions.ts");
      const reason = repetition(project.root, input.session_id, key);
      if (reason !== null && shell) {
        const { recordRefusal } = await import("../guard/log.ts");
        recordRefusal(project.root, input, reason);
        block(reason);
      }
    }
  }
} catch (e) {
  block(`hook de périmètre en panne, appel bloqué par prudence : ${(e as Error).stack ?? String(e)}`);
}
