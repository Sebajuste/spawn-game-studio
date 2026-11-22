// Le déroulé d'« Ajouter un projet existant » (docs/adoption.md §2) : dossier → diagnostic (rien n'est écrit) → adoption
// (journal reçu en direct, événement « adoption ») → résultat. Un refus au moment d'adopter rapporte le diagnostic
// refait : il remplace l'ancien, pour que l'utilisateur voie ce qui a changé sur le disque.
import { useEffect, useState } from "react";
import { ApiError, type AdoptionRefusal, type AdoptionView, type Api, type Diagnosis, type KnownEngine, type ProjectView } from "../shared/api.ts";
import { useAction, type Action } from "../shared/action.ts";

export type AdoptStep = "folder" | "diagnosis" | "adopting" | "done";

export interface Choice {
  engine: string;
  version: string;
  tag: string;
}

export interface Adoption {
  step: AdoptStep;
  dir: string;
  setDir: (d: string) => void;
  diagnosis: Diagnosis | null;
  choice: Choice;
  setChoice: (c: Choice) => void;
  // Versions déjà configurées sur cette machine pour le moteur choisi : des suggestions, la saisie reste libre.
  versions: string[];
  lines: string[];
  result: AdoptionView | null;
  act: Action;
  diagnose: (engine?: string) => Promise<void>;
  adopt: () => Promise<void>;
  back: () => void;
}

const VERSION = /^\d+(\.\d+)*$/;
const TAG = /^[A-Z][A-Z0-9]{1,5}$/;
export const validChoice = (c: Choice) => c.engine !== "" && VERSION.test(c.version) && TAG.test(c.tag);

export function useAdoption(api: Api, events: EventSource | null, workspace: string | null): Adoption {
  const [step, setStep] = useState<AdoptStep>("folder");
  const [dir, setDir] = useState("");
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [choice, setChoice] = useState<Choice>({ engine: "", version: "", tag: "" });
  const [known, setKnown] = useState<KnownEngine[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<AdoptionView | null>(null);
  const act = useAction();

  useEffect(() => {
    api.call<KnownEngine[]>("GET", "/api/engines").then(setKnown, () => setKnown([]));
  }, [api]);

  const adopting = step === "adopting";
  useEffect(() => {
    if (!events || !adopting) return;
    const onLine = (e: Event) => {
      const { line } = JSON.parse((e as MessageEvent<string>).data) as { line: string };
      setLines((l) => [...l, line]);
    };
    events.addEventListener("adoption", onLine);
    return () => events.removeEventListener("adoption", onLine);
  }, [events, adopting]);

  const versions = known.filter((k) => k.engine === choice.engine).map((k) => k.version);
  const suggested = (engine: string | null) => known.find((k) => k.engine === engine)?.version ?? "";

  const run = async (c: Choice) => {
    setLines([]);
    setStep("adopting");
    const ok = await act.run("adopt", async () => {
      try {
        setResult(await api.call<AdoptionView>("POST", "/api/projects/adopt", { dir: dir.trim(), ...c, ...(workspace ? { workspace } : {}) }));
      } catch (e) {
        const refused = e instanceof ApiError && e.status === 409 ? (e.data as Partial<AdoptionRefusal>).diagnosis : undefined;
        if (refused) setDiagnosis(refused);
        throw e;
      }
    });
    setStep(ok ? "done" : "diagnosis");
  };

  const diagnose = async (engine?: string) => {
    let found: Diagnosis | null = null;
    await act.run("diagnose", async () => {
      found = await api.call<Diagnosis>("POST", "/api/projects/diagnose", { dir: dir.trim(), ...(engine ? { engine } : {}) });
    });
    const d = found as Diagnosis | null;
    if (!d) return;
    setDiagnosis(d);
    const c = { engine: d.engine ?? "", version: d.version ?? suggested(d.engine), tag: engine ? choice.tag : d.tag };
    setChoice(c);
    // Déjà un projet Spawn : rien à décider ni à écrire, il est seulement inscrit (et ajouté au workspace).
    if (d.spawn) await register();
    else setStep("diagnosis");
  };

  const register = async () => {
    await act.run("diagnose", async () => {
      const project = await api.call<ProjectView>("POST", "/api/projects", { dir: dir.trim() });
      if (workspace) await api.call("POST", `/api/workspaces/${encodeURIComponent(workspace)}/projects`, { project: project.id });
      setLines([]);
      setResult({ project, commit: null, baseline: null, gaps: [], leftovers: [] });
      setStep("done");
    });
  };

  return {
    step,
    dir,
    setDir,
    diagnosis,
    choice,
    setChoice,
    versions,
    lines,
    result,
    act,
    diagnose,
    adopt: () => run(choice),
    back: () => setStep("folder"),
  };
}
