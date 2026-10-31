export interface PositionedStep {
  id: string;
  position: number;
  revision: number;
}
export interface ReorderPlan {
  temporary: { id: string; position: number }[];
  final: { id: string; position: number }[];
}

// Pure validation/planning contract for offline tests and a future server input
// check. Never execute these as separate HTTP writes: the database RPC is atomic.
export function planStepReorder(
  current: readonly PositionedStep[],
  requestedIds: readonly string[],
): ReorderPlan {
  if (
    current.length > 100 ||
    current.length !== requestedIds.length ||
    new Set(current.map((s) => s.id)).size !== current.length ||
    new Set(current.map((s) => s.position)).size !== current.length ||
    new Set(requestedIds).size !== requestedIds.length ||
    requestedIds.some((id) => !current.some((s) => s.id === id)) ||
    current.some(
      (s) =>
        !Number.isInteger(s.position) ||
        s.position < 1 ||
        s.position > 2147483647 ||
        !Number.isInteger(s.revision) ||
        s.revision < 1 ||
        s.revision > 2147483647,
    )
  ) {
    throw new Error("Provide every valid step exactly once");
  }
  const final = requestedIds.map((id, index) => ({ id, position: index + 1 }));
  if (
    final.every(
      (move) =>
        current.find((s) => s.id === move.id)!.position === move.position,
    )
  )
    return { temporary: [], final: [] };
  const highest = Math.max(0, ...current.map((s) => s.position));
  if (
    highest + current.length > 2147483647 ||
    current.some((s) => s.revision >= 2147483646)
  )
    throw new Error("Position or revision headroom exhausted");
  return {
    temporary: requestedIds.map((id, index) => ({
      id,
      position: highest + index + 1,
    })),
    final,
  };
}
