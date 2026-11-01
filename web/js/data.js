/* =====================================================================
 * ForestTable · 数据层
 * ---------------------------------------------------------------------
 * 所有可调内容都在这里：角色、物品、配方、敌人、场景、事件牌。
 * 改数值、加卡牌、换文案，不需要碰任何逻辑代码。
 *
 * 效果(fx)语法：
 *   fx: {
 *     team:   { hp:-3, stamina:-4, sanity:-3 },   全队承受
 *     self:   { hp:-6 },                           仅判定者/决策者承受
 *     give:   { id:'stick', qty:2 }                获得物品
 *     take:   { id:'torch', qty:1 }                失去物品
 *     status: 'bleeding' | null                    附加状态
 *     progress: 1                                  前进进度
 *     heal:   10                                   恢复健康(仅self/team内用hp正数亦可)
 *   }
 *
 * 判定(check)语法：
 *   check: { stat:'stamina', dc:12 }
 *   ok / bad 为对应结果的效果
 * ===================================================================== */
window.FT = window.FT || {};

/* ---------------------------------------------------------------
 * 全局配置
 * --------------------------------------------------------------- */
FT.CONFIG = {
  VERSION: '1.0.0',
  SAVE_KEY: 'foresttable_save_v1',
  TURNS_PER_DAY: 5,
  DAY_TURNS: 3,             // 前 3 回合为白天
  BASE_SLOTS: 8,            // 基础背包格
  ADVANCE_PROGRESS: 3,      // 每次前进的进度
  PROGRESS_GOALS: [6, 7, 8, 9],  // 4 个阶段的进度阈值
  REST_STAMINA: 15,
  REST_SANITY: 4,
  REST_HP: 8,
  SOLO_DAMAGE_MULT: 0.72,   // 单人模式承受伤害系数（没有队友分担）
  ADVANCE_COST: 8,
  GATHER_COST: 5,
  TURN_STAMINA_COST: 3,
  DAY_SANITY_COST: 0,
  NIGHT_SANITY_COST: 2,
  FIRE_TURNS: 3,
  MAX_LOG: 200
};

/* ---------------------------------------------------------------
 * 场景
 * --------------------------------------------------------------- */
FT.SCENES = {
  bright_forest: {
    name: '明亮树林', art: 'bright_forest',
    tagline: '阳光穿过枝叶，在地上落成一片片摇晃的光斑。',
    gather: [['stick',40],['berry',25],['vine',20],['stone',15]],
    sanityMod: 0, checkMod: 0, enemyRate: 0.30,
    palette: ['#3d5a3a','#7d9457']
  },
  dark_forest: {
    name: '阴森树林', art: 'dark_forest',
    tagline: '苔藓吸走了所有声音。你听见自己的心跳。',
    gather: [['mushroom',25],['resin',25],['bone',20],['stick',30]],
    sanityMod: -1, checkMod: -1, enemyRate: 0.45,
    palette: ['#1e2a26','#3c4a3a']
  },
  riverside: {
    name: '河流岸边', art: 'riverside',
    tagline: '水声很响，响到可以盖住别的声音。',
    gather: [['raw_fish',30],['water',30],['stone',25],['cloth',15]],
    sanityMod: 0, checkMod: 0, enemyRate: 0.35,
    palette: ['#28414a','#5d8794']
  },
  swamp: {
    name: '沼泽', art: 'swamp',
    tagline: '每一步都要把脚从泥里拔出来，带着一声闷响。',
    gather: [['herb',30],['rot_meat',25],['vine',25],['water',20]],
    sanityMod: -1, checkMod: -1, enemyRate: 0.40,
    palette: ['#2c3226','#5a6350']
  },
  cliff: {
    name: '悬崖戈壁', art: 'cliff',
    tagline: '风从崖下灌上来，带着石头的腥味。',
    gather: [['flint',35],['stick',35],['stone',30]],
    sanityMod: 0, checkMod: -1, enemyRate: 0.35,
    palette: ['#3a3530','#8b7f6d']
  },
  waterfall: {
    name: '瀑布', art: 'waterfall',
    tagline: '轰鸣。水雾。偶尔一道彩虹挂在水帘上。',
    gather: [['water',40],['raw_fish',30],['moss',30]],
    sanityMod: 1, checkMod: 0, enemyRate: 0.25,
    palette: ['#22403f','#6f9d94']
  },
  lakeshore: {
    name: '森林边缘 · 湖畔', art: 'lakeshore',
    tagline: '雾散了。湖对岸是一道灰白的线——那是出口。',
    gather: [['cloth',30],['stone',30],['stick',40]],
    sanityMod: 1, checkMod: 0, enemyRate: 0.30,
    palette: ['#2a3340','#8f9aa8']
  }
};

/* ---------------------------------------------------------------
 * 角色
 * --------------------------------------------------------------- */
FT.CHARS = [
  {
    id:'porter', name:'脚夫', title:'背包客',
    hp:90, stamina:90, sanity:70, slotBonus:4,
    start:[['rope',2]],
    passive:'负重：背包多 4 格，且可为全队携带重物。',
    tag:'后勤'
  },
  {
    id:'hunter', name:'猎人', title:'追踪者',
    hp:85, stamina:80, sanity:65, slotBonus:0,
    start:[['rifle',1]],
    passive:'前进时额外 +1 进度；遇敌先手（首轮伤害 +2）。',
    tag:'开拓'
  },
  {
    id:'medic', name:'卫生员', title:'牧师',
    hp:80, stamina:75, sanity:85, slotBonus:0,
    start:[['medicine',1],['bandage',2]],
    passive:'所有治疗判定 +3；施救不占用额外回合。',
    tag:'救护'
  },
  {
    id:'apostle', name:'使徒', title:'低语者',
    hp:70, stamina:70, sanity:50, slotBonus:0,
    start:[['knife',1]],
    passive:'精神 ≤25 时全判定 +2；精神 ≥90 时进入崩溃（每回合精神 -3）。',
    tag:'异常'
  }
];

