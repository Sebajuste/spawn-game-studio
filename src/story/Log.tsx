// Onglet Journal : refus du périmètre et journal de la story.
import { useEffect, useState } from "react";
import type { Api, StoryStateDetail } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";

export function Log({ api, project, story }: { api: Api; project: string; story: string }) {
  const [detail, setDetail] = useState<StoryStateDetail | null>(null);
  useEffect(() => {
    api
      .call<StoryStateDetail>("GET", `/api/projects/${project}/stories/${story}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [api, project, story]);
  if (!detail) return <div className="scroll" />;
  return (
    <div className="scroll">
      {detail.refusals.length > 0 && (
        <section className="card">
          <h2>{t("story.refusals", { count: detail.refusals.length })}</h2>
          {detail.refusals.map((r, i) => (
            <p key={i} className="small-text">
              <code>{r.target}</code> : {r.reason}
            </p>
          ))}
        </section>
      )}
      <section className="card">
        <h2>{t("story.log", { count: detail.ledger.length })}</h2>
        {detail.ledger.length === 0 ? <p className="muted">{t("story.noEvents")}</p> : <ol className="ledger">{detail.ledger.map((l, i) => <li key={i}>{l}</li>)}</ol>}
      </section>
    </div>
  );
}
