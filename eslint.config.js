import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // .claude/ : les worktrees des fils y vivent, chacun avec sa propre config (lus par leur propre lint).
  { ignores: ["dist/", "src-tauri/", "node_modules/", ".spawn/", ".claude/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  // Scripts du projet (spawn.json, section node) : JavaScript lancé par Node.
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly", fetch: "readonly", setTimeout: "readonly", clearTimeout: "readonly" } } },
);
