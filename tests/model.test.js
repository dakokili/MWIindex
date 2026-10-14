import test from "node:test";
import assert from "node:assert/strict";
import data from "../data/milkonomy.json" with { type: "json" };
import snapshots from "./fixtures/official-snapshots.json" with { type: "json" };
import {
  DEFAULT_OPTIONS,
  baseBuffs,
  candidates,
  diets,
  compileVariant,
  evaluate,
  bestProfit,
  compileModel,
} from "../src/model.js";
const near = (a, b) =>
  assert.ok(Math.abs(a - b) < 1e-7 * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const action = (id) => data.actions.find((a) => a.id.endsWith("/" + id));

test("Milkonomy default equipment, enhancement and all ten house rare bonuses", () => {
  const b = baseBuffs(data, "milking");
  near(b.Speed, 0.9 + 0.018 * 14.5);
  near(b.Efficiency, 0.015 * 4 + 0.1 + 0.002 * 14.5);
  near(b.RareFind, 0.002 * 4 * 10);
});
test("buy-one revenue and sell-one inputs, tax applied only to income", () => {
  const v = {
    inputs: [{ id: "in", rate: 10 }],
    outputs: [{ id: "out", rate: 20 * 0.96 }],
  };
  const s = {
    prices: { in: { ask: 100, bid: 80 }, out: { ask: 500, bid: 200 } },
  };
  near(evaluate(v, s).profit, (20 * 200 * 0.96 - 10 * 100) * 24);
  s.prices.out.ask = 99999;
  s.prices.in.bid = 1;
  near(evaluate(v, s).profit, (20 * 200 * 0.96 - 10 * 100) * 24);
  s.prices.in.ask = -1;
  assert.equal(evaluate(v, s), null);
  s.prices.in.ask = 100;
  s.prices.out.bid = 0;
  assert.equal(evaluate(v, s), null);
});
test("processing tea converts gathered milk at recipe ratio and tea consumption remains 12/hour", () => {
  const a = action("holy_cow");
  const v = compileVariant(data, a, [
    "/items/processing_tea",
    "/items/gathering_tea",
  ]);
  const b = baseBuffs(data, "milking"),
    aph =
      (3600 / (a.seconds / (1 + b.Speed))) *
      (1 + (100 - a.level) * 0.01 + b.Efficiency);
  near(v.actionsPH, aph);
  const gather =
    data.items["/items/gathering_tea"].consumable.buffs[0].flatBoost;
  const proc =
    data.items["/items/processing_tea"].consumable.buffs[0].flatBoost;
  const count = (a.drops[0].minCount + a.drops[0].maxCount) / 2 + gather;
  near(
    v.outputs.find((x) => x.id === "/items/holy_milk").rate,
    count * (1 - proc) * aph * 0.96,
  );
  near(
    v.outputs.find((x) => x.id === "/items/holy_cheese").rate,
    ((count * proc) / 2) * aph * 0.96,
  );
  for (const t of v.inputs) near(t.rate, 12);
});
test("artisan tea reduces materials and effective level, gourmet doubles expected output by buff", () => {
  const a = action("holy_cheese"),
    v = compileVariant(data, a, ["/items/artisan_tea"]);
  const b = baseBuffs(data, a.skill),
    aph =
      (3600 / (a.seconds / (1 + b.Speed))) *
      (1 + Math.max(0, (95 - a.level) * 0.01) + b.Efficiency);
  near(v.actionsPH, aph);
  near(
    v.inputs.find((x) => x.id === "/items/holy_milk").rate,
    a.inputs[0].count * 0.9 * aph,
  );
  const cooking = action("star_fruit_yogurt"),
    plain = compileVariant(data, cooking, []),
    fed = compileVariant(data, cooking, ["/items/gourmet_tea"]);
  const boost = data.items["/items/gourmet_tea"].consumable.buffs[0].flatBoost;
  near(fed.outputs[0].rate / plain.outputs[0].rate, 1 + boost);
});
test("untradeable crates recursively include coin, bells and rare materials with upstream box tax", () => {
  const a = action("holy_cheese"),
    v = compileVariant(data, a, []);
  assert.ok(v.outputs.some((x) => x.id === "/items/coin" && x.rare));
  assert.ok(
    v.outputs.some((x) => x.id === "/items/bag_of_10_cowbells" && x.rare),
  );
  assert.ok(!v.outputs.some((x) => x.id.includes("artisans_crate")));
  const rate = a.rare.find(
    (x) => x.itemHrid === "/items/large_artisans_crate",
  ).dropRate;
  const coin = v.outputs
    .filter((x) => x.id === "/items/coin")
    .reduce((s, x) => s + x.rate, 0);
  near(coin, (45000 + 22500) * rate * (1 + 0.08) * v.actionsPH * 0.96);
});
test("diet optimizer allows zero to three slots and prevents shared unique buffs", () => {
  for (const s of Object.keys(data.defaults.tools))
    for (const ids of diets(data, s)) {
      assert.ok(ids.length <= 3);
      const uniques = ids.map(
        (id) =>
          new Set(data.items[id].consumable.buffs.map((b) => b.uniqueHrid)),
      );
      for (let i = 0; i < uniques.length; i++)
        for (let j = i + 1; j < uniques.length; j++)
          assert.equal(
            [...uniques[i]].some((k) => uniques[j].has(k)),
            false,
          );
    }
  const m = compileModel(data).find((m) => m.action.id.endsWith("/holy_cow"));
  const ss = structuredClone(snapshots.at(-1));
  for (const [id, i] of Object.entries(data.items))
    if (i.category === "drink" && ss.prices[id]) ss.prices[id].ask = 1e12;
  assert.deepEqual(bestProfit(m, ss).teaIds, []);
});
test("only tradable commodities above minimum level, no equipment, charms, mixed zones or upgrades", () => {
  for (const a of candidates(data)) {
    assert.ok(a.level >= 20);
    assert.equal(a.upgrade, null);
    const list = a.drops.length ? a.drops : a.outputs;
    assert.equal(list.length, 1);
    assert.ok(
      ["resource", "drink", "food"].includes(
        data.items[list[0].itemHrid].category,
      ),
    );
  }
  assert.equal(
    candidates(data).some((a) => a.id.includes("charm")),
    false,
  );
});
test("coins are not taxed when directly output; shop purchase cap and strict missing quotes", () => {
  const v = {
    inputs: [{ id: "x", rate: 10, shopPrice: 5 }],
    outputs: [{ id: "/items/coin", rate: 100 }],
  };
  near(evaluate(v, { prices: { x: { ask: 9 } } }).profit, 50 * 24);
  near(evaluate(v, { prices: { x: { ask: 3 } } }).profit, 70 * 24);
  assert.equal(
    evaluate(
      { inputs: [], outputs: [{ id: "missing", rate: 1 }] },
      { prices: {} },
    ),
    null,
  );
});
