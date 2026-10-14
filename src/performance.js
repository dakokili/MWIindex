// Compare closing values; never substitute an opening value for missing history.
export function selectionChange(bars, first, last = first) {
  const start = Math.min(first, last),
    end = Math.max(first, last);
  const previous = bars[start - 1],
    close = bars[end]?.close;
  const base = previous?.close;
  const delta =
    Number.isFinite(base) && Number.isFinite(close) ? close - base : null;
  const percent =
    delta !== null && base !== 0 ? (delta / Math.abs(base)) * 100 : null;
  return {
    close,
    delta,
    percent,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    previous,
    count: end - start + 1,
  };
}
export const signedPercent = (n) =>
  Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(2)}%` : "—";
