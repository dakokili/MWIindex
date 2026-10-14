import test from "node:test";
import assert from "node:assert/strict";
import { selectionChange, signedPercent } from "../src/performance.js";
import { aggregate } from "../src/indices.js";
const bars = [100, 110, 99, 120].map((close, i) => ({
  day: `2026-10-${String(5 + i).padStart(2, "0")}`,
  open: 1,
  close,
  high: close,
  low: 1,
  mean: 7,
  samples: 1,
  first: i,
  last: i,
  members: [],
}));
test("daily changes compare closing values to previous close, not opening or mean", () => {
  const up = selectionChange(bars, 1);
  assert.equal(up.delta, 10);
  assert.equal(up.percent, 10);
  assert.equal(up.direction, "up");
  const down = selectionChange(bars, 2);
  assert.equal(down.delta, -11);
  assert.equal(down.percent, -10);
  assert.equal(down.direction, "down");
});
test("range compares last close to the close before the first selected bar, with order-independent selection", () => {
  const r = selectionChange(bars, 1, 3);
  assert.equal(r.delta, 20);
  assert.equal(r.percent, 20);
  assert.equal(r.count, 3);
  assert.deepEqual(selectionChange(bars, 3, 1), r);
});
test("missing or zero previous close never produces invented percentages; negative profits retain intuitive direction", () => {
  assert.equal(selectionChange(bars, 0, 3).delta, null);
  const zero = selectionChange([{ close: 0 }, { close: 10 }], 1);
  assert.equal(zero.delta, 10);
  assert.equal(zero.percent, null);
  const negative = selectionChange([{ close: -100 }, { close: -50 }], 1);
  assert.equal(negative.percent, 50);
  assert.equal(negative.direction, "up");
  const flat = selectionChange([{ close: 100 }, { close: 100 }], 1);
  assert.equal(flat.percent, 0);
  assert.equal(flat.direction, "flat");
  assert.equal(signedPercent(null), "—");
  assert.equal(signedPercent(10), "+10.00%");
});
test("week and month comparisons use the preceding aggregated period close", () => {
  const input = [
    { ...bars[0], day: "2026-09-27" },
    { ...bars[1], day: "2026-10-05" },
    { ...bars[3], day: "2026-10-06" },
  ];
  for (const period of ["week", "month"]) {
    const r = selectionChange(aggregate(input, period), 1);
    assert.equal(r.delta, 20);
    assert.equal(r.percent, 20);
  }
});
