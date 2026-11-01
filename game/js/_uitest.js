/* 渲染冒烟测试：DOM 桩件跑 render()/init()/stage()，抓模板脏数据。
   node _uitest.js */
const fs = require('fs'), path = require('path');
global.window = global;
global.requestAnimationFrame = cb => setTimeout(cb, 0);

const HTML_LOG = [];
function fakeEl(tag) {
  const store = { tagName: tag || 'div', innerHTML: '', textContent: '', className: '', style: {}, disabled: false, children: [] };
  const stub = {
    addEventListener() {}, removeEventListener() {}, appendChild(c) { return c; },
    remove() {}, click() {}, closest() { return null; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return fakeEl(); }, querySelectorAll() { return []; },
    setAttribute() {}, focus() {}, disabled: false,
    get scrollHeight() { return 0; }, set scrollTop(v) {}, get scrollTop() { return 0; }
  };
  return new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (p in stub) return stub[p];
      if (p === Symbol.toPrimitive) return () => '';
      return () => fakeEl();
    },
    set(t, p, v) {
      if (p === 'innerHTML' && typeof v === 'string') HTML_LOG.push(v);
      t[p] = v; return true;
    }
  });
}
const els = {};
global.document = {
  createElement: t => fakeEl(t),
  querySelector(sel) { els[sel] = els[sel] || fakeEl(); return els[sel]; },
  querySelectorAll() { return []; },
  addEventListener() {},
  body: fakeEl()
};
global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
global.location = { reload() {} };
global.Blob = function () {};

function load(f) { new Function('window', fs.readFileSync(path.join(__dirname, f), 'utf8'))(global); }
load('data.js'); load('engine.js'); load('ui.js');

const bad = [];
const scanHTML = (label, h) => { ['undefined', 'NaN', '[object Object]'].forEach(t => { if (h.includes(t)) bad.push(`[${label}] 含 "${t}"`); }); };

/* 1. 普通渲染 */
const st = FT.Engine.newGame([{ name: '阿岩', charId: 'hunter' }], 42);
try { FT.UI.render(); console.log('render() 成功'); }
catch (e) { console.log('render() 抛错:', e.message, '\n', e.stack.split('\n')[1]); process.exitCode = 1; }

/* 2. 极端状态 */
st.turn = 5; st.fire = 2; st.progress = 4;
const p = st.players[0];
p.stamina = 10; p.status.push('hungry');
p.hp = 0; p.status.push('dying'); p.dyingTurns = 2;
p.sanity = 12; p.status.push('madness'); p.symptom = 'paranoia';
['stick','stone','torch','meat_soup','raw_meat','ration','odd_stone'].forEach(id => {
  const d = FT.ITEMS[id];
  FT.Engine.addItem(id, d.food ? 3 : 1, d.food ? d.expire : undefined);
});
try { FT.UI.render(); console.log('极端状态渲染成功'); }
catch (e) { console.log('极端渲染抛错:', e.message, '\n', e.stack.split('\n')[1]); process.exitCode = 1; }

/* 3. stage 面板 */
try {
  const P = FT.UI.stage();
  P.head('<span>x</span>', '<span>y</span>');
  P.section('事件 · 意外', '<div class="ecard"><div class="etitle">t</div><div class="etext">e</div></div>');
  P.append('<div class="eresult ok">ok</div>');
  console.log('stage() 成功');
} catch (e) { console.log('stage() 抛错:', e.message, '\n', e.stack.split('\n')[1]); process.exitCode = 1; }

/* 4. init */
try { FT.UI.init(); console.log('init() 成功'); }
catch (e) { console.log('init() 抛错:', e.message, '\n', e.stack.split('\n')[1]); process.exitCode = 1; }

/* 5. 存档 */
try {
  FT.UI.save();
  const raw = localStorage.getItem(FT.CONFIG.SAVE_KEY);
  JSON.parse(raw);
  console.log('存档往返成功', (raw.length / 1024).toFixed(1) + 'KB');
} catch (e) { console.log('存档失败:', e.message); process.exitCode = 1; }

/* 6. 数据完整性 */
const ids = new Set(); let dup = 0;
FT.CARDS.forEach(c => { if (ids.has(c.id)) dup++; ids.add(c.id); });
const missEnemy = FT.CARDS.filter(c => c.type === 'encounter' && !FT.ENEMIES[c.enemy]).map(c => c.id);
const missScene = FT.CARDS.filter(c => c.scene && !FT.SCENES[c.scene]).map(c => c.id);
const badItems = [];
FT.RECIPES.forEach(r => {
  if (!FT.ITEMS[r.out] && r.out !== 'fire') badItems.push(r.id + '→' + r.out);
  Object.keys(r.req).forEach(k => { if (!FT.ITEMS[k]) badItems.push(r.id + ' req ' + k); });
});
FT.CARDS.forEach(c => {
  [c.fx, c.ok, c.bad, ...(c.choices || []).map(x => x.fx)].filter(Boolean).forEach(f => {
    if (f.give && !FT.ITEMS[f.give.id]) badItems.push(c.id + ' give ' + f.give.id);
    if (f.take && !FT.ITEMS[f.take.id]) badItems.push(c.id + ' take ' + f.take.id);
  });
});
Object.values(FT.SCENES).forEach(s => s.gather.forEach(([id]) => { if (!FT.ITEMS[id]) badItems.push('gather ' + id); }));
console.log(`卡牌 ${FT.CARDS.length} 张 · 重复 ${dup} · 缺敌人 ${missEnemy.length} · 缺场景 ${missScene.length}`);
console.log('数据引用:', badItems.length ? badItems.join(', ') : '正常 ✅');

/* 7. 扫 HTML */
HTML_LOG.forEach((h, i) => scanHTML('#' + i, h));
if (bad.length) {
  console.log('\n模板脏数据:'); [...new Set(bad)].slice(0, 8).forEach(b => console.log('  ' + b));
  process.exitCode = 1;
} else {
  console.log(`模板输出干净 ✅（检查了 ${HTML_LOG.length} 段 HTML）`);
}
