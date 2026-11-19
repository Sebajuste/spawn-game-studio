// Hooks des sous-agents : `node agents.ts reserve|start|stop`, entrée JSON sur stdin.
// `reserve` (PreToolUse sur Agent) échoue fermé comme le périmètre : seule la sortie 2 bloque.
// `start` et `stop` ne bloquent jamais : un registre en panne ne doit pas arrêter un agent déjà lancé.

const action = process.argv[2];

function exit(message: string, code: number): never {
  process.stderr.write(`[spawn] ${message}\n`);
  process.exit(code);
}

try {
  const { readInput } = await import("./input.ts");
  const input = await readInput<{ cwd: string; tool_use_id?: string; agent_id?: string; agent_type?: string }>();
  const { contextOf } = await import("../context.ts");
  const ctx = contextOf(input.cwd);
  if (ctx !== null) {
    const registry = await import("../agents.ts");
    const root = ctx.project.root;
    if (action === "reserve") {
      const d = registry.reserve(root, ctx.project.config.limits.parallel_agents, input.tool_use_id ?? `${Date.now()}`);
      if (!d.allowed) exit(d.reason, 2);
    } else if (action === "start") {
      // Les agents internes de Claude Code (suggestions, /btw) arrivent sans type : ils ne comptent pas.
      if (input.agent_id && input.agent_type) registry.start(root, { agent_id: input.agent_id, agent_type: input.agent_type, story: ctx.story });
    } else if (action === "stop") {
      if (input.agent_id) registry.stop(root, input.agent_id);
    } else exit(`action inconnue : ${String(action)}`, action === "reserve" ? 2 : 1);
  }
} catch (e) {
  exit(`registre des sous-agents en panne : ${(e as Error).message}`, action === "reserve" ? 2 : 1);
}
