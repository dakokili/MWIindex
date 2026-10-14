import test from "node:test";
import assert from "node:assert/strict";
import data from "../data/milkonomy.json" with { type: "json" };
import { findPlayerState, normalizePlayer } from "../src/player.js";
import { compileModel, candidates, DEFAULT_OPTIONS } from "../src/model.js";
import { money } from "../src/chart.js";
import { playerState } from "./player-fixture.js";

test("all finite profits display in millions, including losses and small values", () => {
  assert.equal(money(1250000), "1.25M");
  assert.equal(money(-1250000), "-1.25M");
  assert.equal(money(10000), "0.01M");
  assert.equal(money(0), "0.00M");
  assert.equal(money(null), "—");
});
test("player uses actual levels, server equipment/house buffs and fixed selected diet without double counting", () => {
  const state = playerState();
  state.consumableActionTypeBuffsMap = {
    "/action_types/milking": [
      { typeHrid: "/buff_types/efficiency", flatBoost: 999 },
    ],
  };
  const profile = normalizePlayer(state, data);
  const model = compileModel(data, { ...DEFAULT_OPTIONS, profile }).find((m) =>
    m.action.id.endsWith("/holy_cow"),
  );
  assert.equal(model.variants.length, 1);
  const v = model.variants[0];
  assert.deepEqual(v.teaIds, ["/items/efficiency_tea"]);
  const expected =
    (3600 / Math.max(3, model.action.seconds / 1.5)) *
    (1 + (100 - model.action.level) * 0.01 + 0.06 + 0.1 * 1.2);
  assert.ok(Math.abs(v.actionsPH - expected) < 1e-8);
  assert.ok(
    Math.abs(
      v.inputs.find((i) => i.id === "/items/efficiency_tea").rate - 14.4,
    ) < 1e-8,
  );
  assert.equal(profile.skills.milking.buffs.RareFind, 0.08);
  state.characterSkillMap["/skills/milking"].level = 19;
  assert.equal(
    candidates(data, {
      ...DEFAULT_OPTIONS,
      minLevel: 1,
      profile: normalizePlayer(state, data),
    }).filter((a) => a.skill === "milking").length,
    0,
  );
});
test("Map-shaped game state, changing equipment, rooms, levels and empty drink slots are read afresh", () => {
  const state = playerState();
  state.characterSkillMap = new Map(Object.entries(state.characterSkillMap));
  state.houseActionTypeBuffsMap = new Map(
    Object.entries(state.houseActionTypeBuffsMap),
  );
  const before = normalizePlayer(state, data);
  state.characterSkillMap.get("/skills/milking").level = 80;
  state.equipmentActionTypeBuffsMap = {};
  state.houseActionTypeBuffsMap = new Map();
  state.actionTypeDrinkSlotsMap = {};
  const after = normalizePlayer(state, data);
  assert.equal(after.skills.milking.level, 80);
  assert.equal(after.skills.milking.buffs.Speed, 0);
  assert.equal(after.skills.milking.buffs.RareFind, 0);
  assert.deepEqual(after.skills.milking.diet, []);
  assert.equal(before.skills.milking.buffs.Speed, 0.5);
});
test("profile whitelist and explicit errors prevent account leakage or silent default substitution", () => {
  const state = playerState();
  state.email = "private@example.test";
  state.guestPassword = "secret";
  assert.ok(!JSON.stringify(normalizePlayer(state, data)).includes("secret"));
  assert.throws(() => normalizePlayer(null, data), /完整角色/);
  delete state.houseActionTypeBuffsMap;
  assert.throws(() => normalizePlayer(state, data), /完整角色/);
  const unsupported = playerState();
  unsupported.actionTypeDrinkSlotsMap["/action_types/milking"] = [
    { itemHrid: "/items/future_tea" },
  ];
  assert.throws(() => normalizePlayer(unsupported, data), /规则快照/);
});
test("finds mounted React Game without companion plugins; follows current tree and avoids cycles", () => {
  const state = playerState();
  const fiber = { stateNode: { state } };
  fiber.sibling = fiber;
  const root = {
    children: [],
    __reactContainer$fixture: { stateNode: { current: { child: fiber } } },
  };
  assert.equal(findPlayerState({}, { getElementById: () => root }), state);
  assert.equal(findPlayerState({ mwi: { game: { state } } }, {}), state);
  assert.equal(findPlayerState({}, { getElementById: () => null }), null);
  state.character = null;
  assert.equal(findPlayerState({}, { getElementById: () => root }), null);
});

