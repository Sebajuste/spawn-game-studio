// Le menu ⋯ d'un epic (docs/reglages.md §5) : Renommer…, Supprimer… (derrière la confirmation partagée). Supprimer un
// epic ne touche pas ses stories : elles restent dans leurs projets.
import { useState } from "react";
import type { Api, EpicView } from "../shared/api.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { MenuButton } from "../shared/MenuButton.tsx";
import { RenameDialog } from "../shared/RenameDialog.tsx";
import { t } from "../i18n/i18n.ts";

interface Props {
  api: Api;
  workspace: string;
  epic: EpicView;
  onChanged: () => void;
  onDeleted: () => void;
}

export function EpicMenu({ api, workspace, epic, onChanged, onDeleted }: Props) {
  const [open, setOpen] = useState<"rename" | "delete" | null>(null);
  const path = `/api/workspaces/${encodeURIComponent(workspace)}/epics/${encodeURIComponent(epic.id)}`;
  return (
    <>
      <MenuButton
        title={t("object.menu")}
        items={[
          { title: t("object.rename"), action: () => setOpen("rename") },
          "-",
          { title: t("epic.delete"), danger: true, action: () => setOpen("delete") },
        ]}
      />
      {open === "rename" && (
        <RenameDialog
          title={t("epic.renameTitle", { id: epic.id })}
          value={epic.title}
          onSave={async (title) => {
            await api.call("PATCH", path, { title });
            onChanged();
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "delete" && (
        <ConfirmDialog
          title={t("epic.deleteTitle", { name: `${epic.id} ${epic.title}` })}
          consequence={t("epic.deleteConsequence", { n: epic.stories.length })}
          confirm={t("epic.deleteConfirm")}
          pending={t("settings.deleting")}
          onConfirm={async () => {
            await api.call("DELETE", path);
            onDeleted();
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
