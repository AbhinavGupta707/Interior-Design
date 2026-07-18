import { LoadingIndicator, PageContainer } from "../../components/ui-primitives";

export default function DesignConsultationLoading() {
  return (
    <PageContainer style={{ display: "grid", minHeight: "65vh", placeItems: "center" }}>
      <LoadingIndicator label="Preparing the design consultation workspace…" />
    </PageContainer>
  );
}
