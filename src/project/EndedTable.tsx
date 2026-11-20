// Les stories terminées (livrées ou fermées) en tableau : titre, demande, fin, résultat.
import type { StoryView } from "../shared/api.ts";
import { since } from "../shared/time.ts";
import { t } from "../i18n/i18n.ts";

const short = (text: string) => (text.length > 70 ? `${text.slice(0, 70)}…` : text);

export function EndedTable({ stories, onOpen }: { stories: StoryView[]; onOpen: (story: string) => void }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{t("project.history.colStory")}</th>
          <th>{t("project.history.colRequest")}</th>
          <th>{t("project.history.colEnd")}</th>
          <th>{t("project.history.colResult")}</th>
        </tr>
      </thead>
      <tbody>
        {stories.map((x) => (
          <tr key={x.story} className="clickable" onClick={() => onOpen(x.story)}>
            <td>{x.title}</td>
            <td className="muted">{x.request ? `« ${short(x.request)} »` : "—"}</td>
            <td>{since(x.updated)}</td>
            <td className={x.result === "accepted" ? "ok" : "muted"}>{t(x.result === "accepted" ? "project.history.delivered" : x.result === "abandoned" ? "project.history.abandoned" : "project.history.closed")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
