"use client";

import { ActionButton, PageContainer, StatePanel } from "../../components/ui-primitives";

export default function MaterialsProductsError({ reset }: { readonly reset: () => void }) {
  return (
    <PageContainer style={{ display: "grid", minHeight: "65vh", placeItems: "center" }}>
      <StatePanel
        actions={<ActionButton onClick={reset}>Retry workspace</ActionButton>}
        message={
          <p>
            The route was interrupted before it could present validated C13 state. No specification
            revision, C5 substitution, or C10 scene was inferred.
          </p>
        }
        status="Workspace interrupted"
        title="The exact pinned state stayed unchanged"
        tone="error"
      />
    </PageContainer>
  );
}
