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
