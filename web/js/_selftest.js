/* =====================================================================
 * 无头自测：不加载 DOM，用桩件替身把整局游戏跑完若干次。
 * 用途：抓逻辑崩溃、死锁、数值不收敛。
 * 运行： node js/_selftest.js [局数]
 * ===================================================================== */
const fs = require('fs');
const path = require('path');

global.window = global;

function load(f) {
  const code = fs.readFileSync(path.join(__dirname, f), 'utf8');
  new Function('window', code)(global);
}
load('data.js');
load('engine.js');

const T = FT.Engine._internal;
let picked = [];
let errors = [];

const UI = {
  render() { },
  toast() { },
  save() { },
  load() { return null; },
  flash() { return Promise.resolve(); },
  say(o) { return Promise.resolve(true); },
  eventModal(c) { return Promise.resolve(true); },
  dice() { return Promise.resolve(1); },
  roll(o) {
    const n = T.roll(20);
    return Promise.resolve({ roll: n, total: n + o.mod, ok: n + o.mod >= o.dc });
  },
  choose(o) {
    const opts = o.options.filter(x => x.value !== null && x.value !== undefined);
    // 战斗优先选"战斗"，其余选第一项
    const st0 = FT.Engine.state;
    const hurt = st0.players.some(p => !p.dead && p.hp < p.maxHp * 0.45);
    const flee = opts.find(x => x.value === 'flee');
    const fight = opts.find(x => x.value === 'fight');
    const v = (hurt && flee) ? 'flee' : (fight ? 'fight' : opts[0].value);
    picked.push(String(v));
    return Promise.resolve(v);
  },
  vote(o) {
    // 一个"还算像人"的策略：缺什么补什么
    const st = FT.Engine.state;
    const ps = st.players.filter(p => !p.dead);
    const lowSan = ps.some(p => p.sanity < p.maxSanity * 0.45);
    const lowSta = ps.some(p => p.stamina < p.maxStamina * 0.5);
    const hasFood = st.inv.some(i => FT.ITEMS[i.id] && FT.ITEMS[i.id].food);
    let bias = { advance: 0.45, gather: 0.2, rest: 0.25, craft: 0.1 };
    if (lowSta || lowSan) bias = hasFood ? { rest: 0.65, gather: 0.15, advance: 0.15, craft: 0.05 }
                                        : { gather: 0.55, rest: 0.2, advance: 0.2, craft: 0.05 };
    const pool = [];
    o.options.forEach(op => {
      const w = bias[op.value] || 0.1;
      for (let i = 0; i < Math.round(w * 20); i++) pool.push(op.value);
    });
    const v = pool.length ? pool[Math.floor(Math.random() * pool.length)] : o.options[0].value;
    picked.push(String(v));
    return Promise.resolve(v);
  },
  craftMenu(ids) {
    if (!ids || !ids.length) return Promise.resolve(null);
    // 优先做能救命的
    const st = FT.Engine.state;
    const order = ['r_bandage', 'r_medicine', 'r_fire', 'r_soup', 'r_roast', 'r_torch', 'r_rope', 'r_luck', 'r_roastfish'];
    for (const id of order) if (ids.includes(id)) return Promise.resolve(id);
    return Promise.resolve(ids[0]);
  },
  restMenu() {
    const st = FT.Engine.state;
    const hasFood = st.inv.some(i => FT.ITEMS[i.id] && FT.ITEMS[i.id].food);
    const lowHp = st.players.some(p => !p.dead && p.hp < p.maxHp * 0.5);
    const hasMed = st.inv.some(i => FT.ITEMS[i.id] && FT.ITEMS[i.id].use);
    if (lowHp && hasMed) return Promise.resolve('use');
    if (hasFood) return Promise.resolve('eat');
    return Promise.resolve('none');
  },
  foodDivide(ctx) {
    const a = {};
    let left = ctx.portions;
    const order = ctx.players.map(p => p.id);
    let i = 0;
    while (left > 0 && i < order.length * 3) {
      const id = order[i % order.length];
      const take = Math.min(3, left);
      a[id] = (a[id] || 0) + take; left -= take; i++;
    }
    return Promise.resolve(a);
  },
  endTurnSummary() { return Promise.resolve(true); },
  gameOver(v, s) { UI._over = v; }
};

FT.UI = UI;

/* ---------------- 跑一局 ---------------- */
async function runOne(seed, roster) {
  FT.Engine.newGame(roster, seed);
  const st = FT.Engine.state;
  let turns = 0;
  while (!st.over && turns < 400) {
    turns++;
    try {
      await FT.Engine.runTurn();
    } catch (e) {
      errors.push(`seed ${seed} turn ${turns}: ${e.message}\n${e.stack.split('\n')[1]}`);
      break;
    }
    if (FT.Engine.state.over) break;
  }
  return {
    seed, turns,
    over: st.over, victory: st.victory, phase: st.phase + 1,
    day: st.day, deaths: st.stats.deaths,
    alive: st.players.filter(p => !p.dead).length,
    events: st.stats.events,
    inv: st.inv.length,
    log: st.log.length,
    detail: st.players.map(p => `${p.name}:${Math.round(p.hp)}/${Math.round(p.stamina)}/${Math.round(p.sanity)}${p.dead ? '✝' : ''}${p.status.length ? '[' + p.status.join(',') + ']' : ''}`).join('  ')
  };
}

(async () => {
  const N = Number(process.argv[2] || 6);
  const rosters = [
    [{ name: 'A', charId: 'porter' }, { name: 'B', charId: 'hunter' }, { name: 'C', charId: 'medic' }, { name: 'D', charId: 'apostle' }],
    [{ name: 'A', charId: 'hunter' }, { name: 'B', charId: 'medic' }]
  ];
  const rows = [];
  for (let i = 0; i < N; i++) {
    const r = rosters[i % rosters.length];
    const out = await runOne(1000 + i * 37, r);
    rows.push(out);
    console.log(
      `#${String(i + 1).padStart(2)}  seed=${out.seed}  回合=${String(out.turns).padStart(3)}  ` +
      `${out.over ? (out.victory ? '逃出 ✅' : '全灭 ❌') : '未结束 ⚠'}  阶段=${out.phase} 天=${out.day} ` +
      `存活=${out.alive} 事件=${out.events} 背包=${out.inv}`
    );
    console.log('     ' + out.detail);
  }
  console.log('\n--- 汇总 ---');
  console.log('局数', rows.length,
    '通关', rows.filter(r => r.victory).length,
    '全灭', rows.filter(r => r.over && !r.victory).length,
    '未结束', rows.filter(r => !r.over).length);
  const avg = rows.reduce((s, r) => s + r.turns, 0) / rows.length;
  console.log('平均回合数', avg.toFixed(1));
  if (errors.length) {
    console.log('\n!!! 运行时错误 ' + errors.length + ' 处');
    errors.slice(0, 5).forEach(e => console.log('  ' + e));
    process.exitCode = 1;
  } else {
    console.log('无运行时错误 ✅');
  }
})();
