/** Fixed-rule Milkonomy model. Formula provenance: docs/methodology.md. */
export const SKILLS = {
  milking: "挤奶",
  foraging: "采集",
  woodcutting: "伐木",
  cheesesmithing: "锻造",
  tailoring: "缝纫",
  crafting: "制作",
  cooking: "烹饪",
  brewing: "冲泡",
};
export const GROUPS = {
  gathering: { name: "三采", skills: ["milking", "foraging", "woodcutting"] },
  manufacturing: {
    name: "三制造",
    skills: ["cheesesmithing", "tailoring", "crafting"],
  },
  food: { name: "饮食", skills: ["cooking", "brewing"] },
};
export const DEFAULT_OPTIONS = Object.freeze({
  minLevel: 20,
  maxSpread: 0.2,
  minCoverage: 0.8,
  minVolume: 1000,
  top: 5,
  tax: 0.04,
  requireVolume: true,
});
const gathering = new Set(["milking", "foraging", "woodcutting"]);
const COIN = "/items/coin";
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
export { mean };

export function candidates(data, options = DEFAULT_OPTIONS) {
  return data.actions.filter((a) => {
    if (
      !SKILLS[a.skill] ||
      a.level < options.minLevel ||
      a.level > data.defaults.level ||
      a.upgrade
    )
      return false;
    const outputs = gathering.has(a.skill) ? a.drops : a.outputs;
    // Mixed foraging zones have no single commodity; do not count their outputs twice.
    return (
      outputs.length === 1 &&
      outputs.every((o) => {
        const i = data.items[o.itemHrid];
        return (
          i?.tradable && ["resource", "food", "drink"].includes(i.category)
        );
      })
    );
  });
}

export function baseBuffs(data, skill) {
  const b = {
    Level: 0,
    Speed: 0,
    Efficiency: 0.015 * data.defaults.house,
    RareFind: 0.002 * data.defaults.house * data.defaults.allHouseCount,
    EssenceFind: 0,
    Gathering: 0,
    Processing: 0,
    Artisan: 0,
    Gourmet: 0,
    concentration: 0,
  };
  for (const id of [...data.defaults.specials, data.defaults.tools[skill]]) {
    const e = data.items[id]?.equipment;
    if (!e) throw new Error(`默认装备数据缺失：${id}`);
    for (const [key, value] of Object.entries(e.noncombatStats)) {
      const amount =
        value +
        (e.noncombatEnhancementBonuses[key] || 0) *
          data.defaults.enhancementMultiplier;
      if (key === "drinkConcentration") b.concentration += amount;
      else if (key.startsWith(skill))
        b[key.slice(skill.length)] = (b[key.slice(skill.length)] || 0) + amount;
      else if (key.startsWith("skilling"))
        b[key.slice(8)] = (b[key.slice(8)] || 0) + amount;
    }
  }
  return b;
}

export function diets(data, skill) {
  const relevant = new Set([
    "efficiency",
    "artisan",
    "gourmet",
    "action_speed",
    "gathering",
    "processing",
    `${skill}_level`,
  ]);
  const teas = Object.entries(data.items).filter(
    ([, i]) =>
      i.category === "drink" &&
      i.consumable?.usableInActionTypeMap?.[`/action_types/${skill}`] &&
      i.consumable.buffs.some((b) =>
        relevant.has(b.typeHrid.split("/").at(-1)),
      ),
  );
  const result = [[]];
  function visit(start, chosen, unique) {
    if (chosen.length === 3) return;
    for (let n = start; n < teas.length; n++) {
      const [id, i] = teas[n];
      const keys = [...new Set(i.consumable.buffs.map((b) => b.uniqueHrid))];
      if (keys.some((k) => unique.has(k))) continue;
      const next = [...chosen, id];
      result.push(next);
      visit(n + 1, next, new Set([...unique, ...keys]));
    }
  }
  visit(0, [], new Set());
  return result;
}

