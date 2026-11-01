/* 无头自测：桩件替身跑完整局。 node _selftest.js [局数] */
const fs = require('fs'), path = require('path');
global.window = global;
function load(f){ new Function('window', fs.readFileSync(path.join(__dirname,f),'utf8'))(global); }
load('data.js'); load('engine.js');
const T = FT.Engine._internal;
const errors = [];

function pickOpt(options, ctx){
  const ok = options.filter(o => !o.disabled);
  const vals = ok.map(o => o.value);
  const st = FT.Engine.state;
  if (vals.includes('advance')) {
    const p = st.players[0];
    const low = p.stamina < p.maxStamina*0.45 || p.sanity < p.maxSanity*0.4;
    const hasFood = st.inv.some(i => FT.ITEMS[i.id] && FT.ITEMS[i.id].food);
    if (low && hasFood) return 'rest';
    if (low && !hasFood) return 'gather';
    if (st.progress >= st.goal - 1) return 'advance';
    const r = Math.random();
    if (r < 0.55) return 'advance';
    if (r < 0.75) return 'gather';
    if (r < 0.88) return 'rest';
    return 'craft';
  }
  if (vals.includes('fight')) {
    const p = st.players[0];
    return p.hp < p.maxHp*0.45 ? 'flee' : 'fight';
  }
  if (vals.includes('eat') && vals.includes('none')) {
    const p = st.players[0];
    const hasMed = st.inv.some(i => FT.ITEMS[i.id] && FT.ITEMS[i.id].use);
    if (p.hp < p.maxHp*0.55 && hasMed) return 'use';
    if (p.status.includes('poisoned') && hasMed) return 'use';
    return st.inv.some(i => FT.ITEMS[i.id] && FT.ITEMS[i.id].food) ? 'eat' : 'none';
  }
  const rec = vals.filter(v => typeof v === 'string' && v.startsWith('r_'));
  if (rec.length) {
    const order = ['r_bandage','r_medicine','r_fire','r_soup','r_roast','r_torch','r_rope','r_luck','r_roastfish'];
    for (const id of order) if (rec.includes(id)) return id;
    return rec[0];
  }
  // 分食 / 神秘事件 / 其他：取第一个非零项
  const nonzero = ok.find(o => o.value !== 0 && o.value !== false);
  return nonzero ? nonzero.value : ok[0].value;
}

function panel(){
  return {
    head(){}, section(){}, append(){},
    ask(options){ return Promise.resolve(pickOpt(options)); },
    dice(o){ const n = T.roll(20); return Promise.resolve({roll:n,total:n+o.mod,ok:n+o.mod>=o.dc}); },
    next(){ return Promise.resolve(true); },
    foodDivide(ctx){
      const a = {};
      const p = ctx.players[0];
      a[p.id] = Math.min(3, ctx.portions);
      return Promise.resolve(a);
    }
  };
}

FT.UI = {
  stage: panel, render(){}, toast(){}, save(){ return true; }, load(){ return null; },
  clearSave(){}, gameOver(){}, debugPanel(){}, init(){}
};

async function runOne(seed, charId){
  FT.Engine.newGame([{ name:'T', charId }], seed);
  const st = FT.Engine.state;
  let turns = 0;
  while (!st.over && turns < 400) {
    turns++;
    try { await FT.Engine.runTurn(); }
    catch(e){ errors.push(`seed ${seed} turn ${turns}: ${e.message}\n   ${e.stack.split('\n')[1]}`); break; }
  }
  const p = st.players[0];
  return { seed, turns, over: st.over, victory: st.victory, phase: st.phase+1, day: st.day,
    events: st.stats.events, hp: Math.round(p.hp), st2: Math.round(p.stamina), sa: Math.round(p.sanity),
    status: p.status.join(','), dead: p.dead, charId };
}

(async () => {
  const N = Number(process.argv[2] || 8);
  const chars = ['porter','hunter','medic','apostle'];
  const rows = [];
  for (let i = 0; i < N; i++) {
    const o = await runOne(2000 + i*41, chars[i % chars.length]);
    rows.push(o);
    console.log(`#${String(i+1).padStart(2)} ${o.charId.padEnd(8)} 回合=${String(o.turns).padStart(3)} ${o.over ? (o.victory?'逃出 ✅':'死亡 ❌') : '未结束 ⚠'} 阶段=${o.phase} 天=${o.day} 健${o.hp}/体${o.st2}/神${o.sa} ${o.status}`);
  }
  console.log('\n--- 汇总 ---');
  console.log('局数', rows.length, '通关', rows.filter(r=>r.victory).length, '死亡', rows.filter(r=>r.over&&!r.victory).length);
  console.log('平均回合', (rows.reduce((s,r)=>s+r.turns,0)/rows.length).toFixed(1));
  if (errors.length) { console.log('\n!! 运行时错误', errors.length); errors.slice(0,4).forEach(e=>console.log(e)); process.exitCode=1; }
  else console.log('无运行时错误 ✅');
})();