/* ---------------------------------------------------------------
 * 物品与食物
 * --------------------------------------------------------------- */
FT.ITEMS = {
  /* --- 材料 --- */
  stick:   { name:'树枝',   icon:'🪵', cat:'mat', desc:'干一点的能烧。' },
  stone:   { name:'石头',   icon:'🪨', cat:'mat', desc:'压手，也压得住锅。' },
  vine:    { name:'藤蔓',   icon:'🌿', cat:'mat', desc:'有韧性，能拧成绳。' },
  cloth:   { name:'布条',   icon:'🧣', cat:'mat', desc:'从衣服上撕下来的。' },
  resin:   { name:'树脂',   icon:'🫧', cat:'mat', desc:'黏手，易燃。' },
  bone:    { name:'骨头',   icon:'🦴', cat:'mat', desc:'不知道是什么的。' },
  mushroom:{ name:'蘑菇',   icon:'🍄', cat:'mat', desc:'颜色越鲜艳，越不该碰。' },
  herb:    { name:'药草',   icon:'☘️', cat:'mat', desc:'嚼起来很苦。' },
  moss:    { name:'苔藓',   icon:'🟩', cat:'mat', desc:'湿的，敷在伤口上能止血。' },
  flint:   { name:'燧石',   icon:'⬛', cat:'mat', desc:'两片一敲就出火星。' },

  /* --- 工具 --- */
  torch:     { name:'火把', icon:'🔥', cat:'tool', desc:'夜晚判定不受 -2 惩罚。', flags:['light'] },
  rope:      { name:'粗绳', icon:'🪢', cat:'tool', desc:'攀爬、渡水的必需品。' },
  bandage:   { name:'绷带', icon:'🩹', cat:'tool', desc:'恢复 20 健康，解除流血。', use:{ hp:20, cure:'bleeding' } },
  medicine:  { name:'药',   icon:'💊', cat:'tool', desc:'恢复 25 健康，解除中毒。', use:{ hp:25, cure:'poisoned' } },
  odd_stone: { name:'奇怪的石头', icon:'🔮', cat:'tool', desc:'贴身携带时，所有判定 +1。', flags:['luck'] },

  /* --- 武器 --- */
  knife:    { name:'匕首', icon:'🔪', cat:'weapon', dice:4,  hit:0, desc:'短，但够快。' },
  machete:  { name:'砍刀', icon:'⚔️', cat:'weapon', dice:6,  hit:0, desc:'开路的工具，也能开路。' },
  rifle:    { name:'猎枪', icon:'🔫', cat:'weapon', dice:8,  hit:2, desc:'声音很大，会招来别的东西。' },

  /* --- 食物 --- */
  ration:    { name:'干粮', food:true, icon:'🥖', stamina:12, expire:70, desc:'硬得能砸核桃。' },
  jerky:     { name:'腌肉', food:true, icon:'🥓', stamina:15, expire:60, desc:'咸，吃完口渴。' },
  berry:     { name:'野果', food:true, icon:'🫐', stamina:8,  expire:45, desc:'酸甜，有 10% 概率闹肚子。', poison:0.10 },
  water:     { name:'净水', food:true, icon:'💧', stamina:3,  expire:20, desc:'沼泽取的水要煮过。' },
  roast_meat:{ name:'烤肉', food:true, help:3, icon:'🍖', stamina:20, expire:12, desc:'油脂滴在火上，滋滋响。热的。' },
  meat_soup: { name:'肉汤', food:true, help:4, icon:'🍲', stamina:25, expire:10, desc:'一锅能分十份。喝的时候要吵一架。热的。', portions:10 },
  raw_meat:  { name:'生肉', food:true, icon:'🥩', stamina:10, expire:8,  desc:'血还是温的。', poison:0.20 },
  raw_fish:  { name:'鱼',   food:true, icon:'🐟', stamina:10, expire:8,  desc:'还在动。', poison:0.15 },
  rot_meat:  { name:'腐肉', food:true, icon:'🥀', stamina:8,  expire:6,  desc:'沼泽里捡的。也许还能吃。', poison:0.45 },
  spoiled:   { name:'腐败食物', food:true, icon:'🦠', stamina:6, expire:999, desc:'……真的要吃吗？', poison:0.60, spoiled:true },

  /* --- 特殊 --- */
  pot:       { name:'锅', icon:'🥘', cat:'tool', desc:'煮汤需要它。' },
  seed_bag:  { name:'种子袋', icon:'🌱', cat:'tool', desc:'植物学家的一切。' }
};

/* ---------------------------------------------------------------
 * 配方
 * --------------------------------------------------------------- */
