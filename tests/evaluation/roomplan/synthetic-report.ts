import { evaluateRoomPlan } from "./reference-evaluator.js";
import {
  syntheticAdapterManifest,
  syntheticRoomPlanFixtures,
  syntheticRoomPlanObservations,
} from "./synthetic-dataset.js";

export function createSyntheticRoomPlanReport() {
  return evaluateRoomPlan({
    adapter: syntheticAdapterManifest,
    fixtures: syntheticRoomPlanFixtures,
    observations: syntheticRoomPlanObservations,
  });
}
