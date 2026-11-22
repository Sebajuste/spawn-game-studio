// La recette : Definition of Done, rapport de l'agent, captures, puis accepter ou demander des changements.
import { useEffect, useRef, useState } from "react";
import type { Api, StoryDetail, StoryFiles } from "../shared/api.ts";
import { label, Refusal, type Action } from "../shared/action.ts";
import { since } from "../shared/time.ts";
import { t } from "../i18n/i18n.ts";

export function Acceptance({
  api,
  project,
  story,
  detail,
  act,
  onLaunch,
  onAccept,
  onRequestChanges,
  onShowFiles,
}: {
  api: Api;
  project: string;
  story: string;
  detail: StoryDetail;
  act: Action;
  onLaunch: () => void;
  onAccept: () => Promise<boolean>;
  onRequestChanges: (m: string) => Promise<boolean>;
  onShowFiles: () => void;
}) {
  const [files, setFiles] = useState<StoryFiles | null>(null);
  const [message, setMessage] = useState("");
  const [large, setLarge] = useState<string | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    api
      .call<StoryFiles>("GET", `/api/projects/${project}/stories/${story}/files`)
      .then(setFiles)
      .catch(() => setFiles(null));
  }, [api, project, story]);
  const report = detail.acceptanceReport;
  const media = files?.captures ?? [];
  const p = detail.proof;
  // Definition of Done : chaque point avec sa source. Seul ce que l'outil a fait est « vérifié » (§0) ; la relecture
  // est le verdict d'un agent relecteur exigé par l'outil ; les captures ne sont regardées par personne avant toi.
  const points: { name: string; state: "verified" | "agent" | "none"; detail: string }[] = [
    { name: t("story.dod.compilation"), state: p ? "verified" : "none", detail: p ? p.compilation : t("story.dod.unverified") },
    { name: t("story.dod.tests"), state: p ? "verified" : "none", detail: p ? t("story.dod.passed", { tests: p.tests }) : t("story.dod.unverified") },
    { name: t("story.dod.smoke"), state: p ? "verified" : "none", detail: p ? p.launch : t("story.dod.unverified") },
    { name: t("story.dod.e2e"), state: p ? "verified" : "none", detail: p ? t("story.dod.e2eDetail", { count: p.end_to_end }) : t("story.dod.unverified") },
    { name: t("story.dod.review"), state: detail.reviewed ? "agent" : "none", detail: detail.reviewed ? t("story.dod.reviewApproved") : t("story.dod.reviewNone") },
    { name: t("story.dod.captures"), state: "none", detail: media.length > 0 ? t("story.dod.capturesUnverified") : t("story.dod.capturesNone") },
  ];
  return (
    <section className="card acceptance">
      {!p && <div className="banner orange">{t("story.dod.notDone")}</div>}
      <h2>{t("story.dod.title")}</h2>
      <table className="table proof">
        <tbody>
          {points.map((x) => (
            <tr key={x.name}>
              <td className={`mark-${x.state}`}>{x.state === "verified" ? "✓" : x.state === "agent" ? "✓" : "?"}</td>
              <td>{x.name}</td>
              <td className="muted">
                {x.detail}
                {x.state === "verified" && p && t("story.dod.verifiedBy", { since: since(p.date) })}
                {x.state === "agent" && t("story.dod.byAgent")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{t("story.report.title")}</h2>
      <p className="muted small-text">{t("story.report.note")}</p>
      <p>{report?.summary ?? t("story.report.none")}</p>
      {report?.how_to_check && (
        <>
          <h2>{t("story.howToCheck")}</h2>
          <p>{report.how_to_check}</p>
        </>
      )}
      {media.length > 0 && <h2>{t("story.capturesTitle")}</h2>}
      {media.length > 0 && (
        <div className="media-grid">
          {media.map((m) => (
            <button key={m.access} className="media" onClick={() => setLarge(large === m.access ? null : m.access)} title={m.name}>
              {m.preview === "image" ? <img src={api.fileUrl(project, m.access)} alt={m.name} /> : <video src={api.fileUrl(project, m.access)} controls muted />}
            </button>
          ))}
        </div>
      )}
      {large && (
        <div className="media-large" onClick={() => setLarge(null)}>
          <img src={api.fileUrl(project, large)} alt="" />
        </div>
      )}
      {files && (
        <p className="muted small-text">
          {t(files.files.length > 1 ? "story.files.other" : "story.files.one", { count: files.files.length })}
          <button className="link" onClick={onShowFiles}>
            {t("story.view")}
          </button>
        </p>
      )}
      <div className="actions">
        <button className="btn" disabled={act.pending !== null} onClick={onLaunch}>
          {t("story.launch")}
        </button>
        <span className="spacer" />
        <Refusal action={act} k="accept" />
        <button className="btn green" disabled={act.pending !== null} onClick={() => void onAccept()}>
          {act.pending === "accept" ? t("story.accepting") : t("story.accept")}
        </button>
      </div>
      <form
        className="reply"
        onSubmit={(e) => {
          e.preventDefault();
          if (message.trim()) void onRequestChanges(message.trim()).then((ok) => ok && setMessage(""));
        }}
      >
        <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("story.changes.placeholder")} />
        <button type="submit" className="btn" disabled={!message.trim() || act.pending !== null}>
          {label(act, "changes", t("story.requestChanges"), t("story.sending"))}
        </button>
        <Refusal action={act} k="changes" />
      </form>
    </section>
  );
}
