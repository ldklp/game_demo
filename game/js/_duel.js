/* 单挑模拟：node js/_duel.js  [用来验证"精英 40~75 血"到底打不打得赢]
 * 机器人策略：血低于 35% 且无药就防守；有药就吃药；否则攻击。 */
const fs = require('fs'), path = require('path');
global.window = global;
function load(f) { new Function('window', fs.readFileSync(path.join(__dirname, f), 'utf8'))(global); }
load('data.js'); load('engine.js');
const T = FT.Engine._internal;

let CUR = null;
function panel() {
  return {
    head() {}, section() { return { querySelector() { return { innerHTML: '', insertAdjacentHTML() {} }; } }; },
    append() {}, next() { return Promise.resolve(true); },
    ask(options) {
      const vals = options.map(o => o.value);
      if (vals.includes('atk')) {
        const p = FT.Engine.state.players[0];
        const hasUse = FT.Engine.state.inv.some(i => FT.ITEMS[i.id] && FT.ITEMS[i.id].use);
        if (p.hp <= p.maxHp * 0.35 && hasUse && !CUR.usedItem) { CUR.usedItem = 1; return Promise.resolve('item'); }
        if (p.hp <= p.maxHp * 0.3) return Promise.resolve('def');
        return Promise.resolve('atk');
      }
      if (vals.includes('fight')) return Promise.resolve('fight');
      const idx = vals.findIndex(v => typeof v === 'number' && v >= 0);
      return Promise.resolve(idx >= 0 ? options[idx].value : vals[0]);
    },
    d6(o) { const n = T.d6(); return Promise.resolve({ roll: n, total: n + o.mod, ok: n !== 1 && n + o.mod >= o.dc }); },
    versus(o) { CUR.beats++; return Promise.resolve(o.winner === 'left'); },
    foodDivide(c) { return Promise.resolve({ [c.players[0].id]: 2 }); }
  };
}
FT.UI = { stage: panel, render() {}, toast() {}, save() {}, load() {}, clearSave() {}, gameOver() {}, debugPanel() {}, init() {} };

async function duel(charId, gear, enemyKey, phase, runs) {
  let win = 0, beats = 0, hpLeft = 0;
  for (let i = 0; i < runs; i++) {
    FT.Engine.newGame([{ name: 'T', charId }], 1000 + i * 7);
    const st = FT.Engine.state;
    st.phase = phase;
    gear.forEach(g => FT.Engine.addItem(g, 1));
    CUR = { beats: 0, usedItem: 0 };
    const card = { id: 'X', type: 'encounter', enemy: enemyKey, title: 'duel', text: '' };
    // 通过内部接口发起战斗
    await FT.Engine._internal.testCombat(card, panel());
    const p = st.players[0];
    if (p.hp > 0 && !p.dead) win++;
    beats += CUR.beats; hpLeft += Math.max(0, p.hp);
  }
  return { win: win / runs, beats: beats / runs, hp: hpLeft / runs };
}

(async () => {
  const cases = [
    ['hunter', ['rifle'], 'beast', 0, '猎人 · 猎枪 · 阶段1野兽'],
    ['hunter', ['rifle'], 'savage', 0, '猎人 · 猎枪 · 阶段1野人'],
    ['hunter', ['rifle', 'whetstone'], 'bonechief', 1, '猎人 · 猎枪+磨刀石 · 骨面酋长(42)'],
    ['hunter', ['rifle', 'whetstone', 'bone_spike'], 'bonechief', 1, '猎人 · 满配 · 骨面酋长(42)'],
    ['porter', ['spear', 'whetstone'], 'altar_warden', 2, '脚夫 · 长矛+磨刀石 · 祭坛看守(54)'],
    ['hunter', ['rifle', 'whetstone', 'bone_spike'], 'mistwalker', 3, '猎人 · 满配 · 雾中行者(72)'],
    ['medic', ['machete'], 'mistwalker', 3, '卫生员 · 砍刀 · 雾中行者(72)']
  ];
  for (const [c, g, e, ph, label] of cases) {
    const r = await duel(c, g, e, ph, 300);
    console.log(`${label.padEnd(34)} 胜率 ${(r.win * 100).toFixed(0).padStart(3)}%  平均节拍 ${r.beats.toFixed(1).padStart(4)}  平均残血 ${r.hp.toFixed(1)}`);
  }
})();