FT.RECIPES = [
  { id:'r_fire',   out:'fire',      name:'篝火', req:{stick:3, stone:2}, fire:true,
    desc:'持续 3 回合。夜间精神消耗减半，可烹饪。沼泽地无法搭建。' },
  { id:'r_torch',  out:'torch',     name:'火把', req:{stick:1, cloth:1},
    desc:'夜晚判定不再 -2。' },
  { id:'r_rope',   out:'rope',      name:'粗绳', req:{vine:2},
    desc:'攀爬、渡水。' },
  { id:'r_bandage',out:'bandage',   name:'绷带', req:{cloth:2},
    desc:'恢复 15 健康，解除流血。' },
  { id:'r_medicine',out:'medicine', name:'药',   req:{herb:2, moss:1},
    desc:'恢复 20 健康，解除中毒。' },
  { id:'r_luck',   out:'odd_stone', name:'奇怪的石头', req:{flint:1, bone:1},
    desc:'携带时全判定 +1。谁拿？' },
  { id:'r_roast',  out:'roast_meat',name:'烤肉', req:{raw_meat:1}, needFire:true, cook:true,
    desc:'需要篝火。' },
  { id:'r_roastfish',out:'roast_meat',name:'烤鱼', req:{raw_fish:1}, needFire:true, cook:true,
    desc:'需要篝火。味道怪，但能吃。' },
  { id:'r_soup',   out:'meat_soup', name:'肉汤', req:{raw_meat:2, water:1, pot:1}, needFire:true, cook:true, keepTool:'pot',
    desc:'需要篝火与锅。产出 10 份，可分食。' }
];

/* ---------------------------------------------------------------
 * 敌人
 * --------------------------------------------------------------- */
FT.ENEMIES = {
  skull_savage: {
    name:'戴生物头骨的野人', hp:20, atk:[2,6], def:10, art:'skull_savage',
    desc:'它们把兽骨缝在脸上，看不出表情。',
    weak:'fire', group:[1,3],
    flavor:'骨头相碰的声音，从三个方向同时响起。'
  },
  cultist: {
    name:'野人信徒', hp:15, atk:[1,6], def:9, art:'cultist',
    desc:'它们不攻击，只是唱。',
    sanityDrain:3,
    flavor:'它们围着一块立石唱歌。你不该听懂那些词，但你听懂了。'
  },
  beast: {
    name:'野兽', hp:25, atk:[1,8], def:11, art:'beast',
    desc:'比狼大，比狼安静。',
    flavor:'灌木丛后面，有什么在同步呼吸。'
  },
  unknown: {
    name:'未知生命体', hp:40, atk:[1,4], def:13, art:'unknown',
    desc:'普通武器几乎无效。',
    sanityDrain:5, needsLight:true,
    flavor:'它没有轮廓——你看它的时候，它在看别的地方。'
  }
};

/* ---------------------------------------------------------------
 * 心理疾病症状
 * --------------------------------------------------------------- */
FT.SYMPTOMS = [
  { id:'hallucination', name:'幻觉', desc:'你总看见队伍里多了一个人。所有判定 -1。' },
  { id:'paranoia',      name:'偏执', desc:'你不相信任何人。分食物时只能拿最少的一份。' },
  { id:'aphasia',       name:'失语', desc:'你说不出完整的句子。投票时你的一票视为弃权。' }
];

/* ---------------------------------------------------------------
 * 事件牌
 * deck: day | night
 * type: encounter | mystery | hazard | skip
 * scene: 指定场景才出现（可选）
 * --------------------------------------------------------------- */