export function compileVariant(
  data,
  action,
  teaIds,
  options = DEFAULT_OPTIONS,
) {
  const b = baseBuffs(data, action.skill);
  const buffKeys = {
    efficiency: "Efficiency",
    artisan: "Artisan",
    gourmet: "Gourmet",
    action_speed: "Speed",
    gathering: "Gathering",
    processing: "Processing",
  };
  for (const id of teaIds)
    for (const buff of data.items[id].consumable.buffs) {
      const type = buff.typeHrid.split("/").at(-1),
        scale = 1 + b.concentration;
      if (type === `${action.skill}_level`) b.Level += buff.flatBoost * scale;
      else if (type === "action_level") b.Level -= buff.flatBoost * scale;
      else if (buffKeys[type]) b[buffKeys[type]] += buff.flatBoost * scale;
    }
  const efficiency =
    1 +
    Math.max(0, (data.defaults.level + b.Level - action.level) * 0.01) +
    b.Efficiency;
  const actionsPH =
    (3600 / Math.max(3, action.seconds / (1 + b.Speed))) * efficiency;
  const inputs = [],
    outputs = [];
  const addOutput = (
    id,
    count,
    rare = false,
    taxFactor = id === COIN ? 1 : 1 - options.tax,
    depth = 0,
  ) => {
    if (depth > 8) throw new Error("开箱掉落存在循环");
    if (data.items[id]?.loot && id !== "/items/bag_of_10_cowbells") {
      for (const d of data.items[id].loot)
        addOutput(
          d.itemHrid,
          (count * d.dropRate * (d.minCount + d.maxCount)) / 2,
          rare,
          taxFactor,
          depth + 1,
        );
    } else if (id === "/items/cowbell") {
      // Upstream fallback: 40,000 coins per cowbell if the 10-bell bag has no quote.
      outputs.push({
        id: "/items/bag_of_10_cowbells",
        rate: (count / 10) * actionsPH * taxFactor,
        rare,
        fallback: 400000,
      });
    } else outputs.push({ id, rate: count * actionsPH * taxFactor, rare });
  };
  const main = (action.drops[0] || action.outputs[0]).itemHrid;
  if (gathering.has(action.skill)) {
    const processing = data.actions.find(
      (a) =>
        /(fabric|lumber|cheese)$/.test(a.id) && a.inputs[0]?.itemHrid === main,
    );
    const p = processing ? b.Processing : 0;
    for (const d of action.drops)
      addOutput(
        d.itemHrid,
        ((d.minCount + d.maxCount) / 2 + b.Gathering) *
          (1 - (d.itemHrid === main ? p : 0)),
      );
    if (p) {
      const d = action.drops[0];
      addOutput(
        processing.outputs[0].itemHrid,
        (((d.minCount + d.maxCount) / 2 + b.Gathering) * p) /
          processing.inputs[0].count,
      );
    }
  } else {
    for (const i of action.inputs)
      inputs.push({
        id: i.itemHrid,
        rate: i.count * (1 - b.Artisan) * actionsPH,
        shopPrice: data.items[i.itemHrid]?.shopPrice,
      });
    for (const o of action.outputs)
      addOutput(o.itemHrid, o.count * (1 + b.Gourmet));
  }
  // Milkonomy uses maxCount for essence/rare tables, and mean count for main drops.
  for (const d of action.essence)
    addOutput(d.itemHrid, d.maxCount * d.dropRate * (1 + b.EssenceFind), true);
  for (const d of action.rare)
    addOutput(d.itemHrid, d.maxCount * d.dropRate * (1 + b.RareFind), true);
  for (const id of teaIds)
    inputs.push({ id, rate: 12 * (1 + b.concentration) });
  return {
    teaIds,
    inputs: inputs.filter((x) => x.rate > 0),
    outputs: outputs.filter((x) => x.rate > 0),
    actionsPH,
  };
}

export function evaluate(variant, snapshot) {
  let cost = 0,
    income = 0,
    rareIncome = 0;
  for (const x of variant.inputs) {
    const quote = snapshot.prices[x.id]?.ask;
    const p =
      x.id === COIN
        ? 1
        : x.shopPrice
          ? Math.min(quote > 0 ? quote : Infinity, x.shopPrice)
          : quote;
    if (!(p > 0) || !Number.isFinite(p)) return null;
    cost += p * x.rate;
  }
  for (const x of variant.outputs) {
    const quote = snapshot.prices[x.id]?.bid;
    const p = x.id === COIN ? 1 : quote > 0 ? quote : x.fallback;
    if (!(p > 0) || !Number.isFinite(p)) return null;
    income += p * x.rate;
    if (x.rare) rareIncome += p * x.rate;
  }
  return {
    profit: (income - cost) * 24,
    cost: cost * 24,
    income: income * 24,
    rareIncome: rareIncome * 24,
    teaIds: variant.teaIds,
  };
}

export function compileModel(data, options = DEFAULT_OPTIONS) {
  const dietMap = Object.fromEntries(
    Object.keys(SKILLS).map((s) => [s, diets(data, s)]),
  );
  return candidates(data, options).map((action) => ({
    action,
    main: (action.drops[0] || action.outputs[0]).itemHrid,
    variants: dietMap[action.skill].map((t) =>
      compileVariant(data, action, t, options),
    ),
  }));
}

export function bestProfit(model, snapshot) {
  let best = null;
  for (const v of model.variants) {
    const result = evaluate(v, snapshot);
    if (result && (!best || result.profit > best.profit)) best = result;
  }
  return best;
}
