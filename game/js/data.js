/* =====================================================================
 * ForestTable · 数据层 v2.0（d6 版）
 * ---------------------------------------------------------------------
 * v2 与 v1 的根本区别：
 *   1. 属性从 0~100 缩到 15~25，判定全部改 1d6 + 修正 vs 难度(3~6)
 *   2. 新增第四项属性「伤害」，工具与携带道具可加伤害
 *   3. 战斗不再是"各打一轮"，而是每节拍双方各投 1d6 抢行动权
 *
 * 数值口径：
 *   属性 15~25  → 修正 0 ~ +3      （见 MOD_TABLE）
 *   判定难度：轻松 3 / 普通 4 / 困难 5 / 极难 6
 *   自然 6 = 大成功，自然 1 = 大失败
 *   伤害 = 角色伤害 + 武器加成 + 道具加成；骰面 = 暴击点 → ×2
 * ===================================================================== */
window.FT = window.FT || {};

/* ---------------------------------------------------------------
 * 全局配置（调平衡先改这里）
 * --------------------------------------------------------------- */
FT.CONFIG = {
  VERSION: '2.0.0',
  SAVE_KEY: 'foresttable_save_v2',
  DIE: 6,                    // 唯一的骰子

  TURNS_PER_DAY: 5,
  DAY_TURNS: 3,              // 前 3 回合白天
  BASE_SLOTS: 8,

  ADVANCE_PROGRESS: 3,
  PROGRESS_GOALS: [5, 6, 7, 8],   // 4 个阶段的进度阈值（一次前进 +3）

  /* 每回合消耗（15~25 尺度） */
  TURN_STAMINA_DAY: 1,
  TURN_STAMINA_NIGHT: 2,
  TURN_SANITY_DAY: 0,
  TURN_SANITY_NIGHT: 2,
  ADVANCE_COST: 3,
  GATHER_COST: 2,

  /* 休整 */
  REST_STAMINA: 6,
  REST_SANITY: 4,
  REST_HP: 2,          // 睡一觉只能缓一点：健康主要靠绷带/药

  FIRE_TURNS: 3,
  MAX_LOG: 200,

  /* 战斗 */
  CHAIN_PENALTY_STEP: 1,     // 连续行动，每次判定 -1
  CHAIN_PENALTY_MAX: 2,      // 惩罚上限（想严格按 -1 就改成 1）
  DEFEND_REDUCE: 3,          // 防守减伤
  DEFEND_INIT_BONUS: 2,      // 防守后下次抢行动权 +2
  FLEE_DC: 4,                // 撤退难度（精英 +1）
  FLEE_ELITE_DC: 5,
  FATIGUE_EVERY: 4,          // 每 N 节拍，体力 -1（防止无限磨）
  BASE_DEFENSE: 4,           // 玩家基础防御（敌人需 d6+命中 ≥ 4）

  /* 阈值 */
  HUNGRY_AT: 6,              // 体力 ≤ 6 饥饿
  MADNESS_AT: 6,             // 精神 ≤ 6 心理疾病
  DYING_TURNS: 3
};

/* ---------------------------------------------------------------
 * 属性修正表（唯一口径，引擎与文档都引用这一张）
 * --------------------------------------------------------------- */
FT.MOD_TABLE = [
  { max: 4,   mod: -2 },
  { max: 9,   mod: -1 },
  { max: 15,  mod: 0  },
  { max: 19,  mod: 1  },
  { max: 23,  mod: 2  },
  { max: 999, mod: 3  }
];
FT.attrMod = function (v) {
  for (const t of FT.MOD_TABLE) if (v <= t.max) return t.mod;
  return 3;
};

/* d6 难度档：直接写数字，方便文档对照 */
FT.DC = { easy: 3, normal: 4, hard: 5, extreme: 6 };

/* ---------------------------------------------------------------
 * 场景
 * --------------------------------------------------------------- */
FT.SCENES = {
  bright_forest: {
    name: '明亮树林', art: 'bright_forest',
    tagline: '阳光穿过枝叶，在地上落成一片片摇晃的光斑。',
    gather: [['stick', 40], ['berry', 25], ['vine', 20], ['stone', 15]],
    sanityMod: 0, checkMod: 0, enemyRate: 0.30,
    palette: ['#3d5a3a', '#7d9457']
  },
  dark_forest: {
    name: '阴森树林', art: 'dark_forest',
    tagline: '苔藓吸走了所有声音。你听见自己的心跳。',
    gather: [['mushroom', 25], ['resin', 25], ['bone', 20], ['stick', 30]],
    sanityMod: -1, checkMod: -1, enemyRate: 0.45,
    palette: ['#1e2a26', '#3c4a3a']
  },
  riverside: {
    name: '河流岸边', art: 'riverside',
    tagline: '水声很响，响到可以盖住别的声音。',
    gather: [['raw_fish', 30], ['water', 30], ['stone', 25], ['cloth', 15]],
    sanityMod: 0, checkMod: 0, enemyRate: 0.35,
    palette: ['#28414a', '#5d8794']
  },
  swamp: {
    name: '沼泽', art: 'swamp',
    tagline: '每一步都要把脚从泥里拔出来，带着一声闷响。',
    gather: [['herb', 30], ['rot_meat', 25], ['vine', 25], ['water', 20]],
    sanityMod: -1, checkMod: -1, enemyRate: 0.40,
    palette: ['#2c3226', '#5a6350']
  },
  cliff: {
    name: '悬崖戈壁', art: 'cliff',
    tagline: '风从崖下灌上来，带着石头的腥味。',
    gather: [['flint', 35], ['stick', 35], ['stone', 30]],
    sanityMod: 0, checkMod: -1, enemyRate: 0.35,
    palette: ['#3a3530', '#8b7f6d']
  },
  waterfall: {
    name: '瀑布', art: 'waterfall',
    tagline: '轰鸣。水雾。偶尔一道彩虹挂在水帘上。',
    gather: [['water', 40], ['raw_fish', 30], ['moss', 30]],
    sanityMod: 1, checkMod: 0, enemyRate: 0.25,
    palette: ['#22403f', '#6f9d94']
  },
  lakeshore: {
    name: '森林边缘 · 湖畔', art: 'lakeshore',
    tagline: '雾散了。湖对岸是一道灰白的线——那是出口。',
    gather: [['cloth', 30], ['stone', 30], ['stick', 40]],
    sanityMod: 1, checkMod: 0, enemyRate: 0.30,
    palette: ['#2a3340', '#8f9aa8']
  }
};

