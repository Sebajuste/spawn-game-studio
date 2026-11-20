// Le titre en gras à la place du marqueur \u0000 du message : l'ordre des mots dépend de la langue.
export function Bold({ text, title }: { text: string; title: string }) {
  const [before, after = ""] = text.split("\u0000");
  return (
    <>
      {before}
      <strong>{title}</strong>
      {after}
    </>
  );
}
