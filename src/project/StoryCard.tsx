// Une story en une carte : sa couleur dit ce qu'elle attend (décision, recette, en cours, terminée), le sous-titre où
// elle en est. Le projet n'est montré que dans un workspace, où les cartes de plusieurs projets se mêlent.
import type { StoryView } from "../shared/api.ts";
import { subtitle } from "./storyText.ts";
import "./project.css";

const TONE: Record<StoryView["group"], string> = { blocked: "orange", acceptance: "blue", active: "green", history: "grey" };

export function StoryCard({ story, project, action, primary = false, onOpen }: { story: StoryView; project?: string; action?: string; primary?: boolean; onOpen: () => void }) {
  return (
    <div className={`story-card ${TONE[story.group]}`} onClick={onOpen} title={story.request ?? story.title}>
      <span className={`dot ${TONE[story.group]} ${story.running ? "pulsing" : ""}`} />
      <span className="story-card-text">
        {project && <span className="tag">{project}</span>}
        <strong>{story.title}</strong>
        <small>{subtitle(story)}</small>
      </span>
      {action && (
        <button
          className={`btn small ${primary ? "primary" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {action}
        </button>
      )}
    </div>
  );
}