/* ---------------------------------------------------------------
 * 角色（4 项属性，健康/体力/精神 都在 15~25 区间内）
 * --------------------------------------------------------------- */
FT.CHARS = [
  {
    id: 'hunter', name: '猎人', title: '追踪者',
    hp: 20, stamina: 21, sanity: 17, dmg: 3,
    slotBonus: 0,
    start: [['rifle', 1], ['jerky', 1]],
    weapon: 'rifle',
    passive: '首击 +1 命中；前进额外 +1 进度。',
    tag: '开拓'
  },
  {
    id: 'porter', name: '脚夫', title: '背包客',
    hp: 24, stamina: 22, sanity: 18, dmg: 2,
    slotBonus: 4,
    start: [['rope', 2], ['stick_w', 1]],
    weapon: 'stick_w',
    passive: '背包 +4 格；超重不减速。',
    tag: '后勤'
  },
  {
    id: 'medic', name: '卫生员', title: '牧师',
    hp: 18, stamina: 19, sanity: 23, dmg: 2,
    slotBonus: 0,
    start: [['medicine', 1], ['bandage', 2]],
    weapon: null,
    passive: '治疗 +2；用绷带/药不占行动。',
    tag: '救护'
  },
  {
    id: 'apostle', name: '使徒', title: '低语者',
    hp: 16, stamina: 17, sanity: 25, dmg: 3,
    slotBonus: 0,
    start: [['knife', 1]],
    weapon: 'knife',
    passive: '精神 ≤8 时全判定 +1；精神 ≥20 时每回合精神 -1。',
    tag: '异常'
  }
];

/* ---------------------------------------------------------------
 * 物品
 * ---------------------------------------------------------------
 *  weapon: { dmg: 伤害加成, crit: 暴击骰面(0=无), hit: 命中修正, twoHand: 双手 }
 *  dmgBonus: 携带即加伤害
 *  defBonus: 携带即加防御
 * --------------------------------------------------------------- */
FT.ITEMS = {
  /* --- 材料 --- */
  stick:   { name: '树枝',   icon: '🪵', cat: 'mat', desc: '干一点的能烧。' },
  stone:   { name: '石头',   icon: '🪨', cat: 'mat', desc: '压手，也压得住锅。' },
  vine:    { name: '藤蔓',   icon: '🌿', cat: 'mat', desc: '有韧性，能拧成绳。' },
  cloth:   { name: '布条',   icon: '🧣', cat: 'mat', desc: '从衣服上撕下来的。' },
  resin:   { name: '树脂',   icon: '🫧', cat: 'mat', desc: '黏手，易燃。' },
  bone:    { name: '骨头',   icon: '🦴', cat: 'mat', desc: '不知道是什么的。' },
  mushroom: { name: '蘑菇',  icon: '🍄', cat: 'mat', desc: '颜色越鲜艳，越不该碰。' },
  herb:    { name: '药草',   icon: '☘️', cat: 'mat', desc: '嚼起来很苦。' },
  moss:    { name: '苔藓',   icon: '🟩', cat: 'mat', desc: '湿的，敷在伤口上能止血。' },
  flint:   { name: '燧石',   icon: '⬛', cat: 'mat', desc: '两片一敲就出火星。' },

  /* --- 工具 --- */
  torch:    { name: '火把', icon: '🔥', cat: 'tool', desc: '夜晚判定不受惩罚，驱散怕光的东西。', flags: ['light'] },
  rope:     { name: '粗绳', icon: '🪢', cat: 'tool', desc: '攀爬、渡水的必需品。' },
  pot:      { name: '锅',   icon: '🥘', cat: 'tool', desc: '煮汤需要它。' },
  bandage:  { name: '绷带', icon: '🩹', cat: 'tool', desc: '恢复 5 健康，解除流血。', use: { hp: 5, cure: 'bleeding' } },
  medicine: { name: '药',   icon: '💊', cat: 'tool', desc: '恢复 7 健康，解除中毒。', use: { hp: 7, cure: 'poisoned' } },
  odd_stone: { name: '奇怪的石头', icon: '🔮', cat: 'tool', desc: '贴身携带时，所有判定 +1。', flags: ['luck'] },

  /* --- 伤害类道具（携带即生效） --- */
  whetstone: { name: '磨刀石', icon: '🧱', cat: 'tool', dmgBonus: 1, desc: '携带时伤害 +1。刀刃的角度，决定它有多长。' },
  bone_spike: { name: '骨刺',  icon: '🦂', cat: 'tool', dmgBonus: 1, desc: '携带时伤害 +1。绑在小臂上，捅的时候更用力。' },
  shield:    { name: '木盾',   icon: '🛡️', cat: 'tool', defBonus: 1, desc: '携带时防御 +1。挡得住爪子，挡不住眼睛。' },
  powder:    { name: '火药',   icon: '🧨', cat: 'tool', use: { boost: 3 }, desc: '下一击伤害 +3。一次性。' },
  molotov:   { name: '燃烧瓶', icon: '🍾', cat: 'tool', use: { burn: 6 }, desc: '战斗中直接造成 6 点伤害，不需命中。一次性。' },

  /* --- 武器 --- */
  stick_w: { name: '木棍',   icon: '🥢', cat: 'weapon', weapon: { dmg: 1, crit: 6, hit: 0 }, desc: '伤害 +1 · 投出 6 暴击。' },
  knife:   { name: '匕首',   icon: '🔪', cat: 'weapon', weapon: { dmg: 2, crit: 5, hit: 0 }, desc: '伤害 +2 · 投出 5 暴击。短，但够快。' },
  machete: { name: '砍刀',   icon: '⚔️', cat: 'weapon', weapon: { dmg: 2, crit: 4, hit: 0 }, desc: '伤害 +2 · 投出 4 暴击。开路的工具，也能开路。' },
  spear:   { name: '长矛',   icon: '🔱', cat: 'weapon', weapon: { dmg: 3, crit: 3, hit: 0, twoHand: true }, desc: '伤害 +3 · 投出 3 暴击。双手，不能同时用盾。' },
  rifle:   { name: '猎枪',   icon: '🔫', cat: 'weapon', weapon: { dmg: 3, crit: 4, hit: 1 }, desc: '伤害 +3 · 投出 4 双倍 · 命中 +1。声音很大。' },
  bow:     { name: '弓',     icon: '🏹', cat: 'weapon', weapon: { dmg: 2, crit: 6, hit: 1, firstStrike: true }, desc: '伤害 +2 · 投出 6 暴击 · 命中 +1 · 首节拍先手。' },

  /* --- 食物（体力回复，15~25 尺度） --- */
  ration:    { name: '干粮', food: true, icon: '🥖', stamina: 3, expire: 70, desc: '硬得能砸核桃。' },
  jerky:     { name: '腌肉', food: true, icon: '🥓', stamina: 4, expire: 60, desc: '咸，吃完口渴。' },
  berry:     { name: '野果', food: true, icon: '🫐', stamina: 2, expire: 45, desc: '酸甜，有 10% 概率闹肚子。', poison: 0.10 },
  water:     { name: '净水', food: true, icon: '💧', stamina: 1, expire: 20, desc: '沼泽取的水要煮过。' },
  roast_meat: { name: '烤肉', food: true, help: 1, icon: '🍖', stamina: 5, expire: 12, desc: '油脂滴在火上，滋滋响。热的。' },
  meat_soup: { name: '肉汤', food: true, help: 1, icon: '🍲', stamina: 6, expire: 10, desc: '一锅能分十份。喝的时候要吵一架。热的。', portions: 10 },
  raw_meat:  { name: '生肉', food: true, icon: '🥩', stamina: 3, expire: 8, desc: '血还是温的。', poison: 0.20 },
  raw_fish:  { name: '鱼',   food: true, icon: '🐟', stamina: 3, expire: 8, desc: '还在动。', poison: 0.15 },
  rot_meat:  { name: '腐肉', food: true, icon: '🥀', stamina: 2, expire: 6, desc: '沼泽里捡的。也许还能吃。', poison: 0.45 },
  spoiled:   { name: '腐败食物', food: true, icon: '🦠', stamina: 2, expire: 999, desc: '……真的要吃吗？', poison: 0.60, spoiled: true }
};

