// Un bloc ```spawn est une demande au service, pas du texte pour l'utilisateur : la conversation montre à la place ce
// que le service en a fait. Pendant que l'agent écrit, un bloc pas encore fermé est retiré jusqu'à la fin du texte.
const BLOCK = /```spawn[ \t]*\r?\n[\s\S]*?(?:```|$)/g;

export function withoutActions(text: string): string {
  return text
    .replace(BLOCK, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
