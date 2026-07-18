import { LoadingIndicator, PageContainer } from "../../components/ui-primitives";

export default function MaterialsProductsLoading() {
  return (
    <PageContainer style={{ display: "grid", minHeight: "65vh", placeItems: "center" }}>
      <LoadingIndicator label="Preparing exact catalog and specification pins…" />
    </PageContainer>
  );
}