/* ---------------------------------------------------------------
 * 配方
 * --------------------------------------------------------------- */
FT.RECIPES = [
  { id: 'r_fire', out: 'fire', name: '篝火', req: { stick: 3, stone: 2 }, fire: true,
    desc: '持续 3 回合。夜间精神消耗减半，可烹饪。' },
  { id: 'r_torch', out: 'torch', name: '火把', req: { stick: 1, cloth: 1 },
    desc: '夜晚判定不再 -1，驱散怕光的东西。' },
  { id: 'r_rope', out: 'rope', name: '粗绳', req: { vine: 2 },
    desc: '攀爬、渡水。' },
  { id: 'r_bandage', out: 'bandage', name: '绷带', req: { cloth: 2 },
    desc: '恢复 5 健康，解除流血。' },
  { id: 'r_medicine', out: 'medicine', name: '药', req: { herb: 2, moss: 1 },
    desc: '恢复 7 健康，解除中毒。' },
  { id: 'r_luck', out: 'odd_stone', name: '奇怪的石头', req: { flint: 1, bone: 1 },
    desc: '携带时全判定 +1。' },

  /* --- 武器线 --- */
  { id: 'r_stickw', out: 'stick_w', name: '木棍', req: { stick: 2 },
    desc: '伤害 +1 · 暴击 6。最便宜的伤害来源。' },
  { id: 'r_machete', out: 'machete', name: '砍刀', req: { flint: 2, stick: 1 },
    desc: '伤害 +2 · 暴击 4。' },
  { id: 'r_spear', out: 'spear', name: '长矛', req: { stick: 2, flint: 1, vine: 1 },
    desc: '伤害 +3 · 暴击 3。双手。' },
  { id: 'r_bow', out: 'bow', name: '弓', req: { stick: 2, vine: 2 },
    desc: '伤害 +2 · 暴击 6 · 命中 +1 · 首节拍先手。' },

  /* --- 伤害/防御道具 --- */
  { id: 'r_whet', out: 'whetstone', name: '磨刀石', req: { flint: 1, stone: 1 },
    desc: '携带时伤害 +1。' },
  { id: 'r_spike', out: 'bone_spike', name: '骨刺', req: { bone: 2 },
    desc: '携带时伤害 +1。' },
  { id: 'r_shield', out: 'shield', name: '木盾', req: { stick: 2, vine: 1 },
    desc: '携带时防御 +1。' },
  { id: 'r_powder', out: 'powder', name: '火药', req: { resin: 2, bone: 1 },
    desc: '下一击 +3 伤害。' },
  { id: 'r_molotov', out: 'molotov', name: '燃烧瓶', req: { resin: 1, cloth: 1, stick: 1 },
    desc: '战斗中直接 6 点伤害。' },

  /* --- 烹饪 --- */
  { id: 'r_roast', out: 'roast_meat', name: '烤肉', req: { raw_meat: 1 }, needFire: true, cook: true, desc: '需要篝火。' },
  { id: 'r_roastfish', out: 'roast_meat', name: '烤鱼', req: { raw_fish: 1 }, needFire: true, cook: true, desc: '需要篝火。味道怪，但能吃。' },
  { id: 'r_soup', out: 'meat_soup', name: '肉汤', req: { raw_meat: 2, water: 1, pot: 1 }, needFire: true, cook: true, keepTool: 'pot',
    desc: '需要篝火与锅。产出 10 份，可分食。' }
];

/* ---------------------------------------------------------------
 * 敌人
 * ---------------------------------------------------------------
 *  hp[4]  = 阶段 1/2/3/4 的血量（0 = 该阶段不出现）
 *  atk     = 命中后的固定伤害
 *  hit     = 命中修正
 *  evade   = 玩家攻击需要达到的闪避值
 *  spd     = 抢行动权修正
 * --------------------------------------------------------------- */
