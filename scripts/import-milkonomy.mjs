// Read a reviewed local Milkonomy checkout; never execute upstream code.
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const root = process.argv[2];
if (!root)
  throw new Error(
    "Usage: node scripts/import-milkonomy.mjs /path/to/Milkonomy",
  );
const game = JSON.parse(
  await readFile(`${root}/public/data/data.json`, "utf8"),
);
const zhSource = await readFile(`${root}/src/locales/lang/zh-cn.ts`, "utf8");
const translations = Object.fromEntries(
  [
    ...zhSource.matchAll(/^\s*"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)"/gm),
  ].map((m) => [JSON.parse(`"${m[1]}"`), JSON.parse(`"${m[2]}"`)]),
);
const skills = [
  "milking",
  "foraging",
  "woodcutting",
  "cheesesmithing",
  "tailoring",
  "crafting",
  "cooking",
  "brewing",
];
const actions = Object.values(game.actionDetailMap).filter((a) =>
  skills.includes(a.type.split("/").at(-1)),
);
const wanted = new Set(["/items/coin"]);
for (const a of actions)
  for (const list of [
    "inputItems",
    "outputItems",
    "dropTable",
    "essenceDropTable",
    "rareDropTable",
  ])
    for (const x of a[list] || []) wanted.add(x.itemHrid);
const specials = [
  "eye_watch",
  "red_culinary_hat",
  "enchanted_gloves",
  "collectors_boots",
].map((x) => `/items/${x}`);
const tools = Object.fromEntries(
  skills.map((s) => [
    s,
    Object.values(game.itemDetailMap).find(
      (i) =>
        i.itemLevel === 80 &&
        i.equipmentDetail?.type === `/equipment_types/${s}_tool`,
    ).hrid,
  ]),
);
for (const id of [...specials, ...Object.values(tools)]) wanted.add(id);
for (const i of Object.values(game.itemDetailMap))
  if (
    i.consumableDetail &&
    skills.some(
      (s) => i.consumableDetail.usableInActionTypeMap?.[`/action_types/${s}`],
    )
  )
    wanted.add(i.hrid);
// Recursively include untradeable loot contents and cowbell market conversion.
function addLoot(id) {
  for (const drop of game.openableLootDropMap[id] || []) {
    if (!wanted.has(drop.itemHrid)) {
      wanted.add(drop.itemHrid);
      addLoot(drop.itemHrid);
    }
  }
}
for (const id of [...wanted]) addLoot(id);
if (wanted.has("/items/cowbell")) wanted.add("/items/bag_of_10_cowbells");
const items = Object.fromEntries(
  [...wanted].sort().map((id) => {
    const i = game.itemDetailMap[id];
    return [
      id,
      {
        name: i.name,
        zh: translations[i.name] || i.name,
        level: i.itemLevel,
        category: i.categoryHrid.split("/").at(-1),
        tradable: i.isTradable,
        ...(game.openableLootDropMap[id]
          ? { loot: game.openableLootDropMap[id] }
          : {}),
        ...(game.shopItemDetailMap[`/shop_items/${id.split("/").at(-1)}`]
          ?.costs?.[0]?.itemHrid === "/items/coin"
          ? {
              shopPrice:
                game.shopItemDetailMap[`/shop_items/${id.split("/").at(-1)}`]
                  .costs[0].count,
            }
          : {}),
        ...(i.consumableDetail ? { consumable: i.consumableDetail } : {}),
        ...([...specials, ...Object.values(tools)].includes(id)
          ? { equipment: i.equipmentDetail }
          : {}),
      },
    ];
  }),
);
const data = {
  source: {
    repository: "Polokikiki/Milkonomy",
    commit: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    gameVersion: game.gameVersion,
    gameTimestamp: game.versionTimestamp,
  },
  defaults: {
    level: 100,
    enhance: 10,
    house: 4,
    allHouseCount: 10,
    tax: 0.04,
    specials,
    tools,
    enhancementMultiplier: game.enhancementLevelTotalBonusMultiplierTable[10],
  },
  items,
  actions: actions.map((a) => ({
    id: a.hrid,
    skill: a.type.split("/").at(-1),
    name: translations[a.name] || a.name,
    level: a.levelRequirement.level,
    seconds: a.baseTimeCost / 1e9,
    inputs: a.inputItems || [],
    outputs: a.outputItems || [],
    drops: a.dropTable || [],
    essence: a.essenceDropTable || [],
    rare: a.rareDropTable || [],
    upgrade: a.upgradeItemHrid || null,
  })),
};
await writeFile("data/milkonomy.json", JSON.stringify(data));
console.log(
  `Imported ${actions.length} actions; ${Object.keys(items).length} items at ${data.source.commit}`,
);
