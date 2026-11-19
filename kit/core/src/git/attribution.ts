// Refus de toute attribution IA dans un message de commit (docs/kit-perimetre.md §5).
// Seules les formes d'attribution sont visées : un message peut parler de Claude Code sans s'en réclamer.
const IA = String.raw`(claude|anthropic|openai|chatgpt|gpt-?\d|copilot|gemini|codex|cursor|devin|\bai\b|\bia\b|\bllm\b)`;

const PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: new RegExp(String.raw`^\s*(co-authored-by|signed-off-by|assisted-by|generated-by|helped-by|reviewed-by)\s*:.*${IA}`, "im"),
    reason: "ligne de signature qui attribue le commit à une IA",
  },
  { pattern: /^\s*(co-authored-by|signed-off-by)\s*:.*@anthropic\.com/im, reason: "adresse @anthropic.com en signature" },
  { pattern: new RegExp(String.raw`generated (with|by)\s*\[?\s*${IA}`, "i"), reason: "mention « generated with/by » d'une IA" },
  { pattern: /🤖/u, reason: "emoji de génération automatique" },
];

export function aiAttribution(message: string): string | null {
  // Les lignes de commentaire de git (`#`) ne font pas partie du message.
  const useful = message
    .split(/\r?\n/)
    .filter((l) => !l.startsWith("#"))
    .join("\n");
  return PATTERNS.find((m) => m.pattern.test(useful))?.reason ?? null;
}
