// Ajouter une story à un epic : son projet, son nom, et les stories de l'epic qu'elle attend.
import { useState } from "react";
import type { Api, EpicView } from "../shared/api.ts";
import { Dialog } from "../shared/Dialog.tsx";
import { t } from "../i18n/i18n.ts";
import { refKey } from "./epicState.ts";
import { useSubmit } from "./useSubmit.ts";

interface Props {
  api: Api;
  workspace: string;
  projects: readonly string[];
  epic: EpicView;
  projectName: (id: string) => string;
  onClose: () => void;
  onDone: () => void;
}

export function AddStoryDialog({ api, workspace, projects, epic, projectName, onClose, onDone }: Props) {
  const [project, setProject] = useState(projects[0] ?? "");
  const [story, setStory] = useState("");
  const [after, setAfter] = useState<string[]>([]);
  const { pending, error, submit } = useSubmit(
    () =>
      api.call("POST", `/api/workspaces/${encodeURIComponent(workspace)}/epics/${encodeURIComponent(epic.id)}/stories`, {
        project,
        story: story.trim(),
        blocked_by: epic.stories.filter((s) => after.includes(refKey(s))).map((s) => ({ project: s.project, story: s.story })),
      }),
    onDone,
  );
  return (
    <Dialog title={t("workspace.story.title", { epic: epic.id })} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>{t("workspace.story.project")}</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => (
              <option key={p} value={p}>
                {projectName(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("workspace.story.name")}</span>
          <input value={story} onChange={(e) => setStory(e.target.value)} autoFocus />
        </label>
        <div className="field">
          <span>{t("workspace.story.after")}</span>
          {epic.stories.length === 0 && <p className="muted">{t("workspace.story.afterNone")}</p>}
          {epic.stories.map((s) => (
            <label key={refKey(s)} className="check">
              <input type="checkbox" checked={after.includes(refKey(s))} onChange={(e) => setAfter(e.target.checked ? [...after, refKey(s)] : after.filter((x) => x !== refKey(s)))} /> {projectName(s.project)} / {s.story}
            </label>
          ))}
        </div>
        {error && <p className="alert">{error}</p>}
        <div className="actions end">
          <button type="button" className="btn" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!project || !story.trim() || pending}>
            {pending ? t("workspace.saving") : t("workspace.save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
