// Un champ texte de réglage, enregistré à la sortie du champ (ou sur Entrée) s'il a changé ; Échap revient à la valeur
// enregistrée. Un refus s'affiche dessous et le champ garde la saisie.
import { useState } from "react";
import { Refusal, useAction } from "../shared/action.ts";

export function BlurField({ value, onSave, valid = (v) => v.length > 0 }: { value: string; onSave: (v: string) => Promise<unknown>; valid?: (v: string) => boolean }) {
  const [text, setText] = useState(value);
  const act = useAction();
  const next = text.trim();
  const save = () => {
    if (next !== value && valid(next)) void act.run("save", () => onSave(next));
  };
  return (
    <>
      <input
        value={text}
        aria-invalid={!valid(next)}
        disabled={act.pending !== null}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape" && text !== value) {
            // Le premier Échap annule la saisie ; le suivant ferme la fenêtre.
            e.stopPropagation();
            setText(value);
          }
        }}
      />
      <Refusal action={act} k="save" />
    </>
  );
}
