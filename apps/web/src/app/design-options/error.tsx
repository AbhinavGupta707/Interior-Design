"use client";

import { ActionButton, PageContainer, StatePanel } from "../../components/ui-primitives";

export default function DesignOptionsError({ reset }: { readonly reset: () => void }) {
  return (
    <PageContainer style={{ display: "grid", minHeight: "65vh", placeItems: "center" }}>
      <StatePanel
        actions={<ActionButton onClick={reset}>Retry workspace</ActionButton>}
        message={
          <p>
            The route was interrupted before it could present a validated option state. No option
            confirmation or canonical mutation was inferred.
          </p>
        }
        status="Workspace interrupted"
        title="The pinned design state stayed unchanged"
        tone="error"
      />
    </PageContainer>
  );
}
