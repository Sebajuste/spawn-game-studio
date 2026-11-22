// Ce que le service a fait d'une demande de l'agent, sous sa réponse : une création vérifiée avec son lien, ou le refus
// avec sa raison. Jamais ce que l'agent dit avoir fait.
import { t } from "../i18n/i18n.ts";
import type { TalkActionResult } from "../shared/api.ts";

interface Props {
  result: TalkActionResult;
  // Nom du projet quand la portée est un workspace (plusieurs projets) ; null dans un projet.
  projectName: ((id: string) => string) | null;
  onOpenStory: (project: string, story: string) => void;
  onOpenEpic: (epic: string) => void;
}

export function ActionResult({ result, projectName, onOpenStory, onOpenEpic }: Props) {
  if (!result.ok) return <div className="talk-action failed">✗ {t(`talk.failed.${result.kind}`, { error: result.error })}</div>;
  if (result.kind === "story") {
    const text = projectName ? t("talk.storyIn", { project: projectName(result.project), title: result.title }) : t("talk.story", { title: result.title });
    return <Done text={text} onOpen={() => onOpenStory(result.project, result.story)} />;
  }
  const n = result.stories.length;
  return <Done text={t(n === 1 ? "talk.epic.one" : "talk.epic.other", { epic: result.epic, title: result.title, n })} onOpen={() => onOpenEpic(result.epic)} />;
}

function Done({ text, onOpen }: { text: string; onOpen: () => void }) {
  return (
    <div className="talk-action">
      ✓ {text}
      <button type="button" onClick={onOpen}>
        {t("talk.open")}
      </button>
    </div>
  );
}