FT.ENEMIES = {
  beast: {
    name: '野兽', hp: [9, 13, 18, 23], atk: 2, hit: 0, evade: 4, spd: 1,
    loot: ['raw_meat', 'bone'], flavor: '灌木丛后面，有什么在同步呼吸。',
    desc: '比狼大，比狼安静。'
  },
  savage: {
    name: '戴生物头骨的野人', hp: [11, 15, 20, 25], atk: 3, hit: 0, evade: 3, spd: 0,
    group: [1, 2], loot: ['bone', 'cloth'],
    flavor: '骨头相碰的声音，从三个方向同时响起。',
    desc: '它们把兽骨缝在脸上，看不出表情。'
  },
  cultist: {
    name: '野人信徒', hp: [8, 11, 14, 17], atk: 1, hit: 0, evade: 3, spd: 0,
    sanityDrain: 1, loot: ['bone', 'cloth'], group: [1, 2],
    flavor: '它们围着一块立石唱歌。你不该听懂那些词，但你听懂了。',
    desc: '它们不攻击，只是唱。'
  },
  unknown: {
    name: '未知生命体', hp: [13, 18, 23, 29], atk: 2, hit: 0, evade: 4, spd: 0,
    needsLight: true, sanityDrain: 1, loot: ['bone', 'odd_stone'],
    flavor: '它没有轮廓——你看它的时候，它在看别的地方。',
    desc: '普通武器几乎无效。'
  },

  /* --- 精英（血量 40~75，按阶段递增） --- */
  bonechief: {
    elite: true, name: '骨面酋长', hp: [0, 42, 50, 58], atk: 3, hit: 0, evade: 3, spd: 1,
    rage: true, loot: ['bone', 'bone_spike'],
    flavor: '它比别的野人高一个头。它脸上的骨头，是它自己的。',
    desc: '血量过半后狂暴：伤害 +1、命中 +1。'
  },
  altar_warden: {
    elite: true, name: '祭坛看守', hp: [0, 0, 54, 64], atk: 3, hit: 2, evade: 3, spd: 0,
    sanityDrain: 1, loot: ['odd_stone', 'medicine'],
    flavor: '它一直跪在那里。你走近时，它开始站起来——站起来的过程花了很久。',
    desc: '每节拍精神 -1。'
  },
  mistwalker: {
    elite: true, name: '雾中行者', hp: [0, 0, 0, 72], atk: 3, hit: 0, evade: 4, spd: 0,
    needsLight: true, sanityDrain: 1, loot: ['odd_stone', 'bone_spike'],
    flavor: '雾里有两个人的高度，但只有一个影子。它走得很慢，因为它不必快。',
    desc: '需要强光。没有火把/篝火时，它对你的伤害翻倍。'
  }
};

/* ---------------------------------------------------------------
 * 心理疾病症状（精神 ≤6 触发）
 * --------------------------------------------------------------- */
FT.SYMPTOMS = [
  { id: 'hallucination', name: '幻觉', desc: '所有判定 -1。' },
  { id: 'paranoia', name: '偏执', desc: '你不相信任何人。休整回复减半。' },
  { id: 'aphasia', name: '失语', desc: '说不出完整的句子。精神判定 -1。' }
];

/* ---------------------------------------------------------------
 * 事件牌
 * ---------------------------------------------------------------
 * type: encounter | mystery | hazard | skip
 * check: { stat:'hp'|'stamina'|'sanity', dc: 3~6 }
 * rare: 精英牌，只在 minStage 之后、按低概率抽到
 * --------------------------------------------------------------- */
