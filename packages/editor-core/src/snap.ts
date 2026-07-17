export const editorSnapGridsMm = Object.freeze([10, 25, 50, 100] as const);
export type EditorSnapGridMm = (typeof editorSnapGridsMm)[number];
export const defaultEditorSnapGridMm: EditorSnapGridMm = 50;

export interface IntegerPointMm {
  readonly xMm: number;
  readonly yMm: number;
}

export function isEditorSnapGridMm(value: number): value is EditorSnapGridMm {
  return editorSnapGridsMm.some((grid) => grid === value);
}

export function snapIntegerMm(valueMm: number, gridMm: EditorSnapGridMm): number {
  if (!Number.isSafeInteger(valueMm)) {
    throw new TypeError("Editor snapping accepts safe integer millimetres only.");
  }
  return Math.round(valueMm / gridMm) * gridMm;
}

export function snapPointMm(point: IntegerPointMm, gridMm: EditorSnapGridMm): IntegerPointMm {
  return Object.freeze({
    xMm: snapIntegerMm(point.xMm, gridMm),
    yMm: snapIntegerMm(point.yMm, gridMm),
  });
}

export function snapTranslationMm(
  translation: IntegerPointMm,
  gridMm: EditorSnapGridMm,
): IntegerPointMm {
  return snapPointMm(translation, gridMm);
}
