// Aperçu d'un fichier choisi : image, vidéo, son ou texte, selon ce que le service dit affichable.
import { useEffect, useState } from "react";
import type { Api, TouchedFile } from "../../shared/api.ts";
import { t } from "../../i18n/i18n.ts";

export type Choice = { access: string; preview: TouchedFile["preview"]; title: string };

export function Preview({ api, project, choice, onClose, onOpen }: { api: Api; project: string; choice: Choice; onClose: () => void; onOpen: () => void }) {
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
