import { LoadingIndicator, PageContainer } from "../components/ui-primitives";

export default function Loading() {
  return (
    <PageContainer className="state-layout">
      <LoadingIndicator label="Preparing your home design workspace…" />
    </PageContainer>
  );
}
