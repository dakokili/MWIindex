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
  selectCompositeMembers,
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
    { bid: 99, volume: 9999 },
    { bid: 0, volume: 10000 },
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
    { ask: 100, bid: 1, volume: 10000 },
    { ask: 90, bid: 100, volume: 10000 },
    { bid: 99, volume: 10000 },
  ])
    assert.equal(selectMembers([model], [sample(quote)]).length, 1);
  const selected = selectMembers(
    [model],
    [
      sample({ bid: 10, volume: 10000 }),
      ...Array.from({ length: 9 }, () => ({ time: 2, prices: {} })),
    ],
  );
  assert.equal(selected.length, 1);
  assert.equal(selected[0].profit, 240);
  assert.equal(selected[0].results[1], null);
});
test("real official fixtures yield all 11 indices, correct member limits, finite bars and no duplicate inflation", async () => {
  const a = await buildIndices(data, snapshots);
  const b = await buildIndices(data, [...snapshots, ...snapshots]);
  assert.deepEqual(a.series, b.series);
  for (const key of [...Object.keys(SKILLS), ...Object.keys(GROUPS)]) {
    assert.ok(a.series[key].length >= 3, key);
    for (const bar of a.series[key]) {
      assert.ok(bar.low <= bar.open && bar.open <= bar.high);
      assert.ok(bar.low <= bar.close && bar.close <= bar.high);
      assert.ok(Number.isFinite(bar.mean));
      assert.ok(
        bar.members.length > 0 && bar.members.length <= (GROUPS[key] ? 5 : 3),
      );
    }
  }
});
test("empty industry contributes no fictional members; composites select from remaining eligible industries", async () => {
  const noMilk = structuredClone(snapshots);
  for (const s of noMilk)
    for (const id of Object.keys(s.prices))
      if (id.endsWith("_milk") || id === "/items/milk") delete s.prices[id];
  const r = await buildIndices(data, noMilk);
  assert.equal(r.series.milking.length, 0);
  assert.ok(r.series.gathering.length > 0);
  assert.ok(
    r.series.gathering.every((b) =>
      b.members.every((m) => m.skill !== "milking"),
    ),
  );
  assert.ok(r.series.woodcutting.length > 0);
});

test("only brewing weights volume after the 10,000 gate; all industries select at most three", () => {
  const profits = [100, 90, 80, 70, 60];
  const volumes = [10000, 10000, 10000, 1000000, 1000000];
  for (const skill of Object.keys(SKILLS)) {
    const models = profits.map((_, i) => ({
      main: `x${i}`,
      action: { id: `${skill}/${i}`, skill },
      variants: [
        { inputs: [], outputs: [{ id: `x${i}`, rate: 1 }], teaIds: [] },
      ],
    }));
    const snapshot = {
      time: 1,
      prices: Object.fromEntries(
        profits.map((bid, i) => [`x${i}`, { bid, volume: volumes[i] }]),
      ),
    };
    const chosen = selectMembers(models, [snapshot]);
    assert.deepEqual(
      chosen.map((m) => m.main),
      skill === "brewing" ? ["x0", "x3", "x1"] : ["x0", "x1", "x2"],
      skill,
    );
  }
});

test("composite ranking uses profit, not volume or incompatible industry percentile scores", () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({
    id: String(i),
    profit: i,
    score: 9 - i,
    volume: 1e9 - i,
  }));
  assert.deepEqual(
    selectCompositeMembers(rows).map((r) => r.id),
    ["8", "7", "6", "5", "4"],
  );
  assert.equal(selectCompositeMembers(rows.slice(0, 2)).length, 2);
  assert.equal(selectCompositeMembers([]).length, 0);
  assert.deepEqual(
    selectCompositeMembers([
      { id: "b", profit: -1 },
      { id: "a", profit: -1 },
    ]).map((r) => r.id),
    ["a", "b"],
  );
});

function compositeFixture() {
  const skills = GROUPS.manufacturing.skills;
  const actions = skills.flatMap((skill, i) =>
    Array.from({ length: 3 }, (_, j) => ({
      id: `${skill}/${j}`,
      skill,
      level: 20,
      seconds: 10,
      inputs: [],
      outputs: [{ itemHrid: `${skill}/${j}`, count: 1 }],
      drops: [],
      essence: [],
      rare: [],
      upgrade: null,
    })),
  );
  const items = Object.fromEntries(
    actions.map((a) => [a.id, { tradable: true, category: "resource" }]),
  );
  const profile = {
    skills: Object.fromEntries(
      Object.keys(SKILLS).map((s) => [
        s,
        {
          level: 20,
          diet: [],
          buffs: {
            Level: 0,
            Speed: 0,
            Efficiency: 0,
            RareFind: 0,
            EssenceFind: 0,
            Gathering: 0,
            Processing: 0,
            Artisan: 0,
            Gourmet: 0,
            concentration: 0,
          },
        },
      ]),
    ),
  };
  const snapshots = [0, 1].map((i) => ({
    time: stamp("2026-10-13T00:00:00Z") + i * 3600,
    prices: Object.fromEntries(
      actions.map((a, j) => [a.id, { bid: 9 - j + i, volume: 10000 }]),
    ),
  }));
  return {
    data: { ...data, actions, items },
    snapshots,
    options: { ...DEFAULT_OPTIONS, profile },
    actions,
  };
}

test("composite candles equally weight the five selected commodities and retain actual members for all periods", async () => {
  const f = compositeFixture();
  const r = await buildIndices(f.data, f.snapshots, f.options);
  const bar = r.series.manufacturing[0];
  const dailyRate = 360 * 24 * 0.96;
  assert.deepEqual(
    bar.members.map((m) => m.id),
    f.actions.slice(0, 5).map((a) => a.id),
  );
  assert.ok(Math.abs(bar.open - 7 * dailyRate) < 1e-8);
  assert.ok(Math.abs(bar.close - 8 * dailyRate) < 1e-8);
  assert.equal(bar.low, bar.open);
  assert.equal(bar.high, bar.close);
  for (const period of ["day", "week", "month"])
    assert.deepEqual(
      aggregate(r.series.manufacturing, period)[0].members,
      bar.members,
    );
  assert.equal(r.series.gathering.length, 0);
});

test("only missing quotes of selected composite members remove a time point; no intraday replacement", async () => {
  const f = compositeFixture();
  // This missing member removes an industry's time point but is not in the composite top five.
  delete f.snapshots[1].prices[f.actions[8].id];
  const a = await buildIndices(f.data, f.snapshots, f.options);
  assert.equal(a.series.crafting[0].samples, 1);
  assert.equal(a.series.manufacturing[0].samples, 2);
  delete f.snapshots[1].prices[f.actions[0].id];
  const b = await buildIndices(f.data, f.snapshots, f.options);
  assert.equal(b.series.manufacturing[0].samples, 1);
  assert.deepEqual(
    b.series.manufacturing[0].members.map((m) => m.id),
    f.actions.slice(0, 5).map((a) => a.id),
  );
});
