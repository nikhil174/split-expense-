// How many rows a write changed (D1 reports it in meta.changes).
export const changesOf = (result: unknown): number => {
  const r = result as { meta?: { changes?: number }; changes?: number } | null | undefined;
  return Number(r?.meta?.changes ?? r?.changes ?? 0);
};
