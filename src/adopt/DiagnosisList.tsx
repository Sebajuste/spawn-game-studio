// Les points du diagnostic, rangés par groupe ; le groupe du moteur porte le titre de son adaptateur.
import type { Diagnosis, PointGroup } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";
import { groupPoints } from "./points.ts";
import { PointLine } from "./PointLine.tsx";

const heading = (group: PointGroup, d: Diagnosis): string => (group === "engine" ? (d.title ?? t("adopt.group.engine")) : t(`adopt.group.${group}`));

export function DiagnosisList({ diagnosis }: { diagnosis: Diagnosis }) {
  return (
    <>
      {groupPoints(diagnosis.points).map(({ group, points }) => (
        <section key={group}>
          <h4>{heading(group, diagnosis)}</h4>
          {points.map((p, i) => (
            <PointLine key={i} status={p.status} label={p.label} detail={p.detail} />
          ))}
        </section>
      ))}
    </>
  );
}
