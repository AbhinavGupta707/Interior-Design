interface LevelOwnedObject {
  readonly userData: unknown;
}

export function canonicalLevelId(object: LevelOwnedObject): string | undefined {
  if (object.userData === null || typeof object.userData !== "object") return undefined;
  const value = (object.userData as Readonly<Record<string, unknown>>).levelId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function isVisibleForLevels(
  object: LevelOwnedObject,
  visibleLevelIds: ReadonlySet<string>,
): boolean {
  const levelId = canonicalLevelId(object);
  return levelId === undefined || visibleLevelIds.has(levelId);
}
