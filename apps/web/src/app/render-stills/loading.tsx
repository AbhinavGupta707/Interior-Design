import { LoadingIndicator, PageContainer } from "../../components/ui-primitives";
import styles from "../../features/render-stills/render-stills.module.css";

export default function RenderStillsLoading() {
  return (
    <PageContainer className={styles.statePage}>
      <LoadingIndicator label="Preparing durable render-stills workspace…" />
    </PageContainer>
  );
}
