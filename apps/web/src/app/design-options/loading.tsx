import { LoadingIndicator, PageContainer } from "../../components/ui-primitives";

export default function DesignOptionsLoading() {
  return (
    <PageContainer style={{ display: "grid", minHeight: "65vh", placeItems: "center" }}>
      <LoadingIndicator label="Preparing exact design-option pins and comparison controls…" />
    </PageContainer>
  );
}
