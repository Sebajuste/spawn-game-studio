import { test } from "node:test";
import assert from "node:assert/strict";
import { withoutActions } from "./strip.ts";

test("les blocs spawn sont retirés du texte montré, le reste garde sa forme", () => {
  const text = 'Je crée la story.\n\n```spawn\n{"create": "story", "request": "x"}\n```\n\nElle te demandera sa spec.';
  assert.equal(withoutActions(text), "Je crée la story.\n\nElle te demandera sa spec.");
});

test("un bloc de code ordinaire reste, un texte fait d'un seul bloc devient vide", () => {
  assert.equal(withoutActions("Exemple :\n```ts\nconst a = 1;\n```"), "Exemple :\n```ts\nconst a = 1;\n```");
  assert.equal(withoutActions('```spawn\n{"create": "story"}\n```'), "");
});

test("un bloc pas encore fermé (réponse en cours) n'est pas montré", () => {
  assert.equal(withoutActions('Je crée l\'epic.\n```spawn\n{"create": "ep'), "Je crée l'epic.");
});
