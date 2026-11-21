// Le menu ⋯ d'une story (docs/reglages.md §5) : Renommer (F2, sur place), Abandonner… derrière la confirmation partagée.
// Une story fermée n'a plus rien à abandonner.
import { useState } from "react";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { MenuButton, type MenuItem } from "../shared/MenuButton.tsx";
import { t } from "../i18n/i18n.ts";

interface Props {
  title: string;
  closed: boolean;
  onRename: () => void;
  onAbandon: () => Promise<unknown>;
}

export function StoryMenu({ title, closed, onRename, onAbandon }: Props) {
  const [confirming, setConfirming] = useState(false);
  const items: MenuItem[] = [{ title: t("object.rename"), shortcut: "F2", action: onRename }];
  if (!closed) items.push("-", { title: t("story.abandonMenu"), danger: true, action: () => setConfirming(true) });
  return (
    <>
      <MenuButton className="btn small" title={t("object.menu")} items={items} />
      {confirming && (
        <ConfirmDialog
          title={t("story.abandonTitle", { name: title })}
          consequence={t("story.abandonConsequence")}
          confirm={t("story.abandon")}
          pending={t("story.abandoning")}
          onConfirm={onAbandon}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
