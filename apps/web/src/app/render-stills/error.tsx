"use client";

import { ActionButton, PageContainer, StatePanel } from "../../components/ui-primitives";
import styles from "../../features/render-stills/render-stills.module.css";

export default function RenderStillsError({ reset }: { readonly reset: () => void }) {
  return (
    <PageContainer className={styles.statePage}>
      <StatePanel
        actions={<ActionButton onClick={reset}>Retry workspace route</ActionButton>}
        message={
          <p>
            The route was interrupted before presenting validated C14 state. No render, artifact
            access or enhancement state was inferred.
          </p>
        }
        status="Workspace interrupted"
        title="Durable render state stayed unchanged"
        tone="error"
      />
    </PageContainer>
  );
}
