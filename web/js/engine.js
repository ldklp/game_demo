/* =====================================================================
 * ForestTable · 引擎层 v1.1
 * ---------------------------------------------------------------------
 * 单人模式：一名玩家操控一个角色，不再有轮流投票。
 * 流程全部走 FT.UI.stage() 返回的"舞台面板"，不再弹窗——
 * 每个回合在页面中央按时间顺序追加段落，玩家只在决策点点击。
 *
 * 面板接口（由 ui.js 实现）：
 *   const P = FT.UI.stage();
 *   P.head(左, 右)              顶栏
 *   P.section(标签, html)        追加一段
 *   P.append(html)              追加裸内容
 *   P.ask(options, prompt) → Promise   底部渲染按钮并等待点击
 *   P.dice({...}) → Promise    内联骰子，自动滚动后返回结果
 *   P.next(label) → Promise    底部"下一步"
 *   P.foodDivide(ctx) → Promise
 * ===================================================================== */
(function () {
  const C = FT.CONFIG;
  const ITEMS = FT.ITEMS;

  let st = null;
  let rngState = 0;
  let busy = false;
  let finished = false;

  /* ---------- 随机 ---------- */
  function rnd() {
    rngState |= 0;
    rngState = (rngState + 0x6D2B79F5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
  function roll(n) { return ri(1, n); }
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function weighted(table) {
    const total = table.reduce((s, x) => s + x[1], 0);
    let r = rnd() * total;
    for (const [k, w] of table) { if ((r -= w) <= 0) return k; }
    return table[0][0];
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- 状态访问 ---------- */
  const alive = () => st.players.filter(p => !p.dead);
  const isNight = () => st.turn > C.DAY_TURNS;
  const scene = () => FT.SCENES[st.scene];
  const hasItem = id => st.inv.some(i => i.id === id && i.qty > 0);
  const hasLight = () => st.fire > 0 || hasItem('torch');
  const isSolo = () => st.players.length === 1;
  function log(text, kind) {
    st.log.push({ t: `D${st.day}·T${st.turn}`, text, kind: kind || 'info' });
    if (st.log.length > C.MAX_LOG) st.log.shift();
  }
  const statName = s => ({ hp: '健康', stamina: '体力', sanity: '精神' })[s] || s;

  /* ---------- 背包 ---------- */
  function slots() {
    let s = C.BASE_SLOTS;
    st.players.forEach(p => {
      const c = FT.CHARS.find(x => x.id === p.charId);
      if (c) s += c.slotBonus || 0;
    });
    return s;
  }
  const slotUsed = () => st.inv.length;
  function addItem(id, qty, expire) {
    if (!qty || !ITEMS[id]) return;
    if (ITEMS[id].food) {
      const ex = st.inv.find(i => i.id === id && i.expire === expire);
      if (ex) ex.qty += qty; else st.inv.push({ id, qty, expire });
    } else {
      const ex = st.inv.find(i => i.id === id);
      if (ex) ex.qty += qty; else st.inv.push({ id, qty });
    }
  }
  function removeItem(id, qty) {
    let need = qty;
    for (const it of st.inv) {
      if (it.id !== id) continue;
      const take = Math.min(it.qty, need);
      it.qty -= take; need -= take;
      if (!need) break;
    }
    st.inv = st.inv.filter(i => i.qty > 0);
    return need === 0;
  }
  const countItem = id => st.inv.filter(i => i.id === id).reduce((s, i) => s + i.qty, 0);

  /* ---------- 修正 ---------- */
  function checkMod(p, stat) {
    if (!p) return 0;
    let m = clamp(Math.floor((p[stat] - 50) / 10), -3, 5);
    if (isNight() && !hasLight()) m -= 2;
    m += scene().checkMod;
    if (hasItem('odd_stone')) m += 1;
    if (p.charId === 'apostle' && p.sanity <= 25) m += 2;
    if (p.status.includes('poisoned')) m -= 1;
    if (p.status.includes('madness')) m -= 1;
    return m;
  }
  const bestPlayer = stat => alive().slice().sort((a, b) => b[stat] - a[stat])[0] || null;

  /* ---------- 伤害 / 治疗 / 状态 ---------- */
  function damage(p, n) {
    if (!p || p.dead || n <= 0) return;
    if (isSolo()) n = Math.max(1, Math.round(n * C.SOLO_DAMAGE_MULT));
    p.hp = clamp(p.hp - n, 0, p.maxHp);
    if (p.hp <= 0 && !p.status.includes('dying')) {
      p.status.push('dying');
      p.dyingTurns = 3;
      log(`${p.name} 倒下了，进入濒死状态。`, 'bad');
    }
  }
  function heal(p, n) {
    if (!p || p.dead) return;
    if (p.status.includes('hungry')) n = Math.ceil(n / 2);
    p.hp = clamp(p.hp + n, 0, p.maxHp);
    if (p.hp > 0) {
      p.status = p.status.filter(s => s !== 'dying');
      p.dyingTurns = 0;
    }
  }
  function addStatus(p, s) {
    if (!s || !p || p.dead) return;
    if (s === 'hunger') s = 'hungry';
    if (s === 'madness') {
      if (p.status.includes('madness')) return;
      p.symptom = pick(FT.SYMPTOMS).id;
    }
    if (!p.status.includes(s)) p.status.push(s);
  }
  function applyStats(p, obj) {
    if (!obj || !p || p.dead) return;
    if (obj.hp) obj.hp > 0 ? heal(p, obj.hp) : damage(p, -obj.hp);
    if (obj.stamina) p.stamina = clamp(p.stamina + obj.stamina, 0, p.maxStamina);
    if (obj.sanity) p.sanity = clamp(p.sanity + obj.sanity, 0, p.maxSanity);
  }
  function applyFx(fx, roller) {
    if (!fx) return;
    if (fx.team) alive().forEach(p => applyStats(p, fx.team));
    if (fx.self && roller) applyStats(roller, fx.self);
    if (fx.self2 && roller) applyStats(roller, fx.self2);
    if (fx.give) addItem(fx.give.id, fx.give.qty, ITEMS[fx.give.id] && ITEMS[fx.give.id].food ? ITEMS[fx.give.id].expire : undefined);
    if (fx.take) removeItem(fx.take.id, fx.take.qty);
    if (fx.status && roller) addStatus(roller, fx.status);
    if (fx.status === 'madness' && !roller) alive().forEach(p => addStatus(p, 'madness'));
    if (fx.progress) st.progress = Math.max(0, st.progress + fx.progress);
    if (fx.extra && fx.extra.skipAction) st.skipAction = true;
    checkDeaths();
  }
  function checkDeaths() {
    st.players.forEach(p => {
      if (p.dead) return;
      if (p.sanity <= 0) {
        p.dead = true; p.sanity = 0;
        log(`${p.name} 在自己看不见的地方结束了。精神归零。`, 'bad');
        st.stats.deaths++;
      }
    });
    if (alive().length === 0 && !st.over) { st.over = true; st.victory = false; }
  }

  /* ---------- 抽牌 ---------- */
  function drawCard() {
    const deck = isNight() ? 'night' : 'day';
    let pool = FT.CARDS.filter(c => c.deck === deck && (!c.scene || c.scene === st.scene) && !st.used.includes(c.id));
    if (!pool.length) {
      st.used = st.used.filter(id => {
        const c = FT.CARDS.find(x => x.id === id);
        return c && c.scene && c.scene === st.scene;
      });
      pool = FT.CARDS.filter(c => c.deck === deck && (!c.scene || c.scene === st.scene) && !st.used.includes(c.id));
    }
    if (!pool.length) { pool = FT.CARDS.filter(c => c.deck === deck); st.used = []; }
    const c = pick(pool);
    st.used.push(c.id);
    return c;
  }

  /* ---------- 初始化 ---------- */
  function newGame(roster, seed) {
    rngState = seed || (Date.now() & 0x7fffffff);
    finished = false;
    st = {
      day: 1, turn: 1, phase: 0, scene: 'bright_forest',
      progress: 0, goal: C.PROGRESS_GOALS[0],
      fire: 0, inv: [], used: [], log: [],
      preview: null, skipAction: false, over: false, victory: false,
      players: roster.map((r, i) => {
        const c = FT.CHARS.find(x => x.id === r.charId) || FT.CHARS[0];
        return {
          id: 'p' + (i + 1), name: r.name || c.name, charId: c.id,
          hp: c.hp, stamina: c.stamina, sanity: c.sanity,
          maxHp: c.hp, maxStamina: c.stamina, maxSanity: c.sanity,
          status: [], symptom: null, dyingTurns: 0, dead: false
        };
      }),
      stats: { turns: 0, events: 0, deaths: 0, foods: 0 }
    };
    st.players.forEach(p => {
      const c = FT.CHARS.find(x => x.id === p.charId);
      (c.start || []).forEach(([id, qty]) => {
        const d = ITEMS[id];
        addItem(id, qty, d && d.food ? d.expire : undefined);
      });
    });
    st.preview = drawCard();
    log('你走进了森林。没有人记得来路，因为只有你一个人。', 'tip');
    return st;
  }

  /* ---------- 阶段 ---------- */
  const PHASE_SCENES = [
    ['bright_forest', 'dark_forest'],
    ['riverside', 'swamp', 'dark_forest'],
    ['cliff', 'waterfall', 'swamp'],
    ['lakeshore']
  ];
  function enterPhase(idx) {
    st.phase = idx;
    st.goal = C.PROGRESS_GOALS[idx] || C.PROGRESS_GOALS[C.PROGRESS_GOALS.length - 1];
    st.progress = 0;
    st.scene = pick(PHASE_SCENES[idx] || PHASE_SCENES[PHASE_SCENES.length - 1]);
    st.used = [];
  }

  /* =====================================================================
   * 事件
   * ===================================================================== */
  const TYPE_NAME = { encounter: '遭遇敌人', mystery: '神秘事件', hazard: '意外', skip: '强制' };

  async function resolveCard(card, P) {
    st.stats.events++;
    log(`【${card.title}】`, 'event');
    P.section(`事件 · ${TYPE_NAME[card.type] || '事件'}`, cardHtml(card));

    if (card.type === 'encounter') { await combat(card.enemy, card.ambush, P); return; }

    if (card.type === 'skip') {
      applyFx(card.fx);
      if (st.over) return;
      P.append(`<div class="eresult no">${esc(card.result || card.text)}</div><div class="mono">本回合行动阶段被跳过。</div>`);
      return;
    }
    if (card.type === 'hazard' && card.check) {
      const who = bestPlayer(card.check.stat) || st.players[0];
      const mod = checkMod(who, card.check.stat);
      const r = await P.dice({ label: `${statName(card.check.stat)}判定`, mod, dc: card.check.dc, who: who.name });
      const out = r.ok ? card.ok : card.bad;
      applyFx(out, who);
      if (st.over) return;
      P.append(`<div class="eresult ${r.ok ? 'ok' : 'no'}">${esc(out.result || (r.ok ? '你挺过去了。' : '事情变糟了。'))}</div>`);
      return;
    }
    if (card.type === 'mystery' && card.choices) {
      const v = await P.ask(card.choices.map((c, i) => ({ label: c.label, desc: c.desc, value: i })), '你怎么做？');
      const c = card.choices[v];
      applyFx(c.fx, st.players[0]);
      if (st.over) return;
      P.append(`<div class="eresult ok">${esc(c.result || '')}</div>`);
    }
  }

  function cardHtml(card) {
    const deckName = card.deck === 'night' ? '夜晚' : '白天';
    return `<div class="ecard">
      <div class="etitle">${esc(card.title)}</div>
      <div class="etype">${deckName} · ${TYPE_NAME[card.type] || ''}${card.ambush ? ' · 突袭' : ''}</div>
      <div class="etext">${esc(card.text)}</div>
    </div>`;
  }

  /* =====================================================================
   * 战斗
   * ===================================================================== */
  async function combat(enemyId, ambush, P) {
    const base = FT.ENEMIES[enemyId];
    if (!base) return;
    const groupN = base.group ? ri(base.group[0], base.group[1]) : 1;
    const e = {
      name: base.name + (groupN > 1 ? ` ×${groupN}` : ''),
      hp: base.hp * groupN, maxHp: base.hp * groupN, def: base.def,
      atk: base.atk, sanityDrain: base.sanityDrain || 0, needsLight: !!base.needsLight
    };
    log(`${e.name} 出现。`, 'bad');
    P.append(`<div class="eflavor">${esc(base.flavor || base.desc)}</div>
      <div class="mono">健康 ${e.hp} · 攻击 ${e.atk[0]}d${e.atk[1]} · 防御 ${e.def}${e.needsLight ? ' · 需要强光' : ''}</div>`);

    const choice = await P.ask([
      { label: '战斗', desc: '最多三轮，打不赢就得脱离', value: 'fight' },
      { label: '逃跑', desc: '判定失败会被追上，受到伤害', value: 'flee' }
    ], '怎么办？');

    if (choice === 'flee') {
      const who = bestPlayer('stamina') || st.players[0];
      const r = await P.dice({ label: '脱离判定', mod: checkMod(who, 'stamina'), dc: 11 });
      if (r.ok) {
        alive().forEach(p => p.stamina = clamp(p.stamina - 4, 0, p.maxStamina));
        log('成功脱离，体力 -4。', 'good');
        P.append(`<div class="eresult ok">你跑掉了。代价是一截体力，和一点尊严。</div>`);
      } else {
        alive().forEach(p => { damage(p, 6); p.sanity = clamp(p.sanity - 3, 0, p.maxSanity); });
        log('脱离失败，健康 -6、精神 -3。', 'bad');
        P.append(`<div class="eresult no">它比你快。你带着伤逃了出来。</div>`);
      }
      checkDeaths();
      return;
    }

    const weaponOf = p => {
      const w = st.inv.map(i => ITEMS[i.id]).filter(i => i && i.cat === 'weapon');
      if (p.charId === 'hunter') {
        const rifle = w.find(x => x.name === '猎枪');
        if (rifle) return rifle;
      }
      return w[0] || { dice: 4, hit: 0, name: '拳头' };
    };

    let roundsHtml = '';
    for (let round = 1; round <= 3 && e.hp > 0; round++) {
      roundsHtml += `<div class="mono" style="margin-top:8px;color:#7f8d80">— 第 ${round} 轮 —</div>`;
      for (const p of alive()) {
        const w = weaponOf(p);
        const m = checkMod(p, 'hp') + (w.hit || 0) + (p.charId === 'hunter' && round === 1 ? 2 : 0);
        const r = roll(20) + m;
        if (r >= e.def) {
          let dmg = roll(w.dice || 4) + 2;
          if (e.needsLight && !hasLight()) dmg = Math.max(1, Math.floor(dmg / 2));
          e.hp -= dmg;
          roundsHtml += `<div class="mono">${esc(p.name)} 用${w.name}命中（${r}），造成 ${dmg} 伤害。</div>`;
          log(`${p.name} 命中，${dmg} 伤害。`, 'good');
        } else {
          roundsHtml += `<div class="mono" style="opacity:.55">${esc(p.name)} 落空（${r}）。</div>`;
        }
        if (e.hp <= 0) break;
      }
      if (e.hp <= 0) break;
      const target = pick(alive());
      if (target) {
        const a = roll(e.atk[1]) + e.atk[0] - 1;
        damage(target, a);
        roundsHtml += `<div class="mono" style="color:#d5745c">${esc(e.name)} 扑向 ${esc(target.name)}，${a} 伤害。</div>`;
      }
      if (e.sanityDrain) {
        alive().forEach(p => p.sanity = clamp(p.sanity - e.sanityDrain, 0, p.maxSanity));
        roundsHtml += `<div class="mono" style="color:#8f7fb8">低语侵蚀：精神 -${e.sanityDrain}。</div>`;
      }
      checkDeaths();
      if (alive().length === 0) { st.over = true; st.victory = false; break; }
    }
    if (st.over) { P.append(`<div class="eresult no">你倒在了这里。</div>`); return; }
    P.append(`<div class="eresult ${e.hp <= 0 ? 'ok' : 'no'}">${roundsHtml}</div>`);

    if (e.hp <= 0) {
      log(`${e.name} 倒下了。`, 'good');
      const loot = enemyId === 'beast' ? ['raw_meat', 'bone'] : enemyId === 'unknown' ? ['bone', 'odd_stone'] : ['bone', 'cloth'];
      addItem(loot[0], 1, ITEMS[loot[0]].food ? ITEMS[loot[0]].expire : undefined);
      if (rnd() < 0.6) addItem(loot[1], 1, ITEMS[loot[1]].food ? ITEMS[loot[1]].expire : undefined);
      P.append(`<div class="mono">它倒下的姿势，和人很像。你从它身上拿走了一些材料。</div>`);
    } else {
      const who = bestPlayer('stamina') || st.players[0];
      const r = await P.dice({ label: '强制脱离', mod: checkMod(who, 'stamina'), dc: 12 });
      if (r.ok) P.append(`<div class="eresult ok">你脱离了战斗。</div>`);
      else {
        alive().forEach(p => damage(p, 5));
        P.append(`<div class="eresult no">脱离失败，健康 -5。你冲了出来，身上少了一块。</div>`);
      }
      checkDeaths();
    }
  }

  /* =====================================================================
   * 行动
   * ===================================================================== */
  async function actionPhase(P) {
    const dying = alive().some(p => p.status.includes('dying'));
    let opts = [
      { label: '前进', desc: `进度 +${C.ADVANCE_PROGRESS} · 体力 -${C.ADVANCE_COST}`, value: 'advance' },
      { label: '收集', desc: `按地形找资源 · 体力 -${C.GATHER_COST}`, value: 'gather' },
      { label: '合成', desc: '制作物品或烹饪（需材料／篝火）', value: 'craft' },
      { label: '休整', desc: `体力 +${C.REST_STAMINA} · 精神 +${C.REST_SANITY} · 健康 +${C.REST_HP}`, value: 'rest' }
    ];
    if (dying) opts = [{ label: '包扎伤口', desc: '你倒下了，只能用最后的力气给自己处理伤口', value: 'rest' }];

    P.section('本回合的行动', `<div class="eflavor" style="color:#8d998c;font-size:12.5px">${esc(scene().tagline)}</div>`);
    const act = await P.ask(opts, dying ? '濒死：只能自救' : '你决定做什么？');

    if (act === 'advance') await doAdvance(P);
    else if (act === 'gather') await doGather(P);
    else if (act === 'craft') await doCraft(P);
    else if (act === 'rest') await doRest(P);
  }

  async function doAdvance(P) {
    const p0 = alive()[0];
    const cost = p0 && p0.status.includes('hungry') ? Math.round(C.ADVANCE_COST * 1.5) : C.ADVANCE_COST;
    let gain = C.ADVANCE_PROGRESS;
    if (alive().some(p => p.charId === 'hunter')) gain += 1;
    alive().forEach(p => p.stamina = clamp(p.stamina - cost, 0, p.maxStamina));
    st.progress += gain;
    log(`前进：进度 +${gain}（${st.progress}/${st.goal}），体力 -${cost}。`, 'good');
    P.section('前进', `<div class="eflavor">你往认定的方向走了一段。树往后退了一些，但看起来只是换了一批。</div>
      <div class="mono">进度 ${st.progress}/${st.goal} · 体力 -${cost}</div>`);
    if (rnd() < 0.2) {
      log('前进途中触发了额外事件。', 'warn');
      await resolveCard(drawCard(), P);
    }
  }

  async function doGather(P) {
    alive().forEach(p => p.stamina = clamp(p.stamina - C.GATHER_COST, 0, p.maxStamina));
    const n = ri(1, 3);
    const got = [];
    for (let i = 0; i < n; i++) {
      const id = weighted(scene().gather);
      const d = ITEMS[id];
      addItem(id, 1, d.food ? d.expire : undefined);
      got.push(d.name);
    }
    log(`收集：获得 ${got.join('、')}。`, 'good');
    P.section('收集', `<div class="eflavor">你在附近翻找了一会儿。这片林子愿意给你的，就这些。</div>
      <div class="mono">获得：${esc(got.join('、'))} · 体力 -${C.GATHER_COST}</div>`);
    if (rnd() < 0.15) {
      log('收集时惊动了什么。', 'warn');
      await resolveCard(drawCard(), P);
    }
  }

  async function doCraft(P) {
    const canMake = FT.RECIPES.filter(r => {
      if (r.needFire && st.fire <= 0) return false;
      return Object.entries(r.req).every(([id, q]) => countItem(id) >= q);
    });
    const opts = FT.RECIPES.map(r => {
      const ok = canMake.includes(r);
      const req = Object.entries(r.req).map(([id, q]) => `${ITEMS[id].name} ${countItem(id)}/${q}`).join(' · ');
      let why = '';
      if (!ok) why = (r.needFire && st.fire <= 0) ? '需要篝火' : '材料不足';
      return {
        label: r.name + (r.cook ? '（烹饪）' : ''),
        desc: req + (why ? ' —— ' + why : '') + ' · ' + r.desc,
        value: r.id, disabled: !ok
      };
    });
    opts.push({ label: '算了', desc: '本回合什么都不做', value: null, light: true });

    const id = await P.ask(opts, st.fire > 0 ? `篝火还剩 ${st.fire} 回合` : '没有篝火，只能做不用火的东西');
    if (!id) {
      log('放弃合成，本回合空过。', 'warn');
      P.section('合成', `<div class="eflavor">你翻了翻背包，又放下了。</div>`);
      return;
    }
    const r = FT.RECIPES.find(x => x.id === id);
    Object.entries(r.req).forEach(([iid, q]) => { if (iid !== r.keepTool) removeItem(iid, q); });
    if (r.fire) {
      st.fire = C.FIRE_TURNS;
      log(`搭起了篝火（${C.FIRE_TURNS} 回合）。`, 'good');
      P.section('合成 · 篝火', `<div class="eflavor">火起来了。橘色的光把周围的树往外推了几米。</div><div class="mono">篝火持续 ${C.FIRE_TURNS} 回合</div>`);
    } else {
      const d = ITEMS[r.out];
      let qty = 1;
      if (d && d.food && d.portions) qty = d.portions;
      addItem(r.out, qty, d && d.food ? d.expire : undefined);
      log(`合成了 ${d.name}${qty > 1 ? ' ×' + qty : ''}。`, 'good');
      P.section(`合成 · ${d.name}`, `<div class="eflavor">${esc(r.desc)}</div><div class="mono">获得 ${d.name}${qty > 1 ? ' ×' + qty : ''}</div>`);
    }
  }

  async function doRest(P) {
    alive().forEach(p => {
      p.stamina = clamp(p.stamina + C.REST_STAMINA, 0, p.maxStamina);
      p.sanity = clamp(p.sanity + C.REST_SANITY, 0, p.maxSanity);
      heal(p, C.REST_HP);
    });
    log(`休整：体力 +${C.REST_STAMINA}、精神 +${C.REST_SANITY}、健康 +${C.REST_HP}。`, 'good');
    P.section('休整', `<div class="eflavor">你靠在树干上，把呼吸放慢。这段安静很短，但够用。</div>
      <div class="mono">体力 +${C.REST_STAMINA} · 精神 +${C.REST_SANITY} · 健康 +${C.REST_HP}</div>`);

    const act = await P.ask([
      { label: '吃点东西', desc: '从背包里选一样食物', value: 'eat' },
      { label: '使用物品', desc: '绷带、药——给自己处理伤口', value: 'use' },
      { label: '就这样', desc: '什么都不额外做', value: 'none', light: true }
    ], '还要做点什么吗？');
    if (act === 'eat') await eatFlow(P);
    else if (act === 'use') await useItemFlow(P);
  }

  async function eatFlow(P) {
    const foods = st.inv.filter(i => ITEMS[i.id] && ITEMS[i.id].food);
    if (!foods.length) {
      P.append(`<div class="eresult no">背包里能吃的都吃完了。</div>`);
      return;
    }
    const opts = foods.map((f, i) => ({
      label: `${ITEMS[f.id].name}（${f.qty}）`,
      desc: `体力 +${ITEMS[f.id].stamina}${ITEMS[f.id].help ? ' · 精神 +' + ITEMS[f.id].help : ''}${f.expire !== undefined ? ' · 保质 ' + f.expire : ''}${ITEMS[f.id].portions ? ' · 可分食' : ''}`,
      value: i
    }));
    opts.push({ label: '不吃了', desc: '', value: -1, light: true });
    const idx = await P.ask(opts, '吃什么？');
    if (idx < 0) return;

    const f = foods[idx];
    const def = ITEMS[f.id];
    st.stats.foods++;

    if (def.portions && f.qty > 1) {
      const alloc = await P.foodDivide({
        name: def.name, icon: def.icon, portions: f.qty,
        staminaEach: def.stamina, sanityEach: def.help || 0,
        players: alive().map(p => ({ id: p.id, name: p.name }))
      });
      let total = 0;
      Object.entries(alloc).forEach(([pid, n]) => {
        const p = st.players.find(x => x.id === pid);
        if (!p || !n) return;
        total += n;
        p.stamina = clamp(p.stamina + Math.round(def.stamina * n / def.portions), 0, p.maxStamina);
        if (def.help) p.sanity = clamp(p.sanity + Math.ceil(def.help * n / def.portions), 0, p.maxSanity);
      });
      f.qty -= total;
      if (f.qty <= 0) st.inv = st.inv.filter(x => x !== f);
      log(`吃了 ${def.name} ${total} 份。`, 'good');
    } else {
      const n = Math.min(f.qty, alive().length);
      f.qty -= n;
      alive().slice().sort((a, b) => a.stamina - b.stamina).slice(0, n).forEach(p => {
        p.stamina = clamp(p.stamina + def.stamina, 0, p.maxStamina);
        if (def.help) p.sanity = clamp(p.sanity + def.help, 0, p.maxSanity);
        if (def.poison && rnd() < def.poison) {
          addStatus(p, 'poisoned');
          P.append(`<div class="eresult no">${esc(def.name)}不对劲。你开始反胃。</div>`);
          log(`${p.name} 吃坏了肚子。`, 'bad');
        }
      });
      if (f.qty <= 0) st.inv = st.inv.filter(x => x !== f);
      P.append(`<div class="eresult ok">吃了 ${esc(def.name)}。体力 +${def.stamina}${def.help ? '，精神 +' + def.help : ''}</div>`);
      log(`吃了 ${def.name}。`, 'good');
    }
    checkDeaths();
  }

  async function useItemFlow(P) {
    const usable = st.inv.filter(i => ITEMS[i.id] && ITEMS[i.id].use);
    if (!usable.length) {
      P.append(`<div class="eresult no">没有可用的物品。绷带和药都用完了。</div>`);
      return;
    }
    const opts = usable.map((u, i) => ({ label: `${ITEMS[u.id].name}（${u.qty}）`, desc: ITEMS[u.id].desc, value: i }));
    opts.push({ label: '不用了', desc: '', value: -1, light: true });
    const idx = await P.ask(opts, '用哪个？');
    if (idx < 0) return;

    const u = usable[idx];
    const p = alive()[0];
    const use = ITEMS[u.id].use;
    heal(p, use.hp || 0);
    if (use.cure) p.status = p.status.filter(s => s !== use.cure);
    if (p.charId === 'medic') heal(p, 3);
    removeItem(u.id, 1);
    P.append(`<div class="eresult ok">用了 ${esc(ITEMS[u.id].name)}。健康 +${use.hp || 0}${use.cure ? '，解除' + use.cure : ''}</div>`);
    log(`${p.name} 使用了 ${ITEMS[u.id].name}。`, 'good');
  }

  /* =====================================================================
   * 回合
   * ===================================================================== */
  async function runTurn() {
    if (busy) return;
    busy = true;
    try {
      st.stats.turns++;
      const P = FT.UI.stage();
      P.head(
        `<span class="turnno">第 ${st.day} 天 · 第 ${st.turn} 回合</span>`,
        `<span>${isNight() ? '夜晚' : '白天'} · 进度 ${st.progress}/${st.goal}</span>`
      );
      FT.UI.render();

      /* 1. 结算预告 */
      if (st.preview) {
        const card = st.preview;
        st.preview = null;
        await resolveCard(card, P);
        FT.UI.render();
        if (st.over) { finish(); return; }
      }

      /* 2. 行动 */
      if (st.skipAction) {
        st.skipAction = false;
        log('本回合行动阶段被跳过。', 'warn');
        P.section('行动被跳过', `<div class="eflavor">你没能做成任何事。这一天被什么东西吃掉了。</div>`);
      } else {
        await actionPhase(P);
        FT.UI.render();
        if (st.over) { finish(); return; }
      }

      /* 3. 回合结算 */
      const before = alive().map(p => ({ id: p.id, hp: p.hp, stamina: p.stamina, sanity: p.sanity }));
      await endOfTurn();
      let rows = '';
      alive().forEach(p => {
        const b = before.find(x => x.id === p.id);
        if (!b) return;
        const d = (k, v) => {
          const diff = Math.round(v - b[k]);
          if (!diff) return `<span class="sv">${Math.round(v)}</span>`;
          return `<span class="delta ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '+' : ''}${diff}</span>`;
        };
        rows += `<div class="sumrow"><span class="sn">${esc(p.name)}</span>
          <span>${d('hp', p.hp)}</span><span>${d('stamina', p.stamina)}</span><span>${d('sanity', p.sanity)}</span></div>`;
      });
      P.section('回合结算', `<div class="sumgrid">${rows}</div>
        <div class="mono" style="margin-top:6px">自然消耗已结算 · 食物保质期 -1${st.fire > 0 ? ' · 篝火剩 ' + st.fire : ''}</div>`);

      if (st.over) { finish(); return; }

      /* 4. 阶段检查 */
      if (st.progress >= st.goal) {
        const next = st.phase + 1;
        if (next >= C.PROGRESS_GOALS.length) { st.over = true; st.victory = true; finish(); return; }
        enterPhase(next);
        alive().forEach(p => p.sanity = clamp(p.sanity + 6, 0, p.maxSanity));
        log(`进入新场景：${scene().name}，精神 +6。`, 'event');
        P.section(`第 ${st.phase + 1} 阶段 · ${scene().name}`,
          `<div class="eflavor">${esc(scene().tagline)}</div>
           <div class="mono">新的进度目标 ${st.goal} · 全队精神 +6</div>`);
        FT.UI.render();
      }

      /* 5. 切到下一回合，抽属于下一回合的预告 */
      st.turn++;
      if (st.turn > C.TURNS_PER_DAY) { st.turn = 1; st.day++; }
      st.preview = drawCard();
      FT.UI.render();

      await P.next(st.preview ? `下一步 → ${st.preview.title}` : '下一步');
      FT.UI.save();
      FT.UI.render();
    } finally {
      busy = false;
    }
  }

  async function endOfTurn() {
    alive().forEach(p => {
      p.stamina = clamp(p.stamina - C.TURN_STAMINA_COST, 0, p.maxStamina);

      let sc = isNight() ? C.NIGHT_SANITY_COST : C.DAY_SANITY_COST;
      if (st.fire > 0 && isNight()) sc = 1;
      sc -= scene().sanityMod;
      p.sanity = clamp(p.sanity - Math.max(0, sc), 0, p.maxSanity);

      if (p.stamina <= p.maxStamina * 0.25) {
        if (!p.status.includes('hungry')) { addStatus(p, 'hungry'); log(`${p.name} 饿得发抖。`, 'warn'); }
        damage(p, isNight() ? 2 : 1);
      } else {
        p.status = p.status.filter(s => s !== 'hungry');
      }
      if (p.status.includes('bleeding')) damage(p, 3);
      if (p.status.includes('poisoned')) {
        damage(p, 2);
        if (rnd() < 0.28) { p.status = p.status.filter(x => x !== 'poisoned'); log(`${p.name} 的毒性退了。`, 'good'); }
      }
      if (p.charId === 'apostle' && p.sanity >= 90) p.sanity = clamp(p.sanity - 3, 0, p.maxSanity);
      if (p.sanity <= p.maxSanity * 0.25 && !p.status.includes('madness')) {
        addStatus(p, 'madness');
        const sym = FT.SYMPTOMS.find(s => s.id === p.symptom);
        log(`${p.name} 出现心理疾病：${sym ? sym.name : '未知'}。`, 'bad');
      }
      if (p.status.includes('dying')) {
        p.dyingTurns--;
        if (p.dyingTurns <= 0) {
          p.dead = true; st.stats.deaths++;
          log(`${p.name} 没有撑过去。`, 'bad');
        }
      }
    });

    st.inv.forEach(it => {
      const d = ITEMS[it.id];
      if (!d || !d.food || it.expire === undefined) return;
      it.expire--;
      if (it.expire <= 0 && !d.spoiled) {
        it.id = 'spoiled'; it.expire = 999;
        log(`${d.name} 变质了。`, 'warn');
      }
    });
    st.inv = st.inv.filter(i => i.qty > 0);

    if (isNight() && st.fire > 0) {
      alive().forEach(p => p.sanity = clamp(p.sanity + 2, 0, p.maxSanity));
    }
    if (st.fire > 0) {
      st.fire--;
      if (st.fire === 0) log('篝火熄灭了。', 'warn');
    }
    checkDeaths();
    if (alive().length === 0) { st.over = true; st.victory = false; }
  }

  async function start() {
    if (!st || st.over) return;
    while (!st.over) {
      await runTurn();
      if (st.over) break;
    }
    finish();
  }

  function finish() {
    if (finished) return;
    finished = true;
    FT.UI.render();
    FT.UI.gameOver(st.victory, st);
    FT.UI.save();
  }

  /* ---------- 调试 ---------- */
  function debugJump(key) { st.scene = key; st.used = []; FT.UI.render(); FT.UI.save(); }
  function debugRefill() {
    alive().forEach(p => { p.hp = p.maxHp; p.stamina = p.maxStamina; p.sanity = p.maxSanity; });
    FT.UI.render(); FT.UI.save();
  }
  function debugMaterials() {
    ['stick', 'stone', 'vine', 'cloth', 'herb', 'moss', 'raw_meat'].forEach(id => addItem(id, 4));
    addItem('ration', 3, 70); addItem('water', 3, 20);
    FT.UI.render(); FT.UI.save();
  }
  function debugNextPhase() { st.progress = st.goal; }

  FT.Engine = {
    get state() { return st; },
    get rngState() { return rngState; },
    newGame, start, runTurn, drawCard,
    checkMod, statName, applyFx,
    addItem, removeItem, countItem, hasItem, slots, slotUsed,
    alive, isNight, scene, heal, damage,
    debugJump, debugRefill, debugMaterials, debugNextPhase,
    restore(state, rng) { st = state; rngState = rng; finished = false; },
    _internal: { roll, ri, rnd, pick }
  };
})();
