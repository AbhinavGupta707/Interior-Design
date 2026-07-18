import type { Metadata } from "next";

import { evidenceClassificationFromEnvironment } from "../../../features/materials-products/contracts";
import {
  materialsProductsLaunchContextFromSearchParams,
  type MaterialsProductsSearchParams,
} from "../../../features/materials-products/launch-context";
import { MaterialsProductsWorkspace } from "../../../features/materials-products/materials-products-workspace";

export const metadata: Metadata = {
  title: "Materials & products · Home Design Studio",
};

export default async function MaterialsProductsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<MaterialsProductsSearchParams>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const launchContext = materialsProductsLaunchContextFromSearchParams(query);
  return (
    <MaterialsProductsWorkspace
      evidenceClassification={evidenceClassificationFromEnvironment(
        process.env.C13_CATALOG_EVIDENCE_CLASSIFICATION,
      )}
      {...(launchContext ? { launchContext } : {})}
      projectId={projectId}
    />
  );
}
