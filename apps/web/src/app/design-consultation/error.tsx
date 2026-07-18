"use client";

import { ActionButton, PageContainer, StatePanel } from "../../components/ui-primitives";

export default function DesignConsultationError({ reset }: { readonly reset: () => void }) {
  return (
    <PageContainer style={{ display: "grid", minHeight: "65vh", placeItems: "center" }}>
      <StatePanel
        actions={<ActionButton onClick={reset}>Retry workspace</ActionButton>}
        message={<p>The route was interrupted before it could present a safe brief state.</p>}
        status="Workspace interrupted"
        title="The brief stayed unchanged"
        tone="error"
      />
    </PageContainer>
  );
}