FT.CARDS = [

/* ============ 白天通用（24 张） ============ */
{ id:'D01', deck:'day', type:'encounter', enemy:'skull_savage', title:'树影里的人',
  text:'三个戴着兽骨头骨的野人从树影里走出来，它们没有说话，只是慢慢散开，把你围在中间。' },

{ id:'D02', deck:'day', type:'encounter', enemy:'beast', title:'同步的呼吸',
  text:'灌木丛后面传来呼吸声。你停下，呼吸也停下。你往前走，呼吸跟着往前走。' },

{ id:'D03', deck:'day', type:'mystery', title:'石制的祭坛',
  text:'一块被藤蔓缠住的石台，上面放着一只还很热的陶碗。汤是白的，飘着油花。',
  choices:[
    { label:'喝掉它', desc:'回复体力，但没人知道那是什么肉。',
      fx:{ team:{stamina:10}, give:{id:'spoiled',qty:1} }, result:'汤是咸的。喝完你才想起，这林子里没人会煮汤。' },
    { label:'倒掉它', desc:'安全，但队友会记住你浪费了食物。',
      fx:{ team:{sanity:2} }, result:'汤渗进石缝。你听见很轻的一声，像是叹气。' },
    { label:'连碗一起带走', desc:'占一格背包，很快会坏。',
      fx:{ give:{id:'meat_soup',qty:1} }, result:'碗还是温的。你把它塞进包里，不敢回头看祭坛。' }
  ] },

{ id:'D04', deck:'day', type:'hazard', title:'会说话的藤蔓', check:{stat:'sanity', dc:13},
  text:'藤蔓垂下来，末端轻轻地摆动。你听见它们在用你母亲的声音叫你的名字。',
  ok:{ team:{sanity:-1}, result:'你咬住舌头，血腥味把你拽了回来。' },
  bad:{ team:{sanity:-5}, status:'madness', result:'你应了一声。藤蔓停住了，然后笑。' } },

{ id:'D05', deck:'day', type:'hazard', title:'看不见底的泥', check:{stat:'stamina', dc:11},
  text:'地面看起来是硬的。踩下去，一直陷到膝盖。',
  ok:{ self:{stamina:-6}, result:'你把自己拔了出来，鞋留在了里面。' },
  bad:{ team:{hp:-5}, self:{stamina:-10}, result:'队友把你拖出来时，你的腿已经没有知觉了。' } },

{ id:'D06', deck:'day', type:'hazard', title:'断落的树枝', check:{stat:'hp', dc:12},
  text:'头顶传来一声脆响。你抬头，正好看见那根枝干开始下落。',
  ok:{ self:{hp:-4}, result:'你侧身躲过，只被擦破了肩膀。' },
  bad:{ self:{hp:-14}, status:'bleeding', result:'它砸在你背上。你听见自己的骨头响了一下。' } },

{ id:'D07', deck:'day', type:'mystery', title:'废弃的营地',
  text:'三顶塌掉的帐篷，一个冷掉的灰堆。睡袋里的人形已经很久没有动过了。',
  choices:[
    { label:'翻找物资', desc:'可能有补给，也可能惊动什么。',
      fx:{ give:{id:'ration',qty:2}, team:{sanity:-2} }, result:'两包干粮，还有一本写满同一句话的日记。' },
    { label:'替他们盖上土', desc:'耽误时间，但心里会好受些。',
      fx:{ team:{sanity:6}, progress:-1 }, result:'你们用石头堆了个小堆。没人说话。' },
    { label:'立刻离开', desc:'不碰任何东西。',
      fx:{}, result:'走出很远之后，你才发现队伍里没人回头。' }
  ] },

{ id:'D08', deck:'day', type:'encounter', enemy:'cultist', title:'立石前的歌声',
  text:'一块黑色的立石下，几个野人跪着唱歌。调子很简单，简单到你已经开始跟着哼了。' },

{ id:'D09', deck:'day', type:'hazard', title:'蜂群', check:{stat:'stamina', dc:12},
  text:'你踩到了什么。然后空气里全是嗡嗡声。',
  ok:{ self:{stamina:-5}, result:'你抱着头冲出去，只被蜇了两下。' },
  bad:{ self:{hp:-8}, self2:{stamina:-8}, result:'你的脸肿了起来，一只眼睛快要睁不开。' } },

{ id:'D10', deck:'day', type:'hazard', title:'刻满符号的树干', check:{stat:'sanity', dc:14},
  text:'整棵树皮被刻满了符号。你数了数，正好是你们的人数，多一个。',
  ok:{ team:{sanity:-2}, result:'你用布把它盖住了。没有人反对。' },
  bad:{ team:{sanity:-5}, status:'madness', result:'有人开始用手指在树上补刻。你拦不住。' } },

{ id:'D11', deck:'day', type:'mystery', title:'蘑菇圈',
  text:'一圈颜色鲜亮的蘑菇围出一块空地。圈里的草长得比外面高。',
  choices:[
    { label:'采走蘑菇', desc:'能吃，但风险自负。',
      fx:{ give:{id:'mushroom',qty:3} }, result:'蘑菇被采走的地方，草立刻枯了。' },
    { label:'在圈里休息', desc:'回复体力，但精神会更差。',
      fx:{ team:{stamina:12, sanity:-4} }, result:'你睡了二十分钟。醒来时天没变，但影子换了方向。' },
    { label:'绕着走', desc:'不惹事。',
      fx:{}, result:'你们绕了一大圈。没人提议走近看看。' }
  ] },

{ id:'D12', deck:'day', type:'hazard', title:'队友的旧物', check:{stat:'sanity', dc:12},
  text:'地上躺着一只你队友的水壶。可你的队友，就站在你旁边，腰上还挂着那只水壶。',
  ok:{ team:{sanity:-1}, result:'你把水壶踢进灌木，没让任何人看见。' },
  bad:{ team:{sanity:-4}, result:'他看见了。他坚持说那是他的。你们都不确定是谁记错了。' } },

{ id:'D13', deck:'day', type:'hazard', title:'倒下的巨木', check:{stat:'stamina', dc:12},
  text:'一棵巨大的倒木横在必经之路上，底下是空的，可以钻过去。',
  ok:{ progress:2, result:'你们钻了过去，省下一段路。' },
  bad:{ team:{stamina:-6}, self:{hp:-5}, result:'木头在身后塌下来。你们是滚过去的。' } },

{ id:'D14', deck:'day', type:'encounter', enemy:'beast', title:'成群的野兽',
  text:'不是一只。你数到第四只就停下了。它们不急着扑上来，因为不需要。' },

{ id:'D15', deck:'day', type:'mystery', title:'泉水',
  text:'一汪清澈的水，水面平静得没有一丝波纹。水底沉着一些看起来像牙齿的东西。',
  choices:[
    { label:'喝', desc:'回复体力，可能出事。',
      fx:{ team:{stamina:8, sanity:-2} }, result:'水是甜的。你很久没喝过这么甜的水了。' },
    { label:'装进水壶', desc:'获得净水。',
      fx:{ give:{id:'water',qty:2} }, result:'你们装了两壶，谁也没提水底的东西。' },
    { label:'洗把脸就走', desc:'只需要一点清醒。',
      fx:{ team:{sanity:4} }, result:'冷水让你清醒了。可你在倒影里看到的脸，好像没在笑。' }
  ] },

{ id:'D16', deck:'day', type:'skip', title:'迷路',
  text:'你们走了很久，然后看见了半小时前自己留下的记号。',
  fx:{ team:{sanity:-2}, extra:{ skipAction:true } },
  result:'这一整天都白走了。' },

{ id:'D17', deck:'day', type:'mystery', title:'另一支队伍',
  text:'对方也有四名队员，也和你们一样脏、一样累。他们问你们是不是也要去湖边。',
  choices:[
    { label:'交换情报', desc:'得到前进的线索，但要说真话。',
      fx:{ progress:3, team:{sanity:-1} }, result:'他们指了个方向。临走时，他们说："别数人数。"' },
    { label:'装作听不懂', desc:'不交换，也不招惹。',
      fx:{}, result:'你们错身而过。走了十几步，你回头看，他们也正好回头。' },
    { label:'抢走他们的补给', desc:'得到物资，但失去某些东西。',
      fx:{ give:{id:'ration',qty:3}, team:{sanity:-6} }, result:'他们没反抗。太顺利了，顺利得让人不安。' }
  ] },

{ id:'D18', deck:'day', type:'hazard', title:'太阳太毒', check:{stat:'stamina', dc:10},
  text:'头顶的枝叶忽然变得很稀，太阳直直地照下来。',
  ok:{ team:{stamina:-4}, result:'你们找了一片阴影，喘了会儿气。' },
  bad:{ team:{stamina:-9, hp:-3}, result:'有人开始说胡话。你们把水都给了他。' } },

{ id:'D19', deck:'day', type:'encounter', enemy:'unknown', title:'林间空地',
  text:'空地的正中央，空气在微微地扭动。你看不出那里有什么，但你确定那里有什么。' },

{ id:'D20', deck:'day', type:'mystery', title:'石堆路标',
  text:'一堆垒起来的石头，顶端插着一根断裂的木牌。字迹被雨水泡糊了，只能认出"湖"和"不要"。',
  choices:[
    { label:'照它指的方向走', desc:'冒险相信一个陌生人。',
      fx:{ progress:2, take:{id:'stick',qty:1} }, result:'木牌断了，你把它带上当柴。方向看起来是对的。' },
    { label:'拆掉石堆', desc:'也许底下有东西。',
      fx:{ give:{id:'odd_stone',qty:1}, team:{sanity:-2} }, result:'石堆底下压着一枚温热的石头。它一直在跳。' },
    { label:'绕开', desc:'不碰来路不明的东西。',
      fx:{}, result:'你们绕过去了。走了两百米，又看见一堆一模一样的石头。' }
  ] },

{ id:'D21', deck:'day', type:'hazard', title:'树上的蜂巢', check:{stat:'stamina', dc:13},
  text:'一个巨大的蜂巢挂在你够得着的枝上。里面有蜜。',
  ok:{ give:{id:'berry',qty:2}, self:{hp:-3}, result:'你弄到了蜜，代价是手上多了几个包。' },
  bad:{ self:{hp:-9}, status:'poisoned', result:'你从树上摔了下来。蜂还在追。' } },

{ id:'D22', deck:'day', type:'hazard', title:'孩子的笑声', check:{stat:'sanity', dc:13},
  text:'林子里传来孩子的笑声，很近，绕着你转。你们当中没有孩子。',
  ok:{ team:{sanity:-2}, result:'你们谁都没有回头。这是唯一正确的做法。' },
  bad:{ team:{sanity:-5}, status:'madness', result:'有人开始追那个声音。你们把他按在地上，他还在笑。' } },

{ id:'D23', deck:'day', type:'skip', title:'雷雨',
  text:'雨来得毫无预兆。你们只能躲在一处岩壁下，看着雨把整个世界糊成一片白。',
  fx:{ team:{sanity:-2, stamina:-4}, extra:{ skipAction:true } },
  result:'雨停时，天已经黑了。你们一整天什么都没做成。' },

{ id:'D24', deck:'day', type:'mystery', title:'树洞里的东西',
  text:'树洞里塞着一包用油布裹好的东西。裹得很仔细，像是有人打算回来拿。',
  choices:[
    { label:'拿走', desc:'得到补给。',
      fx:{ give:{id:'jerky',qty:2}, team:{sanity:-2} }, result:'腌肉。还是好的。油布上绣着一个名字，被划掉了。' },
    { label:'原样放回', desc:'不碰别人的东西。',
      fx:{ team:{sanity:4} }, result:'你把油布按原样塞回去。走出很远，你觉得有什么东西松了一口气。' }
  ] },

/* ============ 夜晚通用（18 张） ============ */
{ id:'N01', deck:'night', type:'encounter', enemy:'beast', ambush:true, title:'夜里的第一声',
  text:'你还没反应过来，它已经在你面前了。篝火的光只照亮了它的牙。' },

{ id:'N02', deck:'night', type:'encounter', enemy:'skull_savage', title:'围着火的人',
  text:'火堆外面站着一圈人。它们不动，就那么站着，看你们。' },

{ id:'N03', deck:'night', type:'hazard', title:'火堆边的影子', check:{stat:'sanity', dc:13},
  text:'影子在地上被火拉得很长。你们四个人的影子，有五条。',
  ok:{ team:{sanity:-2}, result:'你往火里添了柴，影子缩回去了。' },
  bad:{ team:{sanity:-5}, status:'madness', result:'有人开始跟那条多出来的影子说话。' } },

{ id:'N04', deck:'night', type:'mystery', title:'火快灭了',
  text:'最后一点柴就要烧完了。黑暗正在一寸一寸地推进。',
  choices:[
    { label:'烧掉一件装备', desc:'保住火，但失去一件物品。',
      fx:{ team:{sanity:5}, take:{id:'stick',qty:3} }, result:'火重新旺起来。代价是明天的柴要重新捡。' },
    { label:'就这样睡', desc:'省下东西，但夜会很难熬。',
      fx:{ team:{sanity:-5, stamina:-5} }, result:'你们挤在一起，谁都没有真正睡着。' }
  ] },

{ id:'N05', deck:'night', type:'encounter', enemy:'cultist', title:'远处的仪式',
  text:'歌声从林子深处传来，一唱一和。你数了数，至少七个人。' },

{ id:'N06', deck:'night', type:'hazard', title:'梦', check:{stat:'sanity', dc:12},
  text:'你梦见自己站在湖中央，水只到腰。岸上有人在向你招手，脸是模糊的。',
  ok:{ team:{sanity:-2}, result:'你惊醒时天还没亮。岸边没有人。' },
  bad:{ team:{sanity:-4, stamina:-5}, result:'你醒不过来。是队友把你摇醒的，你还在说梦话。' } },

{ id:'N07', deck:'night', type:'hazard', title:'夜雨', check:{stat:'hp', dc:11},
  text:'雨顺着脖子灌进衣服，冷得钻心。火已经没救了。',
  ok:{ team:{stamina:-5}, result:'你们背靠背坐着，熬到了天亮。' },
  bad:{ team:{hp:-6, sanity:-2}, result:'天亮时，有人的嘴唇是青的。' } },

{ id:'N08', deck:'night', type:'encounter', enemy:'unknown', ambush:true, title:'它一直在那里',
  text:'篝火照不到的地方，有什么东西站了很久。它终于动了。' },

{ id:'N09', deck:'night', type:'hazard', title:'哭声', check:{stat:'sanity', dc:14},
  text:'有人在哭。声音很压抑，像是怕被听见。你们四个人都在。',
  ok:{ team:{sanity:-2}, result:'你捂住耳朵，一直数到天亮。' },
  bad:{ team:{sanity:-6}, status:'madness', result:'你顺着声音走过去，看见自己蹲在树后面哭。' } },

{ id:'N10', deck:'night', type:'skip', title:'守夜的人睡着了',
  text:'轮到守夜的人睡着了。等所有人醒来，天已经亮了——或者说，你们希望那是天亮。',
  fx:{ team:{sanity:-4, stamina:-6}, extra:{ skipAction:true } },
  result:'有人丢了一样东西。没人承认是自己弄丢的。' },

{ id:'N11', deck:'night', type:'encounter', enemy:'beast', title:'追猎',
  text:'它在你们后面跟了很久，久到你们开始习惯那个脚步声。然后它不跟了。' },

{ id:'N12', deck:'night', type:'mystery', title:'黑暗里的手',
  text:'有什么东西碰了碰你的手背，很轻，很凉。你没有动。',
  choices:[
    { label:'抓住它', desc:'搞清楚是什么。',
      fx:{ self:{hp:-6, sanity:-3}, give:{id:'bone',qty:1} }, result:'你抓住了一把骨头。它在你手里散开了。' },
    { label:'装作没感觉到', desc:'不动，不响。',
      fx:{ team:{sanity:-4} }, result:'那只手在你手背上放了很久，然后拿走了你的体温。' },
    { label:'点火', desc:'用光把它逼退。',
      fx:{ take:{id:'stick',qty:1}, team:{sanity:2} }, result:'火光亮起的瞬间，什么都没有。但你们都觉得刚才有。' }
  ] },

{ id:'N13', deck:'night', type:'hazard', title:'失温', check:{stat:'hp', dc:12},
  text:'你开始不觉得冷了。这是个坏消息。',
  ok:{ self:{hp:-5}, result:'队友把外套裹在你身上。你抖了一整夜。' },
  bad:{ self:{hp:-12, stamina:-8}, status:'bleeding', result:'你的手指发黑。有人用刀割开了你的袖子。' } },

{ id:'N14', deck:'night', type:'hazard', title:'星图不对', check:{stat:'sanity', dc:13},
  text:'你抬头找北斗。天上有一组星星，形状是对的，位置不对。',
  ok:{ team:{sanity:-2}, result:'你强迫自己去看地面。地面至少是对的。' },
  bad:{ team:{sanity:-5}, result:'你们争论了很久该往哪走。最后谁也没说服谁，你们原地坐了一夜。' } },

{ id:'N15', deck:'night', type:'encounter', enemy:'skull_savage', title:'骨头的声音',
  text:'骨头相碰的声音，从三个方向同时靠近。' },

{ id:'N16', deck:'night', type:'mystery', title:'队友的梦话',
  text:'有人在睡梦里反复念一句话。听不清。你凑近了听。',
  choices:[
    { label:'叫醒他', desc:'打断那句話。',
      fx:{ team:{sanity:3}, self:{stamina:-3} }, result:'他醒来后什么都不记得，只是一个劲地道谢。' },
    { label:'听完', desc:'也许能知道些什么。',
      fx:{ team:{sanity:-4}, progress:1 }, result:'你听清了。他在念一段路线的描述，非常具体。' }
  ] },

{ id:'N17', deck:'night', type:'encounter', enemy:'beast', title:'火引来的东西',
  text:'火是个好东西，也是个信号。它来了。' },

{ id:'N18', deck:'night', type:'hazard', title:'森林在移动', check:{stat:'sanity', dc:12},
  text:'你认得这棵树——一小时前它在你们左边，现在它在右边。',
  ok:{ team:{sanity:-2}, progress:1, result:'你们顾不上想为什么，只是加快了脚步。' },
  bad:{ progress:-2, team:{sanity:-4}, result:'你们往回走了很久，回到了同一个地方。' } },

/* ============ 场景专属（18 张） ============ */
/* 明亮树林 */
{ id:'S_BF1', deck:'day', scene:'bright_forest', type:'mystery', title:'光斑',
  text:'一片空旷的草地，阳光暖得不像这片森林该有的东西。',
  choices:[
    { label:'躺下休息', desc:'恢复精神与体力，但会耽误时间。',
      fx:{ team:{sanity:8, stamina:8}, progress:-1 }, result:'你们躺了十分钟。有人睡着了，被叫醒时在哭。' },
    { label:'继续赶路', desc:'不浪费这段好天气。',
      fx:{ progress:2 }, result:'你们趁着有光多走了一段。' }
  ] },
{ id:'S_BF2', deck:'day', scene:'bright_forest', type:'mystery', title:'鹿',
  text:'一头鹿站在林间，没有跑。它看着你们，眼睛很黑。',
  choices:[
    { label:'猎杀它', desc:'得到大量生肉。',
      fx:{ give:{id:'raw_meat',qty:2}, team:{sanity:-2} }, result:'它没有挣扎。倒下的时候还在看你。' },
    { label:'放它走', desc:'什么都不做。',
      fx:{ team:{sanity:5} }, result:'它转身走进林子里。走了几步，回头看了一眼。' }
  ] },
{ id:'S_BF3', deck:'day', scene:'bright_forest', type:'hazard', title:'低枝上的蜂巢', check:{stat:'hp', dc:11},
  text:'蜂蜜的味道甜得发腻。你很想尝一口。',
  ok:{ give:{id:'berry',qty:3}, result:'你顺利取了一些，还顺手摘了果。' },
  bad:{ self:{hp:-8, stamina:-4}, result:'你被蜇得满头包，蜜一滴也没拿到。' } },

/* 阴森树林 */
{ id:'S_DF1', deck:'day', scene:'dark_forest', type:'hazard', title:'苔藓下的雕像', check:{stat:'sanity', dc:14},
  text:'一座被苔藓覆盖的石像。你擦掉苔藓，发现它的脸，是你们当中一个人的脸。',
  ok:{ team:{sanity:-2}, result:'你把苔藓又按了回去，按得很用力。' },
  bad:{ team:{sanity:-7}, status:'madness', result:'那个人站在原地看了很久。他后来说，他看见了未来。' } },
{ id:'S_DF2', deck:'day', scene:'dark_forest', type:'mystery', title:'挂在树上的绳',
  text:'一根粗绳从高处垂下来，末端打着结。结是新的。',
  choices:[
    { label:'割下来带走', desc:'得到粗绳。',
      fx:{ give:{id:'rope',qty:1}, team:{sanity:-2} }, result:'绳子很结实。割断的时候，树上有什么动了一下。' },
    { label:'拉一下', desc:'看看上面有什么。',
      fx:{ self:{hp:-8}, team:{sanity:-4} }, result:'绳子另一头有重量。你拉了三下，它开始往下掉——掉下来的是一只鞋。' }
  ] },
{ id:'S_DF3', deck:'night', scene:'dark_forest', type:'encounter', enemy:'unknown', title:'手印',
  text:'树干上有一排手印，从地面一直延伸到树冠，每一只都是湿的。' },

/* 河流岸边 */
{ id:'S_RS1', deck:'day', scene:'riverside', type:'hazard', title:'浅滩的鱼群', check:{stat:'stamina', dc:10},
  text:'水很浅，鱼群逆流挤在一起，用棍子就能打到。',
  ok:{ give:{id:'raw_fish',qty:3}, result:'你们抓到三条，最大的那条牙齿很尖。' },
  bad:{ self:{stamina:-6}, result:'你滑进水里，鱼全跑了。衣服湿透。' } },
{ id:'S_RS2', deck:'day', scene:'riverside', type:'mystery', title:'对岸的人影',
  text:'河对岸站着一个人，正在向你挥手。水流太急，过不去。',
  choices:[
    { label:'挥手回应', desc:'也许对方能提供帮助。',
      fx:{ team:{sanity:3}, progress:1 }, result:'对方指了一个方向，然后走进雾里。' },
    { label:'躲起来观察', desc:'不暴露自己。',
      fx:{ team:{sanity:-3}, give:{id:'bone',qty:1} }, result:'它挥了整整一个小时，动作频率一直没变。最后它走进水里，没溅起水花。' }
  ] },
{ id:'S_RS3', deck:'day', scene:'riverside', type:'mystery', title:'漂来的木箱',
  text:'一只木箱卡在石缝里，箱盖上钉着一张纸：收件人一栏写着你们的名字。',
  choices:[
    { label:'打开', desc:'有补给，也有风险。',
      fx:{ give:{id:'ration',qty:3,}, team:{sanity:-3} }, result:'三包干粮，还有一张湿透的照片。照片上是你们四个，站在这个箱子里。' },
    { label:'推开它', desc:'不碰。',
      fx:{ team:{sanity:2} }, result:'箱子顺着水漂走了。你们看着它消失在拐弯处。' }
  ] },

/* 沼泽 */
{ id:'S_SW1', deck:'day', scene:'swamp', type:'hazard', title:'沼气', check:{stat:'hp', dc:13},
  text:'泥水里冒出一串泡。有人划了根火柴——然后整片水面烧了起来。',
  ok:{ team:{hp:-4, stamina:-4}, result:'你们趴进泥里，火在水面上跑过去了。' },
  bad:{ team:{hp:-11}, status:'poisoned', result:'火灭了之后，你们吸进了那些烟。肺里像塞了棉花。' } },
{ id:'S_SW2', deck:'day', scene:'swamp', type:'hazard', title:'陷进去', check:{stat:'stamina', dc:14},
  text:'泥浆到了腰。你越是挣扎，沉得越快。',
  ok:{ self:{stamina:-10}, result:'你把整个人的重量压在一根藤蔓上，一点一点挪了出来。' },
  bad:{ self:{hp:-14, stamina:-12}, team:{sanity:-3}, result:'队友用绳子把你拽出来时，你已经在念一些不属于你的名字了。' } },
{ id:'S_SW3', deck:'night', scene:'swamp', type:'hazard', title:'沼泽里的灯', check:{stat:'sanity', dc:13},
  text:'远处有一盏灯，在泥面上飘。它不照亮任何东西，只是自己亮着。',
  ok:{ team:{sanity:-2}, result:'你强迫自己盯住脚下。灯在视野边缘慢慢灭了。' },
  bad:{ team:{sanity:-5}, progress:-1, result:'有人追着灯走了一段。你们把他拉回来时，他手里攥着一把泥。' } },

/* 悬崖戈壁 */
{ id:'S_CL1', deck:'day', scene:'cliff', type:'hazard', title:'落石', check:{stat:'stamina', dc:13},
  text:'头顶的碎石开始滑动。整片崖壁都在动。',
  ok:{ self:{hp:-5}, result:'你们贴着崖壁冲了过去，石头在身后砸出一个坑。' },
  bad:{ team:{hp:-7}, self:{hp:-6}, status:'bleeding', result:'有人被砸中了腿。你们花了很久才把他架起来。' } },
{ id:'S_CL2', deck:'day', scene:'cliff', type:'mystery', title:'岩缝里的巢',
  text:'崖壁的缝里塞着一个用树枝和布条编的巢。里面有东西在动。',
  choices:[
    { label:'掏出来', desc:'材料很值钱。',
      fx:{ give:{id:'cloth',qty:3}, team:{sanity:-2} }, result:'里面是布条和骨头。还有几颗牙，是你这个年纪的。' },
    { label:'留着', desc:'不打扰。',
      fx:{ team:{sanity:3} }, result:'你们绕开那道缝。走出很远，还听得见里面细小的动静。' }
  ] },
{ id:'S_CL3', deck:'day', scene:'cliff', type:'mystery', title:'断崖回望',
  text:'站在断崖上，整片森林在脚下铺开。你第一次看清了它的边界。',
  choices:[
    { label:'观察地形', desc:'确认方向，大幅提升进度。',
      fx:{ progress:3 }, result:'你记住了湖的位置。这是几天来最有价值的一眼。' },
    { label:'只是看看', desc:'让风吹一会儿。',
      fx:{ team:{sanity:10} }, result:'你们站在那里很久。没人说话，但都松了一口气。' }
  ] },

/* 瀑布 */
{ id:'S_WF1', deck:'day', scene:'waterfall', type:'mystery', title:'水帘后的洞',
  text:'瀑布后面有一个洞。洞口干燥，看得出有人在里面待过。',
  choices:[
    { label:'进去搜', desc:'可能有重要的东西。',
      fx:{ give:{id:'ration',qty:2}, team:{sanity:-2}, progress:1 }, result:'一个干透的背包。里面有干粮和一张手绘地图，画到了湖边。' },
    { label:'在洞口休整', desc:'安全地恢复。',
      fx:{ team:{stamina:10, sanity:4} }, result:'水声盖住了外面的一切。这是几天来最安静的一小时。' }
  ] },
{ id:'S_WF2', deck:'night', scene:'waterfall', type:'hazard', title:'轰鸣',
  check:{stat:'sanity', dc:12},
  text:'水声太大，你听不见队友说话。你开始不确定他们还在不在。',
  ok:{ team:{sanity:-1}, result:'你抓住身边人的手腕，一直没松。' },
  bad:{ team:{sanity:-4, stamina:-5}, result:'你们互相喊了半夜。天亮才发现，四个人一直站在一起。' } },
{ id:'S_WF3', deck:'day', scene:'waterfall', type:'hazard', title:'彩虹', check:{stat:'sanity', dc:8},
  text:'水雾里挂着一道彩虹。它不该让你想哭。',
  ok:{ team:{sanity:8}, result:'你们看了很久。有人笑了，这是几天来第一次。' },
  bad:{ team:{sanity:-3}, result:'彩虹里有一张脸。它比你先眨眼。' } },

/* 终点 */
{ id:'S_LK1', deck:'day', scene:'lakeshore', type:'mystery', title:'湖',
  text:'湖水很静。对岸有一道灰白的线。你们需要一条船，或者别的什么。',
  choices:[
    { label:'扎木筏', desc:'消耗大量材料，换取渡湖的机会。',
      fx:{ take:{id:'stick',qty:4}, progress:2, team:{stamina:-10} }, result:'木筏很丑，但它浮起来了。' },
    { label:'沿岸绕行', desc:'慢，但不用下水。',
      fx:{ team:{stamina:-6, sanity:-2} }, result:'你们沿着岸走了很久。湖比看起来大得多。' }
  ] }
];
