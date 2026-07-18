import type { BriefEntryClassification } from "@interior-design/contracts";

import styles from "./consultation.module.css";
import { classificationFor } from "./presentation";

export function ClassificationBadge({
  classification,
  showDescription = false,
}: {
  readonly classification: BriefEntryClassification;
  readonly showDescription?: boolean;
}) {
  const presentation = classificationFor(classification);
  return (
    <span
      className={styles.badge}
      data-tone={presentation.tone}
      title={showDescription ? undefined : presentation.description}
    >
      <span aria-hidden="true" className={styles.badgeMark} />
      {presentation.label}
      {showDescription ? (
        <span className={styles.badgeDescription}> — {presentation.description}</span>
      ) : null}
    </span>
  );
}
