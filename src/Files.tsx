// Fichiers touchés par la story et galerie (modules files et gallery). La liste vient du service (git) ; elle se
// recharge quand la story change ou qu'un tour de l'agent finit. Un aperçu n'est montré que si le service le dit
// affichable ; sinon, Ouvrir passe la main à l'application du système.
import { useCallback, useEffect, useState } from "react";
import type { Api, StoryCapture, StoryFiles, TouchedFile } from "./api.ts";
import { t } from "./i18n.ts";

interface Props {
  api: Api;
  events: EventSource | null;
  project: string;
  story: string;
  gallery: boolean;
}

type Choice = { access: string; preview: TouchedFile["preview"]; title: string };

const MARKS: Record<TouchedFile["state"], string> = { added: "A", modified: "M", deleted: "S", renamed: "R", untracked: "N" };
const stateTitle = (s: TouchedFile["state"]): string => t(`files.state.${s}`);
// Catégories données par l'adaptateur de moteur (contrat en anglais), dites dans la langue de l'interface ; une inconnue reste telle quelle.
const CATEGORIES = ["code", "scene", "resource", "shader", "model-3d", "project", "text", "image", "video", "audio"] as const;
const categoryLabel = (c: string): string => ((CATEGORIES as readonly string[]).includes(c) ? t(`files.category.${c as (typeof CATEGORIES)[number]}`) : c);

export function Files({ api, events, project, story, gallery }: Props) {
  const [list, setList] = useState<StoryFiles | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api.call<StoryFiles>("GET", `/api/projects/${project}/stories/${story}/files`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, project, story]);

  useEffect(() => {
    setChoice(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!events) return;
    const forMe = (e: Event) => {
      const d = JSON.parse((e as MessageEvent<string>).data) as { project: string; story?: string };
      if (d.project === project && (d.story === undefined || d.story === story)) void load();
    };
    events.addEventListener("stories", forMe);
    events.addEventListener("conversation-end", forMe);
    return () => {
      events.removeEventListener("stories", forMe);
      events.removeEventListener("conversation-end", forMe);
    };
  }, [events, project, story, load]);

  const open = async (access: string) => {
    try {
      await api.call("POST", `/api/projects/${project}/open`, { access });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!list) return null;
  const media: (StoryCapture | (TouchedFile & { access: string; preview: "image" | "video" }))[] = [
    ...list.captures,
    ...list.files.filter((f): f is TouchedFile & { access: string; preview: "image" | "video" } => f.access !== null && (f.preview === "image" || f.preview === "video")),
  ];

  return (
    <>
      {gallery && media.length > 0 && (
        <section className="card">
          <h2>{t("files.gallery", { count: media.length })}</h2>
          <div className="gallery">
            {media.map((m) => {
              const title = "name" in m ? m.name : m.path;
              return (
                <button key={m.access} className="thumb" title={title} onClick={() => setChoice({ access: m.access, preview: m.preview, title })}>
                  {m.preview === "image" ? <img src={api.fileUrl(project, m.access)} alt={title} loading="lazy" /> : <video src={api.fileUrl(project, m.access)} muted preload="metadata" />}
                  <span>{title.split("/").at(-1)}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="card">
        <h2>
          {t("files.touched", { count: list.files.length })}
          {list.source === "merge" && <span className="muted"> · {t("files.fromMerge")}</span>}
        </h2>
        {error && <div className="error-banner" onClick={() => setError(null)}>{error}</div>}
        {list.files.length === 0 ? (
          <p className="muted">{list.source === "none" ? t("files.nothing") : t("files.none")}</p>
        ) : (
          <ul className="files">
            {list.files.map((f) => (
              <li key={f.path} className={choice?.access === f.access ? "selected" : ""}>
                <span className={`state state-${f.state}`} title={stateTitle(f.state)}>
                  {MARKS[f.state]}
                </span>
                {f.access && f.preview ? (
                  <button className="link" onClick={() => setChoice({ access: f.access as string, preview: f.preview, title: f.path })}>
                    {f.path}
                  </button>
                ) : (
                  <span className={f.state === "deleted" ? "struck" : ""}>{f.path}</span>
                )}
                {f.category && <span className="muted"> {f.language ?? categoryLabel(f.category)}</span>}
                {f.access && (
                  <button className="muted mini" onClick={() => void open(f.access as string)} title={t("files.openTitle")}>
                    {t("files.open")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {choice && <Preview api={api} project={project} choice={choice} onClose={() => setChoice(null)} onOpen={() => void open(choice.access)} />}
    </>
  );
}

function Preview({ api, project, choice, onClose, onOpen }: { api: Api; project: string; choice: Choice; onClose: () => void; onOpen: () => void }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    if (choice.preview !== "text") return;
    api
      .text(project, choice.access)
      .then(setText)
      .catch((e: Error) => setText(`(${e.message})`));
  }, [api, project, choice]);
  const url = api.fileUrl(project, choice.access);
  return (
    <section className="card preview">
      <header className="preview-header">
        <strong>{choice.title}</strong>
        <span>
          <button className="muted mini" onClick={onOpen}>
            {t("files.open")}
          </button>
          <button className="muted mini" onClick={onClose}>
            {t("files.close")}
          </button>
        </span>
      </header>
      {choice.preview === "image" && <img src={url} alt={choice.title} />}
      {choice.preview === "video" && <video src={url} controls />}
      {choice.preview === "audio" && <audio src={url} controls />}
      {choice.preview === "text" && <pre>{text ?? "…"}</pre>}
    </section>
  );
}
