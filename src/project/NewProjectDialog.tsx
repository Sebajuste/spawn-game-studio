// Nouveau projet (Ctrl+N). La création montre ses étapes au fur et à mesure (événement « creation » du service) ; un
// refus s'y affiche avec « Modifier ».
import { useEffect, useState } from "react";
import { useAction } from "../shared/action.ts";
import type { Api, KnownEngine, ProjectView } from "../shared/api.ts";
import { Dialog } from "../shared/Dialog.tsx";
import { t } from "../i18n/i18n.ts";
import { FolderField } from "./FolderField.tsx";
import "./project.css";

export function NewProjectDialog({ api, events, onClose, onCreated }: { api: Api; events: EventSource | null; onClose: () => void; onCreated: (p: ProjectView) => void }) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("C:\\Dev");
  const [engines, setEngines] = useState<KnownEngine[] | null>(null);
  const [engine, setEngine] = useState("");
  const [version, setVersion] = useState("");
  const [tag, setTag] = useState("");
  const [remote, setRemote] = useState("local");
  const [steps, setSteps] = useState<string[] | null>(null);
  const act = useAction();
  const error = act.refusal?.text ?? null;

  useEffect(() => {
    api
      .call<KnownEngine[]>("GET", "/api/engines")
      .then((m) => {
        setEngines(m);
        const first = m[0];
        if (first) setEngine(`${first.engine} ${first.version}`);
      })
      .catch(() => setEngines([]));
  }, [api]);

  const creating = steps !== null;
  useEffect(() => {
    if (!events || !creating) return;
    const onLine = (e: Event) => {
      const { line } = JSON.parse((e as MessageEvent<string>).data) as { line: string };
      setSteps((l) => [...(l ?? []), line]);
    };
    events.addEventListener("creation", onLine);
    return () => events.removeEventListener("creation", onLine);
  }, [events, creating]);

  const choice = engines?.find((m) => `${m.engine} ${m.version}` === engine);
  const ready = name.trim() && parent.trim() && (choice || /^\d+(\.\d+)*$/.test(version.trim()));

  const create = async () => {
    setSteps([]);
    const made: { p?: ProjectView } = {};
    await act.run("create", async () => {
      made.p = await api.call<ProjectView>("POST", "/api/projects/new", {
        name: name.trim(),
        parent: parent.trim(),
        engine: choice?.engine ?? "godot",
        version: choice?.version ?? version.trim(),
        ...(tag.trim() ? { tag: tag.trim() } : {}),
        remote,
      });
    });
    if (made.p) onCreated(made.p);
  };

  if (steps !== null) {
    return (
      <Dialog title={t("new.creating", { name: name.trim() })} onClose={() => error && onClose()}>
        <ol className="creation-steps">
          {steps.map((l, i) => (
            <li key={i} className="done">
              {l}
            </li>
          ))}
          {!error && <li className="running">…</li>}
        </ol>
        {error && (
          <>
            <div className="error-banner">{error}</div>
            <div className="actions end">
              <button className="btn" onClick={() => setSteps(null)}>
                {t("dialog.edit")}
              </button>
              <button className="btn" onClick={onClose}>
                {t("dialog.close")}
              </button>
            </div>
          </>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog title={t("new.title")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void create();
        }}
      >
        <label className="field">
          <span>{t("new.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("new.namePlaceholder")} autoFocus />
        </label>
        <label className="field">
          <span>{t("new.parent")}</span>
          <FolderField value={parent} onChange={setParent} title={t("new.parentPick")} />
        </label>
        <label className="field">
          <span>{t("new.engine")}</span>
          {engines && engines.length > 0 ? (
            <select value={engine} onChange={(e) => setEngine(e.target.value)}>
              {engines.map((m) => (
                <option key={`${m.engine} ${m.version}`} value={`${m.engine} ${m.version}`} title={m.executable}>
                  {m.engine === "godot" ? "Godot" : m.engine} {m.version}
                </option>
              ))}
            </select>
          ) : (
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder={t("new.engineVersion")} />
          )}
        </label>
        <details>
          <summary>{t("new.advanced")}</summary>
          <label className="field">
            <span>{t("new.tag")}</span>
            <input value={tag} onChange={(e) => setTag(e.target.value.toUpperCase())} placeholder={t("new.tagPlaceholder")} />
          </label>
          <label className="field">
            <span>{t("new.remote")}</span>
            <select value={remote} onChange={(e) => setRemote(e.target.value)}>
              <option value="local">{t("new.remoteLocal")}</option>
              <option value="none">{t("new.remoteNone")}</option>
            </select>
          </label>
        </details>
        <div className="actions end">
          <button type="button" className="btn" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!ready || act.pending !== null}>
            {act.pending === "create" ? t("new.pending") : t("new.create")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
