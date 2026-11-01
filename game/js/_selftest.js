/* 无头自测：用桩件跑完整局。 node _selftest.js [局数]
 * v2：d6 判定 + 抢行动权战斗。机器人策略是"缺什么补什么"，比真人略保守。 */
const fs = require('fs'), path = require('path');
global.window = global;
function load(f) { new Function('window', fs.readFileSync(path.join(__dirname, f), 'utf8'))(global); }
load('data.js'); load('engine.js');
const T = FT.Engine._internal;
const errors = [];

function pickOpt(options) {
  const ok = options.filter(o => !o.disabled);
  const vals = ok.map(o => o.value);
  const st = FT.Engine.state;
  const p = st.players[0];

  /* 战斗动作 */
  if (vals.includes('atk')) {
    const hasUse = st.inv.some(i => FT.ITEMS[i.id] && FT.ITEMS[i.id].use);
    if (p.hp <= 2) return 'flee';
    if (p.hp <= p.maxHp * 0.45 && hasUse) return 'item';
    if (p.hp <= p.maxHp * 0.35) return 'def';
    return 'atk';
  }
  /* 战/逃 */
  if (vals.includes('fight')) {
    const hasMed = st.inv.some(i => FT.ITEMS[i.id] && FT.ITEMS[i.id].use);
    if (p.hp < p.maxHp * 0.3 && !hasMed) return 'flee';
    return 'fight';
  }
  /* 回合行动 */
  if (vals.includes('advance')) {
    const needRest = p.hp < p.maxHp * 0.4 || p.stamina < p.maxStamina * 0.3 ||
      p.sanity < p.maxSanity * 0.25 || p.status.includes('bleeding');
    if (needRest && Math.random() < 0.85) return 'rest';
    if (st.progress >= st.goal - 1) return 'advance';
    const r = Math.random();
    if (r < 0.55) return 'advance';
    if (r < 0.78) return 'gather';
    if (r < 0.9) return 'rest';
    return 'craft';
  }
  /* 休整的附加动作 */
  if (vals.includes('eat') && vals.includes('none')) {
    const hasMed = st.inv.some(i => FT.ITEMS[i.id] && FT.ITEMS[i.id].use);
    if (p.hp < p.maxHp * 0.6 && hasMed) return 'use';
    if (p.status.includes('poisoned') && hasMed) return 'use';
    return st.inv.some(i => FT.ITEMS[i.id] && FT.ITEMS[i.id].food) ? 'eat' : 'none';
  }
  /* 合成 */
  const rec = vals.filter(v => typeof v === 'string' && v.startsWith('r_'));
  if (rec.length) {
    const order = ['r_bandage', 'r_medicine', 'r_spear', 'r_machete', 'r_whet', 'r_fire', 'r_soup',
      'r_roast', 'r_torch', 'r_bow', 'r_shield', 'r_spike', 'r_powder', 'r_molotov', 'r_stickw', 'r_rope', 'r_luck'];
    for (const id of order) if (rec.includes(id)) return id;
    return rec[0];
  }
  const nonzero = ok.find(o => o.value !== 0 && o.value !== false);
  return nonzero ? nonzero.value : ok[0].value;
}

let beats = 0;
function panel() {
  return {
    head() {}, section() { return { querySelector() { return { innerHTML: '', insertAdjacentHTML() {} }; } }; },
    append() {},
    ask(options) { return Promise.resolve(pickOpt(options)); },
    d6(o) {
      const n = T.d6();
      const total = n + o.mod;
      return Promise.resolve({ roll: n, total, ok: n === 1 ? false : total >= o.dc, crit: n === 6 ? 1 : 0 });
    },
    versus(o) { beats++; return Promise.resolve(o.winner === 'left'); },
    next() { return Promise.resolve(true); },
    foodDivide(ctx) {
      const a = {}; a[ctx.players[0].id] = Math.min(3, ctx.portions);
      return Promise.resolve(a);
    }
  };
}

FT.UI = {
  stage: panel, render() {}, toast() {}, save() { return true; }, load() { return null; },
  clearSave() {}, gameOver() {}, debugPanel() {}, init() {}
};

async function runOne(seed, charId) {
  FT.Engine.newGame([{ name: 'T', charId }], seed);
  const st = FT.Engine.state;
  let turns = 0;
  while (!st.over && turns < 400) {
    turns++;
    try { await FT.Engine.runTurn(); }
    catch (e) { errors.push(`seed ${seed} turn ${turns}: ${e.message}\n   ${e.stack.split('\n')[1]}`); break; }
  }
  const p = st.players[0];
  return {
    seed, turns, over: st.over, victory: st.victory, phase: st.phase + 1, day: st.day,
    events: st.stats.events, fights: st.stats.fights, elites: st.stats.elites,
    eliteBeats: st.stats.eliteBeats, eliteWins: st.stats.eliteWins,
    crits: st.stats.crits, chain: st.stats.maxChain,
    hp: Math.round(p.hp), st2: Math.round(p.stamina), sa: Math.round(p.sanity),
    status: p.status.join(','), charId
  };
}

(async () => {
  const N = Number(process.argv[2] || 8);
  const chars = ['hunter', 'porter', 'medic', 'apostle'];
  const rows = [];
  for (let i = 0; i < N; i++) {
    beats = 0;
    const o = await runOne(2000 + i * 41, chars[i % chars.length]);
    o.beats = beats;
    rows.push(o);
    console.log(`#${String(i + 1).padStart(2)} ${o.charId.padEnd(7)} 回合=${String(o.turns).padStart(3)} ${o.over ? (o.victory ? '逃出 ✅' : '死亡 ❌') : '未结束 ⚠'} 阶段=${o.phase} 战斗=${o.fights}(精英${o.elites}) 节拍=${o.beats} 暴击=${o.crits} 最长连=${o.chain} 健${o.hp}/体${o.st2}/神${o.sa} ${o.status}`);
  }
  const win = rows.filter(r => r.victory).length;
  console.log('\n--- 汇总 ---');
  console.log('局数', rows.length, '通关', win, '死亡', rows.filter(r => r.over && !r.victory).length);
  console.log('平均回合', (rows.reduce((s, r) => s + r.turns, 0) / rows.length).toFixed(1),
    '| 平均战斗场次', (rows.reduce((s, r) => s + r.fights, 0) / rows.length).toFixed(1),
    '| 平均节拍/场', (rows.reduce((s, r) => s + r.beats, 0) / Math.max(1, rows.reduce((s, r) => s + r.fights, 0))).toFixed(1));
  const eb = rows.reduce((s, r) => s + r.eliteBeats, 0), ef = rows.reduce((s, r) => s + r.elites, 0);
  console.log('精英遭遇', ef, '| 精英击败', rows.reduce((s, r) => s + r.eliteWins, 0),
    '| 精英平均节拍', ef ? (eb / ef).toFixed(1) : '-', '| 暴击合计', rows.reduce((s, r) => s + r.crits, 0));
  if (errors.length) { console.log('\n!! 运行时错误', errors.length); errors.slice(0, 4).forEach(e => console.log(e)); process.exitCode = 1; }
  else console.log('无运行时错误 ✅');
})();
