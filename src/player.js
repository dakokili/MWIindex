import { SKILLS } from "./model.js";
const get = (map, key) =>
  typeof map?.get === "function" ? map.get(key) : map?.[key];
const values = (map) =>
  typeof map?.values === "function"
    ? [...map.values()]
    : Object.values(map || {});
const buffKeys = {
  efficiency: "Efficiency",
  action_speed: "Speed",
  rare_find: "RareFind",
  essence_find: "EssenceFind",
  gathering: "Gathering",
  processing: "Processing",
  artisan: "Artisan",
  gourmet: "Gourmet",
};
const requiredFields = {
  character: "角色信息",
  characterSkillMap: "技能等级",
  noncombatStats: "非战斗属性",
  equipmentActionTypeBuffsMap: "装备增益",
  houseActionTypeBuffsMap: "房屋增益",
  actionTypeDrinkSlotsMap: "饮品槽",
};
const missingFields = (state) =>
  Object.keys(requiredFields).filter((key) => !state?.[key]);

// DOM Fibers can point at the previous render. Ascend to the root and use
// FiberRoot.current, never alternate (which can contain an old character).
function currentTree(fiber) {
  const seen = new Set();
  while (fiber?.return && !seen.has(fiber) && seen.size < 250) {
    seen.add(fiber);
    fiber = fiber.return;
  }
  return fiber?.stateNode?.current || fiber;
}

// Read only a mounted Game component. No socket interception, game actions or account data storage.
export function findPlayerState(page, doc) {
  const root = doc.getElementById?.("root");
  const stack = [];
  for (const el of [root, ...(root?.children || [])]) {
    for (const key of Object.getOwnPropertyNames(el || {})) {
      if (
        key.startsWith("__reactFiber$") ||
        key.startsWith("__reactInternalInstance$") ||
        key.startsWith("__reactContainer$")
      )
        stack.push(currentTree(el[key]));
    }
  }
  // React 16/legacy ReactDOM.render uses neither __reactContainer$ nor
  // __reactFiber$: its root lives here and DOM nodes use __reactInternalInstance$.
  const legacyRoot = root?._reactRootContainer;
  stack.push(legacyRoot?._internalRoot?.current || legacyRoot?.current);
  const seen = new Set();
  let incomplete = null;
  const consider = (state) => {
    if (!state?.character || !state.characterSkillMap) return false;
    if (!missingFields(state).length) return true;
    if (
      !incomplete ||
      missingFields(state).length < missingFields(incomplete).length
    )
      incomplete = state;
    return false;
  };
  while (stack.length && seen.size < 50000) {
    const fiber = stack.pop();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    const state = fiber.stateNode?.state;
    if (consider(state)) return state;
    stack.push(fiber.child, fiber.sibling);
  }
  // Prefer the mounted tree; a companion plugin can retain an old Game instance.
  if (incomplete) return incomplete;
  for (const game of [page.mwi?.game, page.mwi_common?.game]) {
    if (consider(game?.state)) return game.state;
  }
  return incomplete;
}

export function normalizePlayer(state, data) {
  const missing = missingFields(state);
  if (missing.length)
    throw new Error(
      state
        ? `尚未读到完整角色数据，缺少：${missing.map((key) => requiredFields[key]).join("、")}。请等待游戏加载完成后重试。`
        : "尚未读到完整角色数据：未找到已登录的游戏角色，请进入游戏后重试。",
    );
  const skills = {};
  for (const skill of Object.keys(SKILLS)) {
    const level = values(state.characterSkillMap).find(
      (s) => s.skillHrid === `/skills/${skill}`,
    )?.level;
    if (!Number.isFinite(level) || level < 1)
      throw new Error(`无法读取${SKILLS[skill]}等级`);
    const buffs = {
      Level: 0,
      Speed: 0,
      Efficiency: 0,
      RareFind: 0,
      EssenceFind: 0,
      Gathering: 0,
      Processing: 0,
      Artisan: 0,
      Gourmet: 0,
      concentration: state.noncombatStats.drinkConcentration || 0,
    };
    const actionType = `/action_types/${skill}`;
    // Server-resolved equipment includes enhancement; house includes global room bonuses.
    // Consumable buffs are rebuilt from selected slots below, never added twice.
    for (const source of [
      "equipment",
      "house",
      "community",
      "achievement",
      "personal",
      "mooPass",
      "guild",
    ]) {
      for (const buff of get(
        state[`${source}ActionTypeBuffsMap`],
        actionType,
      ) || []) {
        const type = buff.typeHrid?.split("/").at(-1);
        const key =
          type === `${skill}_level` || type === "action_level"
            ? "Level"
            : buffKeys[type];
        if (!key) continue;
        if (buff.ratioBoost) throw new Error(`暂不支持角色的比例增益：${type}`);
        if (!Number.isFinite(buff.flatBoost))
          throw new Error(`角色增益数据不完整：${type}`);
        buffs[key] += buff.flatBoost * (type === "action_level" ? -1 : 1);
      }
    }
    const diet = [];
    for (const kind of ["Drink", "Food"]) {
      for (const slot of get(state[`actionType${kind}SlotsMap`], actionType) ||
        []) {
        if (!slot?.itemHrid) continue;
        const item = data.items[slot.itemHrid];
        if (!item?.consumable?.usableInActionTypeMap?.[actionType])
          throw new Error(`规则快照未包含当前饮食：${slot.itemHrid}`);
        diet.push(slot.itemHrid);
      }
    }
    skills[skill] = { level, buffs, diet };
  }
  // Whitelist only production data; no account, inventory, chat or authentication fields.
  return {
    name: String(state.character.name || "当前角色"),
    capturedAt: new Date().toISOString(),
    skills,
  };
}
export function readPlayer(data) {
  const page = typeof unsafeWindow === "undefined" ? window : unsafeWindow;
  return normalizePlayer(findPlayerState(page, page.document), data);
}
