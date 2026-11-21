// Le résultat d'une adoption : son journal tel qu'il s'est déroulé, puis ce qu'il faut savoir.
import type { AdoptionView } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";
import { adoptionNotes } from "./points.ts";
import { PointLine } from "./PointLine.tsx";

export function AdoptResult({ result, lines }: { result: AdoptionView; lines: string[] }) {
  const notes = adoptionNotes(result);
  return (
    <>
      {lines.length > 0 && <pre className="adopt-log">{lines.join("\n")}</pre>}
      {notes.length > 0 && (
        <section>
          <h4>{t("adopt.notes")}</h4>
          {notes.map((n, i) => (
            <PointLine key={i} status={n.status} label={n.label} detail={n.detail} />
          ))}
        </section>
      )}
    </>
  );
}
