import test from "node:test";
import assert from "node:assert/strict";
import data from "../data/milkonomy.json" with { type: "json" };
import snapshots from "./fixtures/official-snapshots.json" with { type: "json" };
import { DEFAULT_OPTIONS, SKILLS, GROUPS } from "../src/model.js";
import {
  aggregate,
  candle,
  periodKey,
  dayKey,
  buildIndices,
  selectMembers,
} from "../src/indices.js";
const stamp = (iso) => Date.parse(iso) / 1000;
test("Shanghai day, Monday week across year and calendar month", () => {
  assert.equal(dayKey(stamp("2025-12-31T16:00:00Z")), "2026-01-01");
  assert.equal(periodKey("2026-01-01", "week"), "2025-12-29");
  assert.equal(periodKey("2026-03-31", "month"), "2026-03-01");
});
test("true chronological OHLC, weekly extrema and equal-day mean, negative values retained", () => {
  const a = candle("2026-10-05", [
    { time: 3, value: -5 },
    { time: 1, value: -4 },
    { time: 2, value: -10 },
  ]);
  assert.deepEqual(
    [a.open, a.high, a.low, a.close, a.mean],
    [-4, -4, -10, -5, -19 / 3],
  );
  const b = candle("2026-10-06", [{ time: 5, value: 20 }]);
  const w = aggregate([a, b], "week")[0];
  assert.deepEqual([w.open, w.high, w.low, w.close], [-4, 20, -10, 20]);
  assert.equal(w.mean, (-19 / 3 + 20) / 2);
  assert.equal(w.samples, 4);
});
test("fixed volume gate ignores spread, coverage and legacy overrides; missing prices remain missing", () => {
  const model = {
    main: "x",
    action: { id: "a", skill: "milking" },
    variants: [{ inputs: [], outputs: [{ id: "x", rate: 1 }], teaIds: [] }],
  };
  const sample = (q) => ({ time: 1, prices: { x: q } });
  for (const quote of [
    { bid: 99 },
    { bid: 99, volume: 999 },
    { bid: 0, volume: 1000 },
  ])
    assert.equal(
      selectMembers([model], [sample(quote)], {
        ...DEFAULT_OPTIONS,
        minVolume: 0,
        requireVolume: false,
      }).length,
      0,
    );
  for (const quote of [
    { ask: 100, bid: 1, volume: 1000 },
    { ask: 90, bid: 100, volume: 1000 },
    { bid: 99, volume: 1000 },
  ])
    assert.equal(selectMembers([model], [sample(quote)]).length, 1);
  const selected = selectMembers(
    [model],
    [
      sample({ bid: 10, volume: 1000 }),
      ...Array.from({ length: 9 }, () => ({ time: 2, prices: {} })),
    ],
  );
  assert.equal(selected.length, 1);
  assert.equal(selected[0].profit, 240);
  assert.equal(selected[0].results[1], null);
});
test("real official fixtures yield all 11 indices, max five members, finite bars and no duplicate inflation", async () => {
  const a = await buildIndices(data, snapshots);
  const b = await buildIndices(data, [...snapshots, ...snapshots]);
  assert.deepEqual(a.series, b.series);
  for (const key of [...Object.keys(SKILLS), ...Object.keys(GROUPS)]) {
    assert.ok(a.series[key].length >= 3, key);
    for (const bar of a.series[key]) {
      assert.ok(bar.low <= bar.open && bar.open <= bar.high);
      assert.ok(bar.low <= bar.close && bar.close <= bar.high);
      assert.ok(Number.isFinite(bar.mean));
      assert.ok(bar.members.length <= 5);
    }
  }
});
test("unavailable constituent does not silently reweight a composite or turn missing into zero", async () => {
  const noMilk = structuredClone(snapshots);
  for (const s of noMilk)
    for (const id of Object.keys(s.prices))
      if (id.endsWith("_milk") || id === "/items/milk") delete s.prices[id];
  const r = await buildIndices(data, noMilk);
  assert.equal(r.series.milking.length, 0);
  assert.equal(r.series.gathering.length, 0);
  assert.ok(r.series.woodcutting.length > 0);
});