FT.CARDS = [

  /* ============ 白天通用 ============ */
  { id: 'D01', deck: 'day', type: 'encounter', enemy: 'savage', title: '树影里的人',
    text: '三个戴着兽骨头骨的野人从树影里走出来，它们没有说话，只是慢慢散开，把你围在中间。' },

  { id: 'D02', deck: 'day', type: 'encounter', enemy: 'beast', title: '同步的呼吸',
    text: '灌木丛后面传来呼吸声。你停下，呼吸也停下。你往前走，呼吸跟着往前走。' },

  { id: 'D03', deck: 'day', type: 'mystery', title: '石制的祭坛',
    text: '一块被藤蔓缠住的石台，上面放着一只还很热的陶碗。汤是白的，飘着油花。',
    choices: [
      { label: '喝掉它', desc: '回复体力，但没人知道那是什么肉。',
        fx: { team: { stamina: 2 }, give: { id: 'spoiled', qty: 1 } }, result: '汤是咸的。喝完你才想起，这林子里没人会煮汤。' },
      { label: '倒掉它', desc: '安全，但你会一直想着那碗汤。',
        fx: { team: { sanity: 1 } }, result: '汤渗进石缝。你听见很轻的一声，像是叹气。' },
      { label: '连碗一起带走', desc: '占一格背包，很快会坏。',
        fx: { give: { id: 'meat_soup', qty: 1 } }, result: '碗还是温的。你把它塞进包里，不敢回头看祭坛。' }
    ] },

  { id: 'D04', deck: 'day', type: 'hazard', title: '会说话的藤蔓', check: { stat: 'sanity', dc: 5 },
    text: '藤蔓垂下来，末端轻轻地摆动。你听见它们在用你母亲的声音叫你的名字。',
    ok: { team: { sanity: -1 }, result: '你咬住舌头，血腥味把你拽了回来。' },
    bad: { team: { sanity: -2 }, status: 'madness', result: '你应了一声。藤蔓停住了，然后笑。' } },

  { id: 'D05', deck: 'day', type: 'hazard', title: '看不见底的泥', check: { stat: 'stamina', dc: 4 },
    text: '地面看起来是硬的。踩下去，一直陷到膝盖。',
    ok: { self: { stamina: -2 }, result: '你把自己拔了出来，鞋留在了里面。' },
    bad: { self: { stamina: -3, hp: -1 }, result: '你把自己拔出来时，腿已经没有知觉了。' } },

  { id: 'D06', deck: 'day', type: 'hazard', title: '断落的树枝', check: { stat: 'hp', dc: 4 },
    text: '头顶传来一声脆响。你抬头，正好看见那根枝干开始下落。',
    ok: { self: { hp: -1 }, result: '你侧身躲过，只被擦破了肩膀。' },
    bad: { self: { hp: -3 }, status: 'bleeding', result: '它砸在你背上。你听见自己的骨头响了一下。' } },

  { id: 'D07', deck: 'day', type: 'mystery', title: '废弃的营地',
    text: '三顶塌掉的帐篷，一个冷掉的灰堆。睡袋里的人形已经很久没有动过了。',
    choices: [
      { label: '翻找物资', desc: '可能有补给，也可能惊动什么。',
        fx: { give: { id: 'ration', qty: 2 }, team: { sanity: -1 } }, result: '两包干粮，还有一本写满同一句话的日记。' },
      { label: '替他们盖上土', desc: '耽误时间，但心里会好受些。',
        fx: { team: { sanity: 2 }, progress: -1 }, result: '你用石头堆了个小堆。没人说话。' },
      { label: '立刻离开', desc: '不碰任何东西。',
        fx: {}, result: '走出很远之后，你才发现自己没回头。' }
    ] },

  { id: 'D08', deck: 'day', type: 'encounter', enemy: 'cultist', title: '立石前的歌声',
    text: '一块黑色的立石下，几个野人跪着唱歌。调子很简单，简单到你已经跟着哼了。' },

  { id: 'D09', deck: 'day', type: 'hazard', title: '蜂群', check: { stat: 'stamina', dc: 4 },
    text: '你踩到了什么。然后空气里全是嗡嗡声。',
    ok: { self: { stamina: -1 }, result: '你抱着头冲出去，只被蜇了两下。' },
    bad: { self: { hp: -2, stamina: -2 }, result: '你的脸肿了起来，一只眼睛快要睁不开。' } },

  { id: 'D10', deck: 'day', type: 'hazard', title: '刻满符号的树干', check: { stat: 'sanity', dc: 5 },
    text: '整棵树皮被刻满了符号。你数了数，正好是你们的人数，多一个。',
    ok: { team: { sanity: -1 }, result: '你用布把它盖住了。' },
    bad: { team: { sanity: -2 }, status: 'madness', result: '你开始用手指在树上补刻。你拦不住自己。' } },

  { id: 'D11', deck: 'day', type: 'mystery', title: '蘑菇圈',
    text: '一圈颜色鲜亮的蘑菇围出一块空地。圈里的草长得比外面高。',
    choices: [
      { label: '采走蘑菇', desc: '能吃，但风险自负。',
        fx: { give: { id: 'mushroom', qty: 3 } }, result: '蘑菇被采走的地方，草立刻枯了。' },
      { label: '在圈里休息', desc: '回复体力，但精神会更差。',
        fx: { team: { stamina: 3, sanity: -1 } }, result: '你睡了二十分钟。醒来时天没变，但影子换了方向。' },
      { label: '绕着走', desc: '不惹事。',
        fx: {}, result: '你绕了一大圈。没有走近去看看。' }
    ] },

  { id: 'D12', deck: 'day', type: 'hazard', title: '你自己的旧物', check: { stat: 'sanity', dc: 4 },
    text: '地上躺着一只你的水壶。可它就挂在你腰上，你摸得到。',
    ok: { team: { sanity: -1 }, result: '你把地上那只踢进灌木，没让自己再多看一眼。' },
    bad: { team: { sanity: -2 }, result: '你捡起来了。它是满的，还是热的。' } },

  { id: 'D13', deck: 'day', type: 'hazard', title: '倒下的巨木', check: { stat: 'stamina', dc: 4 },
    text: '一棵巨大的倒木横在必经之路上，底下是空的，可以钻过去。',
    ok: { progress: 1, result: '你钻了过去，省下一段路。' },
    bad: { team: { stamina: -2 }, self: { hp: -1 }, result: '木头在身后塌下来。你是滚过去的。' } },

  { id: 'D14', deck: 'day', type: 'encounter', enemy: 'beast', title: '成群的野兽',
    text: '不是一只。你数到第四只就停下了。它们不急着扑上来，因为不需要。' },

  { id: 'D15', deck: 'day', type: 'mystery', title: '泉水',
    text: '一汪清澈的水，水面平静得没有一丝波纹。水底沉着一些看起来像牙齿的东西。',
    choices: [
      { label: '喝', desc: '回复体力，可能出事。',
        fx: { team: { stamina: 3, sanity: -1 } }, result: '水是甜的。你很久没喝过这么甜的水了。' },
      { label: '装进水壶', desc: '获得净水。',
        fx: { give: { id: 'water', qty: 2 } }, result: '你装了两壶，没提水底的东西。' },
      { label: '洗把脸就走', desc: '只需要一点清醒。',
        fx: { team: { sanity: 1 } }, result: '冷水让你清醒了。可倒影里的脸，好像没在笑。' }
    ] },

  { id: 'D16', deck: 'day', type: 'skip', title: '迷路',
    text: '你走了很久，然后看见了半小时前自己留下的记号。',
    fx: { team: { sanity: -1 }, extra: { skipAction: true } },
    result: '这一整天都白走了。' },

  { id: 'D17', deck: 'day', type: 'mystery', title: '另一支队伍',
    text: '对方也有四个人，也和你一样脏、一样累。他们问你是不是也要去湖边。',
    choices: [
      { label: '交换情报', desc: '得到前进的线索。',
        fx: { progress: 2, team: { sanity: -1 } }, result: '他们指了个方向。临走时说："别数人数。"' },
      { label: '装作听不懂', desc: '不交换，也不招惹。',
        fx: {}, result: '你们错身而过。走了十几步，你回头看，他们也正好回头。' },
      { label: '抢走他们的补给', desc: '得到物资，但失去某些东西。',
        fx: { give: { id: 'ration', qty: 3 }, team: { sanity: -2 } }, result: '他们没反抗。太顺利了，顺利得让人不安。' }
    ] },

  { id: 'D18', deck: 'day', type: 'hazard', title: '太阳太毒', check: { stat: 'stamina', dc: 3 },
    text: '头顶的枝叶忽然变得很稀，太阳直直地照下来。',
    ok: { team: { stamina: -1 }, result: '你找了一片阴影，喘了会儿气。' },
    bad: { team: { stamina: -2, hp: -1 }, result: '你开始说胡话。你把水都喝了。' } },

  { id: 'D19', deck: 'day', type: 'encounter', enemy: 'unknown', title: '林间空地',
    text: '空地的正中央，空气在微微地扭动。你看不出那里有什么，但你确定那里有什么。' },

  { id: 'D20', deck: 'day', type: 'mystery', title: '石堆路标',
    text: '一堆垒起来的石头，顶端插着一根断裂的木牌。字迹被雨水泡糊了，只能认出"湖"和"不要"。',
    choices: [
      { label: '照它指的方向走', desc: '冒险相信一个陌生人。',
        fx: { progress: 1, take: { id: 'stick', qty: 1 } }, result: '木牌断了，你把它带上当柴。方向看起来是对的。' },
      { label: '拆掉石堆', desc: '也许底下有东西。',
        fx: { give: { id: 'odd_stone', qty: 1 }, team: { sanity: -1 } }, result: '石堆底下压着一枚温热的石头。它一直在跳。' },
      { label: '绕开', desc: '不碰来路不明的东西。',
        fx: {}, result: '你绕过去了。走了两百米，又看见一堆一模一样的石头。' }
    ] },

  { id: 'D21', deck: 'day', type: 'hazard', title: '树上的蜂巢', check: { stat: 'stamina', dc: 5 },
    text: '一个巨大的蜂巢挂在你够得着的枝上。里面有蜜。',
    ok: { give: { id: 'berry', qty: 2 }, self: { hp: -1 }, result: '你弄到了蜜，代价是手上多了几个包。' },
    bad: { self: { hp: -2 }, status: 'poisoned', result: '你从树上摔了下来。蜂还在追。' } },

  { id: 'D22', deck: 'day', type: 'hazard', title: '孩子的笑声', check: { stat: 'sanity', dc: 5 },
    text: '林子里传来孩子的笑声，很近，绕着你转。这片林子里没有孩子。',
    ok: { team: { sanity: -1 }, result: '你没有回头。这是唯一正确的做法。' },
    bad: { team: { sanity: -2 }, status: 'madness', result: '你开始追那个声音。你一边追一边笑。' } },

  { id: 'D23', deck: 'day', type: 'skip', title: '雷雨',
    text: '雨来得毫无预兆。你只能躲在一处岩壁下，看着雨把整个世界糊成一片白。',
    fx: { team: { sanity: -1, stamina: -1 }, extra: { skipAction: true } },
    result: '雨停时，天已经黑了。你一整天什么都没做成。' },

  { id: 'D24', deck: 'day', type: 'mystery', title: '树洞里的东西',
    text: '树洞里塞着一包用油布裹好的东西。裹得很仔细，像是有人打算回来拿。',
    choices: [
      { label: '拿走', desc: '得到补给。',
        fx: { give: { id: 'jerky', qty: 2 }, team: { sanity: -1 } }, result: '腌肉。还是好的。油布上绣着一个名字，被划掉了。' },
      { label: '原样放回', desc: '不碰别人的东西。',
        fx: { team: { sanity: 1 } }, result: '你把油布按原样塞回去。走出很远，你觉得有什么东西松了一口气。' }
    ] },

  /* ============ 夜晚通用 ============ */
  { id: 'N01', deck: 'night', type: 'encounter', enemy: 'beast', ambush: true, title: '夜里的第一声',
    text: '你还没反应过来，它已经在你面前了。篝火的光只照亮了它的牙。' },

  { id: 'N02', deck: 'night', type: 'encounter', enemy: 'savage', title: '围着火的人',
    text: '火堆外面站着一圈人。它们不动，就那么站着，看你。' },

  { id: 'N03', deck: 'night', type: 'hazard', title: '火堆边的影子', check: { stat: 'sanity', dc: 5 },
    text: '影子在地上被火拉得很长。你一个人的影子，有两条。',
    ok: { team: { sanity: -1 }, result: '你往火里添了柴，影子缩回去了。' },
    bad: { team: { sanity: -2 }, status: 'madness', result: '你开始跟那条多出来的影子说话。' } },

  { id: 'N04', deck: 'night', type: 'mystery', title: '火快灭了',
    text: '最后一点柴就要烧完了。黑暗正在一寸一寸地推进。',
    choices: [
      { label: '烧掉背包里的柴', desc: '保住火，但烧掉材料。',
        fx: { team: { sanity: 1 }, take: { id: 'stick', qty: 3 } }, result: '火重新旺起来。代价是明天的柴要重新捡。' },
      { label: '就这样睡', desc: '省下东西，但夜会很难熬。',
        fx: { team: { sanity: -2, stamina: -2 } }, result: '你缩成一团，没有真正睡着。' }
    ] },

  { id: 'N05', deck: 'night', type: 'encounter', enemy: 'cultist', title: '远处的仪式',
    text: '歌声从林子深处传来，一唱一和。你数了数，至少七个人。' },

  { id: 'N06', deck: 'night', type: 'hazard', title: '梦', check: { stat: 'sanity', dc: 4 },
    text: '你梦见自己站在湖中央，水只到腰。岸上有人在向你招手，脸是模糊的。',
    ok: { team: { sanity: -1 }, result: '你惊醒时天还没亮。岸边没有人。' },
    bad: { team: { sanity: -1, stamina: -2 }, result: '你醒不过来。你是咬破嘴唇才醒的，你还在说梦话。' } },

  { id: 'N07', deck: 'night', type: 'hazard', title: '夜雨', check: { stat: 'hp', dc: 4 },
    text: '雨顺着脖子灌进衣服，冷得钻心。火已经没救了。',
    ok: { team: { stamina: -2 }, result: '你抱着膝盖坐着，熬到了天亮。' },
    bad: { team: { hp: -2, sanity: -1 }, result: '天亮时，你的嘴唇是青的。' } },

  { id: 'N08', deck: 'night', type: 'encounter', enemy: 'unknown', ambush: true, title: '它一直在那里',
    text: '篝火照不到的地方，有什么东西站了很久。它终于动了。' },

  { id: 'N09', deck: 'night', type: 'hazard', title: '哭声', check: { stat: 'sanity', dc: 5 },
    text: '有人在哭。声音很压抑，像是怕被听见。这片林子里只有你。',
    ok: { team: { sanity: -1 }, result: '你捂住耳朵，一直数到天亮。' },
    bad: { team: { sanity: -2 }, status: 'madness', result: '你顺着声音走过去，看见自己蹲在树后面哭。' } },

  { id: 'N10', deck: 'night', type: 'skip', title: '守夜的人睡着了',
    text: '轮到你守夜，你睡着了。等你醒来，天已经亮了——或者说，你希望那是天亮。',
    fx: { team: { sanity: -1, stamina: -2 }, extra: { skipAction: true } },
    result: '你丢了一样东西。你不记得自己有那样东西。' },

  { id: 'N11', deck: 'night', type: 'encounter', enemy: 'beast', title: '追猎',
    text: '它在后面跟了很久，久到你开始习惯那个脚步声。然后它不跟了。' },

  { id: 'N12', deck: 'night', type: 'mystery', title: '黑暗里的手',
    text: '有什么东西碰了碰你的手背，很轻，很凉。你没有动。',
    choices: [
      { label: '抓住它', desc: '搞清楚是什么。',
        fx: { self: { hp: -2, sanity: -1 }, give: { id: 'bone', qty: 1 } }, result: '你抓住了一把骨头。它在你手里散开了。' },
      { label: '装作没感觉到', desc: '不动，不响。',
        fx: { team: { sanity: -2 } }, result: '那只手在你手背上放了很久，然后拿走了你的体温。' },
      { label: '点火', desc: '用光把它逼退。',
        fx: { take: { id: 'stick', qty: 1 }, team: { sanity: 1 } }, result: '火光亮起的瞬间，什么都没有。但你知道刚才有。' }
    ] },

  { id: 'N13', deck: 'night', type: 'hazard', title: '失温', check: { stat: 'hp', dc: 4 },
    text: '你开始不觉得冷了。这是个坏消息。',
    ok: { self: { hp: -2 }, result: '你把外套裹得更紧。你抖了一整夜。' },
    bad: { self: { hp: -3, stamina: -2 }, status: 'bleeding', result: '你的手指发黑。你用刀割开了袖子。' } },

  { id: 'N14', deck: 'night', type: 'hazard', title: '星图不对', check: { stat: 'sanity', dc: 5 },
    text: '你抬头找北斗。天上有一组星星，形状是对的，位置不对。',
    ok: { team: { sanity: -1 }, result: '你强迫自己去看地面。地面至少是对的。' },
    bad: { team: { sanity: -2 }, result: '你盯着那组星星看了半夜，试图说服自己它们动了。' } },

  { id: 'N15', deck: 'night', type: 'encounter', enemy: 'savage', title: '骨头的声音',
    text: '骨头相碰的声音，从三个方向同时靠近。' },

  { id: 'N16', deck: 'night', type: 'mystery', title: '梦话',
    text: '你在睡梦里反复念一句话。听不清。你凑近了听自己的嘴。',
    choices: [
      { label: '叫醒自己', desc: '打断那句话。',
        fx: { team: { sanity: 1 }, self: { stamina: -1 } }, result: '你醒来后什么都不记得，只是一个劲地道谢。' },
      { label: '听完', desc: '也许能知道些什么。',
        fx: { team: { sanity: -2 }, progress: 1 }, result: '你听清了。你在念一段路线的描述，非常具体。' }
    ] },

  { id: 'N17', deck: 'night', type: 'encounter', enemy: 'beast', title: '火引来的东西',
    text: '火是个好东西，也是个信号。它来了。' },

  { id: 'N18', deck: 'night', type: 'hazard', title: '森林在移动', check: { stat: 'sanity', dc: 4 },
    text: '你认得这棵树——一小时前它在左边，现在它在右边。',
    ok: { team: { sanity: -1 }, progress: 1, result: '你顾不上想为什么，只是加快了脚步。' },
    bad: { progress: -1, team: { sanity: -2 }, result: '你往回走了很久，回到了同一个地方。' } },

  /* ============ 场景专属 ============ */
  { id: 'S_BF1', deck: 'day', scene: 'bright_forest', type: 'mystery', title: '光斑',
    text: '一片空旷的草地，阳光暖得不像这片森林该有的东西。',
    choices: [
      { label: '躺下休息', desc: '恢复精神与体力，但会耽误时间。',
        fx: { team: { sanity: 2, stamina: 2 }, progress: -1 }, result: '你躺了十分钟。你睡着了，被自己叫醒时在哭。' },
      { label: '继续赶路', desc: '不浪费这段好天气。',
        fx: { progress: 1 }, result: '你趁着有光多走了一段。' }
    ] },
  { id: 'S_BF2', deck: 'day', scene: 'bright_forest', type: 'mystery', title: '鹿',
    text: '一头鹿站在林间，没有跑。它看着你，眼睛很黑。',
    choices: [
      { label: '猎杀它', desc: '得到大量生肉。',
        fx: { give: { id: 'raw_meat', qty: 2 }, team: { sanity: -1 } }, result: '它没有挣扎。倒下的时候还在看你。' },
      { label: '放它走', desc: '什么都不做。',
        fx: { team: { sanity: 1 } }, result: '它转身走进林子里。走了几步，回头看了一眼。' }
    ] },
  { id: 'S_BF3', deck: 'day', scene: 'bright_forest', type: 'hazard', title: '低枝上的蜂巢', check: { stat: 'hp', dc: 3 },
    text: '蜂蜜的味道甜得发腻。你很想尝一口。',
    ok: { give: { id: 'berry', qty: 3 }, result: '你顺利取了一些，还顺手摘了果。' },
    bad: { self: { hp: -2, stamina: -1 }, result: '你被蜇得满头包，蜜一滴也没拿到。' } },

  { id: 'S_DF1', deck: 'day', scene: 'dark_forest', type: 'hazard', title: '苔藓下的雕像', check: { stat: 'sanity', dc: 5 },
    text: '一座被苔藓覆盖的石像。你擦掉苔藓，发现它的脸，是你自己的脸。',
    ok: { team: { sanity: -1 }, result: '你把苔藓又按了回去，按得很用力。' },
    bad: { team: { sanity: -2 }, status: 'madness', result: '你站在原地看了很久。你后来说，你看见了未来。' } },
  { id: 'S_DF2', deck: 'day', scene: 'dark_forest', type: 'mystery', title: '挂在树上的绳',
    text: '一根粗绳从高处垂下来，末端打着结。结是新的。',
    choices: [
      { label: '割下来带走', desc: '得到粗绳。',
        fx: { give: { id: 'rope', qty: 1 }, team: { sanity: -1 } }, result: '绳子很结实。割断的时候，树上有什么动了一下。' },
      { label: '拉一下', desc: '看看上面有什么。',
        fx: { self: { hp: -2 }, team: { sanity: -1 } }, result: '绳子另一头有重量。你拉了三下，掉下来的是一只鞋。' }
    ] },
  { id: 'S_DF3', deck: 'night', scene: 'dark_forest', type: 'encounter', enemy: 'unknown', title: '手印',
    text: '树干上有一排手印，从地面一直延伸到树冠，每一只都是湿的。' },

  { id: 'S_RS1', deck: 'day', scene: 'riverside', type: 'hazard', title: '浅滩的鱼群', check: { stat: 'stamina', dc: 3 },
    text: '水很浅，鱼群逆流挤在一起，用棍子就能打到。',
    ok: { give: { id: 'raw_fish', qty: 3 }, result: '你抓到三条，最大的那条牙齿很尖。' },
    bad: { self: { stamina: -2 }, result: '你滑进水里，鱼全跑了。衣服湿透。' } },
  { id: 'S_RS2', deck: 'day', scene: 'riverside', type: 'mystery', title: '对岸的人影',
    text: '河对岸站着一个人，正在向你挥手。水流太急，过不去。',
    choices: [
      { label: '挥手回应', desc: '也许对方能提供帮助。',
        fx: { team: { sanity: 1 }, progress: 1 }, result: '对方指了一个方向，然后走进雾里。' },
      { label: '躲起来观察', desc: '不暴露自己。',
        fx: { team: { sanity: -1 }, give: { id: 'bone', qty: 1 } }, result: '它挥了整整一个小时，动作频率一直没变。最后它走进水里，没溅起水花。' }
    ] },
  { id: 'S_RS3', deck: 'day', scene: 'riverside', type: 'mystery', title: '漂来的木箱',
    text: '一只木箱卡在石缝里，箱盖上钉着一张纸：收件人一栏写着你的名字。',
    choices: [
      { label: '打开', desc: '有补给，也有风险。',
        fx: { give: { id: 'ration', qty: 3 }, team: { sanity: -1 } }, result: '三包干粮，还有一张湿透的照片。照片上是四个人站在这个箱子里。' },
      { label: '推开它', desc: '不碰。',
        fx: { team: { sanity: 1 } }, result: '箱子顺着水漂走了。你看着它消失在拐弯处。' }
    ] },

  { id: 'S_SW1', deck: 'day', scene: 'swamp', type: 'hazard', title: '沼气', check: { stat: 'hp', dc: 5 },
    text: '泥水里冒出一串泡。你划了根火柴——然后整片水面烧了起来。',
    ok: { team: { hp: -1, stamina: -1 }, result: '你趴进泥里，火在水面上跑过去了。' },
    bad: { team: { hp: -3 }, status: 'poisoned', result: '火灭了之后，你吸进了那些烟。肺里像塞了棉花。' } },
  { id: 'S_SW2', deck: 'day', scene: 'swamp', type: 'hazard', title: '陷进去', check: { stat: 'stamina', dc: 5 },
    text: '泥浆到了腰。你越是挣扎，沉得越快。',
    ok: { self: { stamina: -3 }, result: '你把整个人的重量压在一根藤蔓上，一点一点挪了出来。' },
    bad: { self: { hp: -3, stamina: -3 }, team: { sanity: -1 }, result: '你爬出来时，正在念一些不属于你的名字。' } },
  { id: 'S_SW3', deck: 'night', scene: 'swamp', type: 'hazard', title: '沼泽里的灯', check: { stat: 'sanity', dc: 5 },
    text: '远处有一盏灯，在泥面上飘。它不照亮任何东西，只是自己亮着。',
    ok: { team: { sanity: -1 }, result: '你强迫自己盯住脚下。灯在视野边缘慢慢灭了。' },
    bad: { team: { sanity: -2 }, progress: -1, result: '你追着灯走了一段。你回过神来时，手里攥着一把泥。' } },

  { id: 'S_CL1', deck: 'day', scene: 'cliff', type: 'hazard', title: '落石', check: { stat: 'stamina', dc: 5 },
    text: '头顶的碎石开始滑动。整片崖壁都在动。',
    ok: { self: { hp: -1 }, result: '你贴着崖壁冲了过去，石头在身后砸出一个坑。' },
    bad: { team: { hp: -2 }, self: { hp: -2 }, status: 'bleeding', result: '你被砸中了腿。你花了很久才把自己架起来。' } },
  { id: 'S_CL2', deck: 'day', scene: 'cliff', type: 'mystery', title: '岩缝里的巢',
    text: '崖壁的缝里塞着一个用树枝和布条编的巢。里面有东西在动。',
    choices: [
      { label: '掏出来', desc: '材料很值钱。',
        fx: { give: { id: 'cloth', qty: 3 }, team: { sanity: -1 } }, result: '里面是布条和骨头。还有几颗牙，是你这个年纪的。' },
      { label: '留着', desc: '不打扰。',
        fx: { team: { sanity: 1 } }, result: '你绕开那道缝。走出很远，还听得见里面细小的动静。' }
    ] },
  { id: 'S_CL3', deck: 'day', scene: 'cliff', type: 'mystery', title: '断崖回望',
    text: '站在断崖上，整片森林在脚下铺开。你第一次看清了它的边界。',
    choices: [
      { label: '观察地形', desc: '确认方向，大幅提升进度。',
        fx: { progress: 2 }, result: '你记住了湖的位置。这是几天来最有价值的一眼。' },
      { label: '只是看看', desc: '让风吹一会儿。',
        fx: { team: { sanity: 3 } }, result: '你站在那里很久。没人说话，但你松了一口气。' }
    ] },

  { id: 'S_WF1', deck: 'day', scene: 'waterfall', type: 'mystery', title: '水帘后的洞',
    text: '瀑布后面有一个洞。洞口干燥，看得出有人在里面待过。',
    choices: [
      { label: '进去搜', desc: '可能有重要的东西。',
        fx: { give: { id: 'ration', qty: 2 }, team: { sanity: -1 }, progress: 1 }, result: '一个干透的背包。里面有干粮和一张手绘地图，画到了湖边。' },
      { label: '在洞口休整', desc: '安全地恢复。',
        fx: { team: { stamina: 3, sanity: 1 } }, result: '水声盖住了外面的一切。这是几天来最安静的一小时。' }
    ] },
  { id: 'S_WF2', deck: 'night', scene: 'waterfall', type: 'hazard', title: '轰鸣', check: { stat: 'sanity', dc: 4 },
    text: '水声太大，你听不见自己说话。你开始不确定自己还在不在。',
    ok: { team: { sanity: -1 }, result: '你抓住自己的手腕，一直没松。' },
    bad: { team: { sanity: -1, stamina: -2 }, result: '你对自己喊了半夜。天亮才发现，你一直站在原地。' } },
  { id: 'S_WF3', deck: 'day', scene: 'waterfall', type: 'hazard', title: '彩虹', check: { stat: 'sanity', dc: 3 },
    text: '水雾里挂着一道彩虹。它不该让你想哭。',
    ok: { team: { sanity: 2 }, result: '你看了很久。你笑了，这是几天来第一次。' },
    bad: { team: { sanity: -1 }, result: '彩虹里有一张脸。它比你先眨眼。' } },

  { id: 'S_LK1', deck: 'day', scene: 'lakeshore', type: 'mystery', title: '湖',
    text: '湖水很静。对岸有一道灰白的线。你需要一条船，或者别的什么。',
    choices: [
      { label: '扎木筏', desc: '消耗大量材料，换取渡湖的机会。',
        fx: { take: { id: 'stick', qty: 4 }, progress: 2, team: { stamina: -2 } }, result: '木筏很丑，但它浮起来了。' },
      { label: '沿岸绕行', desc: '慢，但不用下水。',
        fx: { team: { stamina: -2, sanity: -1 } }, result: '你沿着岸走了很久。湖比看起来大得多。' }
    ] },

  /* ============ 精英（rare，按阶段解锁） ============ */
  { id: 'E01', deck: 'any', type: 'encounter', enemy: 'bonechief', rare: true, minStage: 1, title: '骨面',
    text: '林子里有东西在等你。它站在路中间，脸上的骨头比别的高一截——那是它自己的头骨，缝在外面。' },
  { id: 'E02', deck: 'any', type: 'encounter', enemy: 'altar_warden', rare: true, minStage: 2, title: '一直跪着的东西',
    text: '祭坛前跪着一个东西。你走近时，它开始站起来。站起来的过程，花了很久。' },
  { id: 'E03', deck: 'any', type: 'encounter', enemy: 'mistwalker', rare: true, minStage: 3, title: '雾里有两个人的高度',
    text: '雾里有两个人的高度，但只有一个影子。它走得很慢，因为它不必快。' }
];
