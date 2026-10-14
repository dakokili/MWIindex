export function playerState() {
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
  return {
    character: { id: 123, name: "测试角色" },
    characterSkillMap: Object.fromEntries(
      skills.map((s) => [
        `/skills/${s}`,
        { skillHrid: `/skills/${s}`, level: 100 },
      ]),
    ),
    noncombatStats: { drinkConcentration: 0.2 },
    equipmentActionTypeBuffsMap: {
      "/action_types/milking": [
        { typeHrid: "/buff_types/action_speed", flatBoost: 0.5 },
      ],
    },
    houseActionTypeBuffsMap: {
      "/action_types/milking": [
        { typeHrid: "/buff_types/efficiency", flatBoost: 0.06 },
        { typeHrid: "/buff_types/rare_find", flatBoost: 0.08 },
      ],
    },
    actionTypeDrinkSlotsMap: {
      "/action_types/milking": [{ itemHrid: "/items/efficiency_tea" }, null],
    },
    actionTypeFoodSlotsMap: {},
  };
}

// Field names verified from the live Game state and its message handlers on
// 2026-10-14. Values are synthetic; no account data is retained in this fixture.
export function livePlayerState() {
  const { character, characterSkillMap, noncombatStats } = playerState();
  return {
    character,
    characterSkillMap,
    noncombatStats,
    equipmentActionTypeBuffsDict: {
      "/action_types/milking": [
        { typeHrid: "/buff_types/action_speed", flatBoost: 0.5 },
      ],
    },
    houseActionTypeBuffsDict: {
      "/action_types/milking": [
        { typeHrid: "/buff_types/efficiency", flatBoost: 0.06 },
        { typeHrid: "/buff_types/rare_find", flatBoost: 0.08 },
      ],
    },
    communityActionTypeBuffsDict: {
      "/action_types/milking": [
        { typeHrid: "/buff_types/action_speed", flatBoost: 0.03 },
      ],
    },
    achievementActionTypeBuffsDict: {
      "/action_types/milking": [
        { typeHrid: "/buff_types/rare_find", flatBoost: 0.04 },
      ],
    },
    personalActionTypeBuffsDict: {
      "/action_types/milking": [
        { typeHrid: "/buff_types/milking_level", flatBoost: 2 },
      ],
    },
    mooPassActionTypeBuffsDict: {
      "/action_types/milking": [
        { typeHrid: "/buff_types/essence_find", flatBoost: 0.05 },
      ],
    },
    guildActionTypeBuffsDict: {
      "/action_types/milking": [
        { typeHrid: "/buff_types/efficiency", flatBoost: 0.07 },
      ],
    },
    actionTypeDrinkSlotsDict: {
      "/action_types/milking": [{ itemHrid: "/items/efficiency_tea" }, null],
    },
    actionTypeFoodSlotsDict: {},
    consumableActionTypeBuffsDict: {
      "/action_types/milking": [
        { typeHrid: "/buff_types/efficiency", flatBoost: 999 },
      ],
    },
    skillingActionTypeBuffsDict: {
      "/action_types/milking": [
        { typeHrid: "/buff_types/efficiency", flatBoost: 999 },
      ],
    },
  };
}
