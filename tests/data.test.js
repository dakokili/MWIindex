import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeShards,
  normalizeCurrent,
  mergeSnapshots,
  shardUrl,
  mapLimit,
} from "../src/data.js";
const latest = 1791864360;
const manifest = {
  version: 1,
  latestSnapshot: { timestamp: latest },
  items: { "/items/x": { variants: { 0: { hourlyRetentionDays: 60 } } } },
};
test("exclude upstream daily medians, keep raw intraday nulls and deduplicate timestamps", () => {
  const rows = [
    { time: latest - 61 * 86400, a: 100, b: 90, v: 999999 },
    { time: latest, a: 5, b: 4, p: null, v: null },
    { time: latest, a: 5, b: 4, v: 200 },
  ];
  const result = normalizeShards(
    [{ itemHrid: "/items/x", variant: 0, rows }],
    manifest,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].prices["/items/x"].volume, null);
});
test("marketplace v is a snapshot interval volume; no 24-hour multiplier", () => {
  const r = normalizeCurrent(
    {
      timestamp: latest,
      marketData: { "/items/x": { 0: { a: 100, b: 99, v: 42, p: 100 } } },
    },
    ["/items/x"],
  );
  assert.equal(r.prices["/items/x"].volume, 42);
  assert.throws(() => normalizeCurrent({ timestamp: "today" }, []));
});
test("new snapshots replace same-time quotes, never carry a price across a gap", () => {
  const a = { time: 1, prices: { x: { ask: 1 } } },
    b = { time: 1, prices: { x: { ask: 2 }, y: { bid: 3 } } },
    c = { time: 8, prices: { y: { bid: 5 } } };
  const merged = mergeSnapshots([a], [b, c]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].prices.x.ask, 2);
  assert.equal(merged[1].prices.x, undefined);
});
test("shards cannot redirect requests to unexpected paths or hosts", () => {
  assert.ok(
    shardUrl("items/items_holy_milk__0.json").startsWith(
      "https://raw.githubusercontent.com/",
    ),
  );
  for (const path of [
    "https://evil.test/x",
    "../secret",
    "items/items_x__10.json",
  ])
    assert.throws(() => shardUrl(path));
});
test("bounded concurrency and stable result order", async () => {
  let active = 0,
    max = 0;
  const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
    max = Math.max(max, ++active);
    await new Promise((r) => setTimeout(r, 2));
    active--;
    return n * 2;
  });
  assert.equal(max, 2);
  assert.deepEqual(out, [2, 4, 6, 8, 10]);
});
