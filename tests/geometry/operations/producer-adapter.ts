import {
  operationRegistry,
  reduceModelOperations,
} from "../../../packages/model-operations/src/index.js";

/** Root-owned adapter that lets the independent C5 oracle exercise the merged producer. */
export const producerAdapter = Object.freeze({
  operationTypes: Object.freeze(
    operationRegistry.filter(({ audience }) => audience === "public").map(({ type }) => type),
  ),
  reduce: reduceModelOperations,
});

export default producerAdapter;
