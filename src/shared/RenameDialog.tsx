// Renommer un objet qui n'a pas de titre éditable sur place (un epic) : un champ, Entrée enregistre, Échap annule.
import { useCallback, useState } from "react";
import { t } from "../i18n/i18n.ts";
import { label, Refusal, useAction } from "./action.ts";
import { Dialog } from "./Dialog.tsx";
import { useEscape } from "./useEscape.ts";

export function RenameDialog({ title, value, onSave, onClose }: { title: string; value: string; onSave: (v: string) => Promise<unknown>; onClose: () => void }) {
  const [text, setText] = useState(value);
  const act = useAction();
  const cancel = useCallback(() => {
    if (act.pending === null) onClose();
  }, [act.pending, onClose]);
  useEscape(true, cancel);
  const next = text.trim();
  return (
    <Dialog title={title} onClose={cancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (next && next !== value) void act.run("rename", () => onSave(next)).then((ok) => ok && onClose());
        }}
      >
        <label className="field">
          <input value={text} autoFocus onChange={(e) => setText(e.target.value)} />
        </label>
        <Refusal action={act} k="rename" />
        <div className="actions end">
          <button type="button" className="btn" onClick={cancel}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!next || next === value || act.pending !== null}>
            {label(act, "rename", t("object.rename.save"), t("object.rename.saving"))}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
