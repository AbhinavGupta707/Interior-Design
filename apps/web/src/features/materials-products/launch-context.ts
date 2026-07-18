import { materialsProductsLaunchContextSchema } from "./contracts";
import type { MaterialsProductsLaunchContext } from "./contracts";

export interface MaterialsProductsSearchParams {
  readonly confirmationId?: string | readonly string[];
}

export function materialsProductsLaunchContextFromSearchParams(
  query: MaterialsProductsSearchParams,
): MaterialsProductsLaunchContext | undefined {
  const queryValue = query.confirmationId;
  const confirmationId =
    typeof queryValue === "string" || queryValue === undefined ? queryValue : queryValue[0];
  const parsed = materialsProductsLaunchContextSchema.safeParse({ confirmationId });
  return parsed.success ? parsed.data : undefined;
}
