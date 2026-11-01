/* =====================================================================
 * 渲染冒烟测试：用极简 DOM 桩件跑 FT.UI.render()，检查模板有没有
 * 输出 undefined / NaN / [object Object] 之类的脏数据。
 * 运行： node js/_uitest.js
 * ===================================================================== */
const fs = require('fs');
const path = require('path');

global.window = global;
global.requestAnimationFrame = cb => setTimeout(cb, 0);
global.setTimeout = setTimeout;

/* ---------- 假 DOM ---------- */
function fakeEl(tag) {
  const store = {
    tagName: tag || 'div', innerHTML: '', textContent: '', className: '', id: '',
    style: {}, dataset: {}, children: [], disabled: false, value: '',
    scrollTop: 0, scrollHeight: 0, selectedOptions: [{ text: 'x · y' }]
  };
  const stub = {
    addEventListener() { }, removeEventListener() { }, appendChild() { return fakeEl(); },
    remove() { }, click() { }, closest() { return null; },
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    querySelector() { return fakeEl(); }, querySelectorAll() { return []; },
    setAttribute() { }, focus() { }
  };
  return new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (p in stub) return stub[p];
      if (p === Symbol.toPrimitive) return () => '';
      return () => fakeEl();
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

const els = {};
global.document = {
  createElement: t => fakeEl(t),
  querySelector(sel) { els[sel] = els[sel] || fakeEl(); return els[sel]; },
  querySelectorAll() { return []; },
  addEventListener() { },
  body: fakeEl()
};
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = v; },
  removeItem(k) { delete this._d[k]; }
};
global.location = { reload() { } };

/* ---------- 加载 ---------- */
function load(f) {
  const code = fs.readFileSync(path.join(__dirname, f), 'utf8');
  new Function('window', code)(global);
}
load('data.js');
load('engine.js');
load('ui.js');

/* ---------- 跑 ---------- */
const bad = [];
function scan(label, html) {
  if (!html) return;
  ['undefined', 'NaN', '[object Object]', 'null%'].forEach(t => {
    if (html.includes(t)) bad.push(`[${label}] 含 "${t}"`);
  });
}

FT.Engine.newGame([
  { name: '阿岩', charId: 'porter' },
  { name: '老陈', charId: 'hunter' },
  { name: '小满', charId: 'medic' },
  { name: '无名', charId: 'apostle' }
], 42);

const st = FT.Engine.state;
FT.Engine.runTurn; // 不自动跑，只测渲染

try {
  FT.UI.render();
  ['#topbar', '#playersCol', '#centerCol', '#invPanel', '#logPanel'].forEach(k => {
    scan(k, els[k] && els[k].innerHTML);
  });
  console.log('render() 执行成功');
} catch (e) {
  console.log('render() 抛错:', e.message);
  console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  process.exitCode = 1;
}

// 分支覆盖：夜晚 + 篝火 + 饥饿 + 濒死 + 心理疾病 + 多物品
st.turn = 5; st.fire = 2; st.progress = 3;
st.players[0].stamina = 10; st.players[0].status.push('hungry');
st.players[1].hp = 0; st.players[1].status.push('dying'); st.players[1].dyingTurns = 2;
st.players[2].sanity = 12; st.players[2].status.push('madness'); st.players[2].symptom = 'paranoia';
st.players[3].dead = true;
['stick', 'stone', 'torch', 'meat_soup', 'raw_meat', 'ration', 'odd_stone'].forEach(id => {
  const d = FT.ITEMS[id];
  FT.Engine.addItem(id, d.food ? 3 : 1, d.food ? d.expire : undefined);
});
try {
  FT.UI.render();
  ['#topbar', '#playersCol', '#centerCol', '#invPanel', '#logPanel'].forEach(k => scan(k + '(极端)', els[k].innerHTML));
  console.log('极端状态渲染成功');
} catch (e) {
  console.log('极端状态渲染抛错:', e.message);
  console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  process.exitCode = 1;
}

// 初始化流程（标题页）
try {
  FT.UI.init();
  console.log('init() 执行成功');
} catch (e) {
  console.log('init() 抛错:', e.message);
  console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  process.exitCode = 1;
}

// 存档往返
try {
  FT.UI.save();
  const raw = localStorage.getItem(FT.CONFIG.SAVE_KEY);
  const o = JSON.parse(raw);
  console.log('存档往返成功，大小', (raw.length / 1024).toFixed(1), 'KB，玩家', o.state.players.length);
} catch (e) {
  console.log('存档失败:', e.message);
  process.exitCode = 1;
}

// 卡牌数据完整性
const ids = new Set();
let dup = 0;
FT.CARDS.forEach(c => { if (ids.has(c.id)) dup++; ids.add(c.id); });
const missEnemy = FT.CARDS.filter(c => c.type === 'encounter' && !FT.ENEMIES[c.enemy]).map(c => c.id);
const missScene = FT.CARDS.filter(c => c.scene && !FT.SCENES[c.scene]).map(c => c.id);
const dayN = FT.CARDS.filter(c => c.deck === 'day').length;
const nightN = FT.CARDS.filter(c => c.deck === 'night').length;
console.log(`卡牌 ${FT.CARDS.length} 张（昼 ${dayN} / 夜 ${nightN}）· 重复 ID ${dup} · 缺敌人 ${missEnemy.length} · 缺场景 ${missScene.length}`);

// 配方引用的物品是否存在
const badItems = [];
FT.RECIPES.forEach(r => {
  if (!FT.ITEMS[r.out] && r.out !== 'fire') badItems.push(r.id + '→' + r.out);
  Object.keys(r.req).forEach(k => { if (!FT.ITEMS[k]) badItems.push(r.id + ' req ' + k); });
});
FT.CARDS.forEach(c => {
  const fx = [c.fx, c.ok, c.bad, ...(c.choices || []).map(x => x.fx)].filter(Boolean);
  fx.forEach(f => {
    if (f.give && !FT.ITEMS[f.give.id]) badItems.push(c.id + ' give ' + f.give.id);
    if (f.take && !FT.ITEMS[f.take.id]) badItems.push(c.id + ' take ' + f.take.id);
  });
});
Object.values(FT.SCENES).forEach(s => s.gather.forEach(([id]) => { if (!FT.ITEMS[id]) badItems.push('gather ' + id); }));
console.log('数据引用错误:', badItems.length ? badItems.join(', ') : '无 ✅');

if (bad.length) {
  console.log('\n模板脏数据:');
  [...new Set(bad)].forEach(b => console.log('  ' + b));
  process.exitCode = 1;
} else {
  console.log('模板输出干净 ✅');
}