test("finds legacy React roots and internal-instance DOM markers", () => {
  const state = playerState();
  const game = { stateNode: { state } };
  const current = { child: game };
  for (const legacyRoot of [{ _internalRoot: { current } }, { current }]) {
    const root = { children: [], _reactRootContainer: legacyRoot };
    assert.equal(findPlayerState({}, { getElementById: () => root }), state);
  }
  const domFiber = { return: game };
  const element = {};
  Object.defineProperty(element, "__reactInternalInstance$test", {
    value: domFiber,
  });
  const root = { children: [element] };
  assert.equal(findPlayerState({}, { getElementById: () => root }), state);
});

test("DOM fibers resolve the committed root, not a stale alternate or companion", () => {
  const stale = playerState(),
    active = playerState();
  active.character.name = "新角色";
  const current = { child: { stateNode: { state: active } } };
  const oldRoot = { stateNode: { current } };
  const oldGame = { stateNode: { state: stale }, return: oldRoot };
  oldRoot.child = oldGame;
  const root = { children: [{ __reactFiber$test: { return: oldGame } }] };
  const page = { mwi: { game: { state: stale } } };
  assert.equal(findPlayerState(page, { getElementById: () => root }), active);
  current.child = null;
  assert.equal(findPlayerState({}, { getElementById: () => root }), null);
});

test("incomplete candidates do not hide complete state; diagnostics name missing fields", () => {
  const state = playerState(),
    partial = playerState();
  delete partial.noncombatStats;
  const fiber = {
    stateNode: { state: partial },
    child: { stateNode: { state } },
  };
  const root = {
    children: [],
    __reactContainer$test: { stateNode: { current: fiber } },
  };
  assert.equal(findPlayerState({}, { getElementById: () => root }), state);
  const page = {
    mwi: { game: { state: partial } },
    mwi_common: { game: { state } },
  };
  assert.equal(findPlayerState(page, {}), state);
  fiber.child = null;
  assert.equal(findPlayerState(page, { getElementById: () => root }), partial);
  assert.throws(() => normalizePlayer(partial, data), /缺少：非战斗属性/);
});

test("every skill excludes recipes one level above the player and includes the exact unlock level", () => {
  const state = playerState();
  const profile = normalizePlayer(state, data);
  const options = { ...DEFAULT_OPTIONS, profile };
  for (const skill of Object.keys(profile.skills)) {
    const action = candidates(data).find(
      (a) => a.skill === skill && a.level > 20,
    );
    assert.ok(action, skill);
    profile.skills[skill].level = action.level - 1;
    assert.ok(
      !compileModel(data, options).some((m) => m.action.id === action.id),
      `${skill}: level too low`,
    );
    profile.skills[skill].level = action.level;
    assert.ok(
      compileModel(data, options).some((m) => m.action.id === action.id),
      `${skill}: exact level`,
    );
  }
});

test("actual daily constituents respect each skill level and do not substitute an unavailable skill in composites", async () => {
  const { buildIndices } = await import("../src/indices.js");
  const { default: snapshots } = await import(
    "./fixtures/official-snapshots.json",
    { with: { type: "json" } }
  );
  const profile = normalizePlayer(playerState(), data);
  Object.values(profile.skills).forEach((s, i) => {
    s.level = 20 + i * 10;
  });
  profile.skills.milking.level = 19;
  const result = await buildIndices(data, snapshots, {
    ...DEFAULT_OPTIONS,
    profile,
  });
  assert.equal(result.series.milking.length, 0);
  assert.ok(
    result.series.gathering.every((b) =>
      b.members.every((m) => m.skill !== "milking"),
    ),
  );
  let members = 0;
  for (const [skill, config] of Object.entries(profile.skills)) {
    for (const bar of result.series[skill])
      for (const member of bar.members) {
        const action = data.actions.find((a) => a.id === member.id);
        assert.ok(
          action.level >= 20 && action.level <= config.level,
          member.id,
        );
        members++;
      }
  }
  assert.ok(members > 0);
});
