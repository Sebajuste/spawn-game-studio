// Onglet Technique : fil, branche, worktree, agent et prochaine étape de spawn next.
import { useEffect, useState } from "react";
import type { Api, StoryDetail, StoryStateDetail } from "../shared/api.ts";
import { AGENT_NAMES } from "../project/agents.ts";
import { t } from "../i18n/i18n.ts";

export function Technical({ api, project, story, detail }: { api: Api; project: string; story: string; detail: StoryDetail }) {
  const [next, setNext] = useState<StoryStateDetail["next"]>(null);
  useEffect(() => {
    api
      .call<StoryStateDetail>("GET", `/api/projects/${project}/stories/${story}`)
      .then((d) => setNext(d.next))
      .catch(() => setNext(null));
  }, [api, project, story]);
  return (
    <div className="scroll">
      <section className="card">
        <table className="table">
          <tbody>
            <tr>
              <th>{t("story.tech.thread")}</th>
              <td>{t("story.tech.status", { story: detail.story, status: detail.status })}</td>
            </tr>
            <tr>
              <th>{t("story.tech.branch")}</th>
              <td>{detail.branch}</td>
            </tr>
            <tr>
              <th>Worktree</th>
              <td>{detail.worktree ?? t("story.tech.deleted")}</td>
            </tr>
            <tr>
              <th>{t("story.tech.agent")}</th>
              <td>{detail.agent ? AGENT_NAMES[detail.agent] : "—"}</td>
            </tr>
            {next && (
              <tr>
                <th>spawn next</th>
                <td>
                  <strong>{next.step}</strong> : {next.instruction}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
