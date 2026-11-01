/* =====================================================================
 * ForestTable · 引擎层
 * ---------------------------------------------------------------------
 * 纯逻辑 + 流程控制。所有界面交互都通过 FT.UI.* 的 Promise 接口，
 * 因此可以在没有 DOM 的环境里跑自动化测试（见 _selftest.js）。
 *
 * 流程：
 *   start() → 逐回合 runTurn()
 *     runTurn: 推进时间 → 结算预告事件 → (可能跳过行动) → 投票选行动
 *              → 执行 → 结算(消耗/腐败/状态/死亡) → 抽下一张预告 → 阶段检查
 * ===================================================================== */
(function () {
  const C = FT.CONFIG;
  const ITEMS = FT.ITEMS;

  let st = null;      // 游戏状态
  let rngState = 0;   // 伪随机种子状态
  let busy = false;   // 防重入

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
  function weighted(table) { // [[key, weight], ...]
    const total = table.reduce((s, x) => s + x[1], 0);
    let r = rnd() * total;
    for (const [k, w] of table) { if ((r -= w) <= 0) return k; }
    return table[0][0];
  }

  /* ---------- 小工具 ---------- */
  const alive = () => st.players.filter(p => !p.dead);
  const isNight = () => st.turn > C.DAY_TURNS;
  const scene = () => FT.SCENES[st.scene];
  function hasItem(id) {
    return st.inv.some(i => i.id === id && i.qty > 0);
  }
  function hasLight() {
    return st.fire > 0 || hasItem('torch');
  }
  function log(text, kind) {
    st.log.push({ t: `D${st.day}·T${st.turn}`, text, kind: kind || 'info' });
    if (st.log.length > C.MAX_LOG) st.log.shift();
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------- 背包 ---------- */
  function slots() {
    let s = C.BASE_SLOTS;
    alive().forEach(p => {
      const c = FT.CHARS.find(x => x.id === p.charId);
      s += c.slotBonus || 0;
    });
    return s;
  }
  function slotUsed() { return st.inv.length; }
  function addItem(id, qty, expire) {
    if (!qty) return;
    const def = ITEMS[id];
    if (!def) return;
    if (def.food) {
      const ex = st.inv.find(i => i.id === id && i.expire === expire);
      if (ex) ex.qty += qty;
      else st.inv.push({ id, qty, expire });
    } else {
      const ex = st.inv.find(i => i.id === id);
      if (ex) ex.qty += qty;
      else st.inv.push({ id, qty });
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
  function countItem(id) {
    return st.inv.filter(i => i.id === id).reduce((s, i) => s + i.qty, 0);
  }

  /* ---------- 属性修正 ---------- */
  function checkMod(p, stat) {
    const v = p[stat];
    let m = clamp(Math.floor((v - 50) / 10), -3, 5);
    if (isNight() && !hasLight()) m -= 2;
    m += scene().checkMod;
    if (hasItem('odd_stone')) m += 1;
    if (p.charId === 'apostle' && p.sanity <= 25) m += 2;
    if (p.status.includes('poisoned')) m -= 1;
    if (p.status.includes('madness')) m -= 1;
    return m;
  }
  function statName(s) { return { hp: '健康', stamina: '体力', sanity: '精神' }[s] || s; }
  function bestPlayer(stat) {
    return alive().slice().sort((a, b) => b[stat] - a[stat])[0];
  }

  /* ---------- 伤害与死亡 ---------- */
  function damage(p, n, silent) {
    if (p.dead || n <= 0) return;
    p.hp = clamp(p.hp - n, 0, p.maxHp);
    if (p.hp <= 0 && !p.status.includes('dying')) {
      p.status.push('dying');
      p.dyingTurns = 3;
      if (!silent) log(`${p.name} 倒下了，进入濒死状态。`, 'bad');
    }
  }
  function heal(p, n) {
    if (p.dead) return;
    if (p.status.includes('hungry')) n = Math.ceil(n / 2); // 饥饿：健康恢复减半
    p.hp = clamp(p.hp + n, 0, p.maxHp);
    if (p.hp > 0) {
      p.status = p.status.filter(s => s !== 'dying');
      p.dyingTurns = 0;
    }
  }
  function addStatus(p, s) {
    if (!s || p.dead) return;
    if (s === 'hunger') s = 'hungry';
    if (s === 'madness') {
      if (p.status.includes('madness')) return;
      p.symptom = pick(FT.SYMPTOMS).id;
    }
    if (!p.status.includes(s)) p.status.push(s);
  }

  /* ---------- 效果结算 ---------- */
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
    if (fx.give) addItem(fx.give.id, fx.give.qty, fx.give.id && ITEMS[fx.give.id] && ITEMS[fx.give.id].food
      ? ITEMS[fx.give.id].expire : undefined);
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
        log(`${p.name} 在自己人看不见的地方结束了。精神归零。`, 'bad');
        st.stats.deaths++;
      }
    });
    if (alive().length === 0 && !st.over) {
      st.over = true; st.victory = false;
    }
  }

  /* ---------- 抽牌 ---------- */
  function drawCard() {
    const deck = isNight() ? 'night' : 'day';
    let pool = FT.CARDS.filter(c =>
      c.deck === deck && (!c.scene || c.scene === st.scene) && !st.used.includes(c.id));
    if (!pool.length) {
      st.used = st.used.filter(id => {
        const c = FT.CARDS.find(x => x.id === id);
        return c && c.scene && c.scene === st.scene;
      });
      pool = FT.CARDS.filter(c =>
        c.deck === deck && (!c.scene || c.scene === st.scene) && !st.used.includes(c.id));
    }
    if (!pool.length) {
      pool = FT.CARDS.filter(c => c.deck === deck);
      st.used = [];
    }
    const c = pick(pool);
    st.used.push(c.id);
    return c;
  }

  /* ---------- 初始化 ---------- */
  function newGame(roster, seed) {
    rngState = seed || (Date.now() & 0x7fffffff);
    st = {
      day: 1, turn: 1, phase: 0, scene: 'bright_forest',
      progress: 0, goal: C.PROGRESS_GOALS[0],
      fire: 0, inv: [], used: [], log: [],
      preview: null, skipAction: false,
      over: false, victory: false,
      players: roster.map((r, i) => {
        const c = FT.CHARS.find(x => x.id === r.charId) || FT.CHARS[0];
        const p = {
          id: 'p' + (i + 1), name: r.name || c.name, charId: c.id,
          hp: c.hp, stamina: c.stamina, sanity: c.sanity,
          maxHp: c.hp, maxStamina: c.stamina, maxSanity: c.sanity,
          status: [], symptom: null, dyingTurns: 0, dead: false
        };
        return p;
      }),
      stats: { turns: 0, events: 0, deaths: 0, foods: 0 }
    };
    st.players.forEach((p, i) => {
      const c = FT.CHARS.find(x => x.id === p.charId);
      (c.start || []).forEach(([id, qty]) => {
        const d = ITEMS[id];
        addItem(id, qty, d && d.food ? d.expire : undefined);
      });
    });
    st.preview = drawCard();
    log('你们走进了森林。没有人记得来路。', 'tip');
    return st;
  }

  /* ---------- 场景/阶段 ---------- */
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
    const pool = PHASE_SCENES[idx] || PHASE_SCENES[PHASE_SCENES.length - 1];
    st.scene = pick(pool);
    st.used = [];
  }

  /* =====================================================================
   * 事件结算
   * ===================================================================== */
  async function resolveCard(card) {
    st.stats.events++;
    log(`【${card.title}】`, 'event');
    await FT.UI.eventModal(card);

    if (card.type === 'encounter') {
      await combat(card.enemy, card.ambush);
      return;
    }
    if (card.type === 'skip') {
      applyFx(card.fx);
      await FT.UI.say({ title: card.title, body: `<p class="flavor">${card.result || card.text}</p>`, tone: 'warn' });
      return;
    }
    if (card.type === 'hazard' && card.check) {
      const who = bestPlayer(card.check.stat);
      const mod = checkMod(who, card.check.stat);
      const r = await FT.UI.roll({
        title: card.title,
        who: who.name,
        stat: statName(card.check.stat),
        dc: card.check.dc,
        mod
      });
      if (r.ok) { applyFx(card.ok, who); await FT.UI.say({ title: '判定成功', body: `<p class="flavor">${card.ok.result || '你挺过去了。'}</p>`, tone: 'good' }); }
      else { applyFx(card.bad, who); await FT.UI.say({ title: '判定失败', body: `<p class="flavor">${card.bad.result || '事情变糟了。'}</p>`, tone: 'bad' }); }
      return;
    }
    if (card.type === 'mystery' && card.choices) {
      const v = await FT.UI.vote({
        title: card.title,
        body: `<p class="flavor">${card.text}</p>`,
        prompt: '全队投票，少数服从多数',
        options: card.choices.map((c, i) => ({ label: c.label, desc: c.desc, value: i }))
      });
      const c = card.choices[v];
      applyFx(c.fx);
      await FT.UI.say({ title: c.label, body: `<p class="flavor">${c.result || ''}</p>`, tone: 'info' });
    }
  }

  /* =====================================================================
   * 战斗
   * ===================================================================== */
  async function combat(enemyId, ambush) {
    const base = FT.ENEMIES[enemyId];
    if (!base) return;
    const groupN = base.group ? ri(base.group[0], base.group[1]) : 1;
    const e = {
      name: base.name + (groupN > 1 ? `（×${groupN}）` : ''),
      hp: base.hp * groupN, maxHp: base.hp * groupN,
      atk: base.atk, def: base.def, sanityDrain: base.sanityDrain || 0,
      needsLight: !!base.needsLight, base
    };
    log(`${e.name} 出现。`, 'bad');

    let choice = await FT.UI.choose({
      title: base.name,
      body: `<p class="enemy-flavor">${base.flavor || base.desc}</p>
             <p class="mono">健康 ${e.hp}/${e.maxHp} · 攻击 ${e.atk[0]}d${e.atk[1]} · 防御 ${e.def}
             ${e.needsLight ? ' · <span class="warn">需要强光</span>' : ''}</p>`,
      prompt: ambush ? '突袭！你们只有一瞬间决定。' : '怎么办？',
      options: [
        { label: '战斗', desc: '最多三轮，打不赢就得脱离。', value: 'fight' },
        { label: '逃跑', desc: '判定失败会被追上，全员受伤。', value: 'flee' }
      ]
    });

    if (choice === 'flee') {
      const who = bestPlayer('stamina');
      const mod = checkMod(who, 'stamina');
      await FT.UI.dice({ label: '脱离判定' });
      const r = roll(20) + mod;
      if (r >= 11) {
        alive().forEach(p => p.stamina = clamp(p.stamina - 4, 0, p.maxStamina));
        log(`成功脱离（${r}）。全员体力 -4。`, 'good');
        await FT.UI.say({ title: '脱离了', body: '<p class="flavor">你们跑了很久，直到听不见那个声音。</p>', tone: 'good' });
      } else {
        alive().forEach(p => { damage(p, 6); p.sanity = clamp(p.sanity - 3, 0, p.maxSanity); });
        log(`脱离失败（${r}）。全员健康 -6、精神 -3。`, 'bad');
        await FT.UI.say({ title: '没跑掉', body: '<p class="flavor">它比你快。它一直比你快。</p>', tone: 'bad' });
      }
      checkDeaths();
      return;
    }

    /* --- 战斗回合 --- */
    const weaponOf = (p) => {
      const w = st.inv.map(i => ITEMS[i.id]).filter(i => i && i.cat === 'weapon');
      if (p.charId === 'hunter' && w.some(x => x.name === '猎枪')) return w.find(x => x.name === '猎枪');
      return w[0] || { dice: 4, hit: 0, name: '拳头' };
    };

    for (let round = 1; round <= 3 && e.hp > 0; round++) {
      log(`— 第 ${round} 轮 —`, 'sub');
      for (const p of alive()) {
        const w = weaponOf(p);
        const m = checkMod(p, 'hp') + (w.hit || 0) + (p.charId === 'hunter' && round === 1 ? 2 : 0);
        await FT.UI.dice({ label: `${p.name} 攻击` });
        const r = roll(20) + m;
        let dmg = 0;
        if (r >= e.def) {
          dmg = roll(w.dice || 4) + 2;
          if (e.needsLight && !hasLight()) dmg = Math.max(1, Math.floor(dmg / 2));
          e.hp -= dmg;
          log(`${p.name} 用${w.name}命中，造成 ${dmg} 点伤害。`, 'good');
        } else {
          log(`${p.name} 落空（${r}）。`, 'bad');
        }
        if (e.hp <= 0) break;
      }
      if (e.hp <= 0) break;

      // 敌人反击
      const target = pick(alive());
      if (target) {
        const a = roll(e.atk[1]) + e.atk[0] - 1;
        damage(target, a);
        log(`${e.name} 扑向 ${target.name}，${a} 点伤害。`, 'bad');
      }
      if (e.sanityDrain) {
        alive().forEach(p => p.sanity = clamp(p.sanity - e.sanityDrain, 0, p.maxSanity));
        log(`低语侵蚀：全员精神 -${e.sanityDrain}。`, 'bad');
      }
      checkDeaths();
      await FT.UI.say({ title: `第 ${round} 轮结束`, body: `<p class="mono">${e.name} 剩余健康 ${Math.max(0, e.hp)}</p>`, tone: 'info', compact: true });
      if (alive().length === 0) return;
    }

    if (e.hp <= 0) {
      log(`${e.name} 倒下了。`, 'good');
      const loot = enemyId === 'beast' ? ['raw_meat', 'bone'] : enemyId === 'unknown' ? ['bone', 'odd_stone'] : ['bone', 'cloth'];
      addItem(loot[0], 1, ITEMS[loot[0]].food ? ITEMS[loot[0]].expire : undefined);
      if (rnd() < 0.6) addItem(loot[1], 1, ITEMS[loot[1]].food ? ITEMS[loot[1]].expire : undefined);
      await FT.UI.say({ title: '打赢了', body: `<p class="flavor">它倒下的姿势，和人很像。你们没有多看。</p>`, tone: 'good' });
    } else {
      const who = bestPlayer('stamina');
      await FT.UI.dice({ label: '强制脱离' });
      const r = roll(20) + checkMod(who, 'stamina');
      if (r >= 12) {
        log('你们勉强脱离了战斗。', 'warn');
        await FT.UI.say({ title: '脱离', body: '<p class="flavor">没人喊撤退。但大家都在往回跑。</p>', tone: 'warn' });
      } else {
        alive().forEach(p => damage(p, 5));
        log('脱离失败，全员健康 -5。', 'bad');
        await FT.UI.say({ title: '代价', body: '<p class="flavor">你们冲了出来，四个人身上都少了一块。</p>', tone: 'bad' });
      }
      checkDeaths();
    }
  }

  /* =====================================================================
   * 行动
   * ===================================================================== */
  async function doAdvance() {
    const cost = alive().some(p => p.status.includes('hungry')) ? Math.round(C.ADVANCE_COST * 1.5) : C.ADVANCE_COST;
    let gain = C.ADVANCE_PROGRESS;
    if (alive().some(p => p.charId === 'hunter')) gain += 1;
    alive().forEach(p => p.stamina = clamp(p.stamina - cost, 0, p.maxStamina));
    st.progress += gain;
    log(`前进：进度 +${gain}（${st.progress}/${st.goal}），体力 -${cost}。`, 'good');
    await FT.UI.say({ title: '前进', body: `<p class="flavor">你们往认定的方向走了一段。树往后退了一些。</p><p class="mono">进度 ${st.progress}/${st.goal}</p>`, tone: 'good', compact: true });
    if (rnd() < 0.2) {
      log('前进途中触发了额外事件。', 'warn');
      await resolveCard(drawCard());
    }
  }

  async function doGather() {
    alive().forEach(p => p.stamina = clamp(p.stamina - C.GATHER_COST, 0, p.maxStamina));
    const n = ri(1, 3);
    const got = [];
    for (let i = 0; i < n; i++) {
      const id = weighted(scene().gather);
      const d = ITEMS[id];
      addItem(id, 1, d.food ? d.expire : undefined);
      got.push(d.name);
    }
    log(`收集：获得 ${got.join('、')}。体力 -${C.GATHER_COST}。`, 'good');
    await FT.UI.say({ title: '收集', body: `<p class="flavor">你们在附近翻找了一会儿。</p><p class="mono">获得：${got.join('、')}</p>`, tone: 'good', compact: true });
    if (rnd() < 0.15) {
      log('收集时惊动了什么。', 'warn');
      await resolveCard(drawCard());
    }
  }

  async function doCraft() {
    const canMake = FT.RECIPES.filter(r => {
      if (r.needFire && st.fire <= 0) return false;
      return Object.entries(r.req).every(([id, q]) => countItem(id) >= q);
    });
    const id = await FT.UI.craftMenu(canMake.map(r => r.id));
    if (!id) {
      log('放弃合成，本回合空过。', 'warn');
      return;
    }
    const r = FT.RECIPES.find(x => x.id === id);
    Object.entries(r.req).forEach(([iid, q]) => { if (iid !== r.keepTool) removeItem(iid, q); });
    if (r.fire) {
      st.fire = C.FIRE_TURNS;
      log(`搭起了篝火（持续 ${C.FIRE_TURNS} 回合）。`, 'good');
    } else {
      let qty = 1;
      const d = ITEMS[r.out];
      if (d && d.food && d.portions) qty = d.portions;
      const chefBonus = alive().some(p => p.charId === 'chef') && r.cook ? 1 : 0;
      if (r.cook && chefBonus) qty += 1;
      addItem(r.out, qty, d && d.food ? d.expire : undefined);
      log(`合成了 ${d ? d.name : r.out}${qty > 1 ? ' ×' + qty : ''}。`, 'good');
    }
    await FT.UI.say({ title: '合成完成', body: `<p class="flavor">${r.desc}</p>`, tone: 'good', compact: true });
  }

  async function doRest() {
    alive().forEach(p => {
      p.stamina = clamp(p.stamina + C.REST_STAMINA, 0, p.maxStamina);
      p.sanity = clamp(p.sanity + C.REST_SANITY, 0, p.maxSanity);
      if (!p.status.includes('dying')) heal(p, C.REST_HP);
    });
    log(`休整：全员体力 +${C.REST_STAMINA}、精神 +${C.REST_SANITY}，饥饿解除。`, 'good');
    // 休整时的附加选择
    const act = await FT.UI.restMenu();
    if (act === 'eat') await eatFlow();
    else if (act === 'use') await useItemFlow();
    await FT.UI.say({ title: '休整', body: `<p class="flavor">你们靠在树干上，谁也没有说话。这段安静很短，但够用。</p><p class="mono">全员体力 +${C.REST_STAMINA}</p>`, tone: 'good', compact: true });
  }

  async function eatFlow() {
    const foods = st.inv.filter(i => ITEMS[i.id] && ITEMS[i.id].food);
    if (!foods.length) {
      await FT.UI.say({ title: '没有食物', body: '<p class="flavor">背包里能吃的都吃完了。</p>', tone: 'bad', compact: true });
      return;
    }
    const idx = await FT.UI.choose({
      title: '进食',
      body: '<p class="flavor">吃什么？</p>',
      options: foods.map((f, i) => ({
        label: `${ITEMS[f.id].name}（剩 ${f.qty}）`,
        desc: `体力 +${ITEMS[f.id].stamina}${f.expire !== undefined ? ` · 保质期 ${f.expire} 回合` : ''}${ITEMS[f.id].portions ? ' · 可分食' : ''}`,
        value: i
      })).concat([{ label: '算了', desc: '什么都不吃', value: -1 }])
    });
    if (idx < 0) return;
    const f = foods[idx];
    const def = ITEMS[f.id];
    st.stats.foods++;

    if (def.portions && f.qty > 1) {
      const alloc = await FT.UI.foodDivide({
        name: def.name, icon: def.icon, portions: f.qty, staminaEach: def.stamina,
        players: alive().map(p => ({ id: p.id, name: p.name, stamina: p.stamina, hungry: p.status.includes('hungry') }))
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
      log(`分食 ${def.name}：${Object.entries(alloc).map(([pid, n]) => {
        const p = st.players.find(x => x.id === pid); return `${p.name} ${n} 份`;
      }).join('，')}。`, 'good');
    } else {
      const n = Math.min(f.qty, alive().length);
      f.qty -= n;
      // 体力最低的人优先
      const order = alive().slice().sort((a, b) => a.stamina - b.stamina);
      order.slice(0, n).forEach(p => {
        p.stamina = clamp(p.stamina + def.stamina, 0, p.maxStamina);
        if (def.help) p.sanity = clamp(p.sanity + def.help, 0, p.maxSanity);
        if (def.poison && rnd() < def.poison) {
          addStatus(p, 'poisoned');
          log(`${p.name} 吃坏了肚子。`, 'bad');
        }
      });
      if (f.qty <= 0) st.inv = st.inv.filter(x => x !== f);
      log(`吃了 ${def.name} ×${n}，体力 +${def.stamina}。`, 'good');
    }
    checkDeaths();
  }

  async function useItemFlow() {
    const usable = st.inv.filter(i => ITEMS[i.id] && ITEMS[i.id].use);
    if (!usable.length) {
      await FT.UI.say({ title: '没有可用的物品', body: '<p class="flavor">绷带和药都用完了。</p>', tone: 'bad', compact: true });
      return;
    }
    const idx = await FT.UI.choose({
      title: '使用物品',
      body: '<p class="flavor">给谁用？</p>',
      options: usable.map((u, i) => ({ label: `${ITEMS[u.id].name} ×${u.qty}`, desc: ITEMS[u.id].desc, value: i }))
        .concat([{ label: '算了', desc: '', value: -1 }])
    });
    if (idx < 0) return;
    const u = usable[idx];
    const target = await FT.UI.choose({
      title: '目标',
      body: '<p class="flavor">用在谁身上？</p>',
      options: alive().map((p, i) => ({
        label: p.name, desc: `健康 ${p.hp} · ${p.status.filter(s => s !== 'hungry').join(' ') || '无状态'}`, value: i
      }))
    });
    const p = alive()[target];
    const use = ITEMS[u.id].use;
    heal(p, use.hp || 0);
    if (use.cure) p.status = p.status.filter(s => s !== use.cure);
    if (p.charId === 'medic') heal(p, 3);
    removeItem(u.id, 1);
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
      FT.UI.render();
      await FT.UI.flash(`第 ${st.day} 天 · ${isNight() ? '夜晚' : '白天'} · 第 ${st.turn} 回合`);

      /* 1. 结算预告 */
      if (st.preview) {
        const card = st.preview;
        st.preview = null;
        await resolveCard(card);
        if (st.over) { finish(); return; }
      }

      /* 2. 行动阶段 */
      if (st.skipAction) {
        st.skipAction = false;
        log('本回合行动阶段被跳过。', 'warn');
        await FT.UI.say({ title: '行动被跳过', body: '<p class="flavor">你们没能做任何事。这一天被什么东西吃掉了。</p>', tone: 'warn', compact: true });
      } else {
        const opts = [
          { label: '前进', desc: `进度 +${C.ADVANCE_PROGRESS}（猎人 +1）· 体力 -${C.ADVANCE_COST}`, value: 'advance' },
          { label: '收集', desc: `按地形获取资源 · 体力 -${C.GATHER_COST}`, value: 'gather' },
          { label: '合成', desc: '用材料制作物品或食物（烹饪需篝火）', value: 'craft' },
          { label: '休整', desc: `体力 +${C.REST_STAMINA}、解除饥饿，可进食或用药`, value: 'rest' }
        ];
        const act = await FT.UI.vote({
          title: '本回合做什么？',
          body: `<p class="flavor">${scene().tagline}</p>`,
          prompt: '全员投票，少数服从多数。平票 → 强制休整（且不回复体力）',
          options: opts,
          timeoutText: '僵持不下'
        });
        if (act === 'advance') await doAdvance();
        else if (act === 'gather') await doGather();
        else if (act === 'craft') await doCraft();
        else if (act === 'rest') await doRest();
        else {
          log('投票平票，本回合强制休整且不回复体力。', 'bad');
          await FT.UI.say({ title: '僵持', body: '<p class="flavor">你们谁也说服不了谁。天一黑，这一天就没了。</p>', tone: 'bad', compact: true });
        }
      }

      if (st.over) { finish(); return; }

      /* 3. 回合结算 */
      await endOfTurn();
      if (st.over) { finish(); return; }

      /* 4. 阶段检查 */
      if (st.progress >= st.goal) {
        await phaseUp();
        if (st.over) { finish(); return; }
      }

      /* 5. 切到下一回合，再抽那张"属于下一回合"的预告 */
      const endedDay = st.day, endedTurn = st.turn;
      st.turn++;
      if (st.turn > C.TURNS_PER_DAY) { st.turn = 1; st.day++; }
      st.preview = drawCard();
      FT.UI.render();
      await FT.UI.endTurnSummary(previewText(), endedDay, endedTurn);
      FT.UI.save();
      FT.UI.render();
    } finally {
      busy = false;
    }
  }

  function previewText() {
    return st.preview ? `${st.preview.title}` : '——';
  }

  async function endOfTurn() {
    alive().forEach(p => {
      p.stamina = clamp(p.stamina - C.TURN_STAMINA_COST, 0, p.maxStamina);

      let sc = isNight() ? C.NIGHT_SANITY_COST : C.DAY_SANITY_COST;
      if (st.fire > 0 && isNight()) sc = 1;
      sc -= scene().sanityMod;
      p.sanity = clamp(p.sanity - Math.max(0, sc), 0, p.maxSanity);

      // 饥饿
      if (p.stamina <= p.maxStamina * 0.25) {
        if (!p.status.includes('hungry')) { addStatus(p, 'hungry'); log(`${p.name} 饿得发抖。`, 'warn'); }
        damage(p, isNight() ? 2 : 1, true);
      } else {
        p.status = p.status.filter(s => s !== 'hungry');
      }
      // 流血 / 中毒
      if (p.status.includes('bleeding')) damage(p, 3, true);
      if (p.status.includes('poisoned')) {
        damage(p, 2, true);
        if (rnd() < 0.28) { p.status = p.status.filter(x => x !== 'poisoned'); log(`${p.name} 的毒性退了。`, 'good'); }
      }
      // 使徒崩溃
      if (p.charId === 'apostle' && p.sanity >= 90) p.sanity = clamp(p.sanity - 3, 0, p.maxSanity);
      // 精神崩溃
      if (p.sanity <= p.maxSanity * 0.25 && !p.status.includes('madness')) {
        addStatus(p, 'madness');
        const sym = FT.SYMPTOMS.find(s => s.id === p.symptom);
        log(`${p.name} 出现心理疾病：${sym ? sym.name : '未知'}。`, 'bad');
      }
      // 濒死计时
      if (p.status.includes('dying')) {
        p.dyingTurns--;
        if (p.dyingTurns <= 0) {
          p.dead = true;
          st.stats.deaths++;
          log(`${p.name} 没有撑过去。`, 'bad');
        }
      }
    });

    // 食物腐败
    st.inv.forEach(it => {
      const d = ITEMS[it.id];
      if (!d || !d.food || it.expire === undefined) return;
      it.expire--;
      if (it.expire <= 0 && !d.spoiled) {
        it.id = 'spoiled';
        it.expire = 999;
        log(`${d.name} 变质了。`, 'warn');
      }
    });
    st.inv = st.inv.filter(i => i.qty > 0);

    if (isNight() && st.fire > 0) {
      alive().forEach(p => p.sanity = clamp(p.sanity + 2, 0, p.maxSanity));
      if (!st._fireNoted) { log('围着篝火过了一夜，精神略有恢复。', 'good'); st._fireNoted = true; }
    }
    if (st.fire > 0) {
      st.fire--;
      if (st.fire === 0) log('篝火熄灭了。', 'warn');
    }
    checkDeaths();
    if (alive().length === 0) { st.over = true; st.victory = false; }
  }

  async function phaseUp() {
    const next = st.phase + 1;
    if (next >= C.PROGRESS_GOALS.length) {
      st.over = true; st.victory = true;
      return;
    }
    enterPhase(next);
    alive().forEach(p => p.sanity = clamp(p.sanity + 6, 0, p.maxSanity));
    log(`进入新场景：${scene().name}，全队精神 +6。`, 'event');
    await FT.UI.say({
      title: `第 ${st.phase + 1} 阶段 · ${scene().name}`,
      body: `<p class="flavor">${scene().tagline}</p><p class="mono">新的进度目标：${st.goal}</p>`,
      tone: 'info', phaseChange: true
    });
  }

  /* 主循环：每回合结束后等玩家点"进入下一回合"，再自动接上 */
  async function start() {
    if (!st || st.over) return;
    while (!st.over) {
      await runTurn();
      if (st.over) break;
    }
  }

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    FT.UI.render();
    FT.UI.gameOver(st.victory, st);
    FT.UI.save();
  }

  /* =====================================================================
   * 调试接口（给演示/美术看全场景用）
   * ===================================================================== */
  function debugJump(sceneKey) {
    st.scene = sceneKey;
    st.used = [];
    FT.UI.render(); FT.UI.save();
  }
  function debugRefill() {
    alive().forEach(p => { p.hp = p.maxHp; p.stamina = p.maxStamina; p.sanity = p.maxSanity; p.status = p.status.filter(s => s === 'madness'); });
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
    set rngState(v) { rngState = v; },
    newGame, start, runTurn, drawCard, checkMod, statName, applyFx,
    addItem, removeItem, countItem, hasItem, slots, slotUsed,
    alive, isNight, scene, heal, damage,
    debugJump, debugRefill, debugMaterials, debugNextPhase,
    restore(state, rng) { st = state; rngState = rng; },
    _internal: { roll, ri, rnd, pick }
  };
})();
