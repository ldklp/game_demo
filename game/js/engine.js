/* =====================================================================
 * ForestTable · 引擎层 v2.0（d6 战斗版）
 * ---------------------------------------------------------------------
 * 三件事和 v1 完全不同：
 *
 * ① 所有判定 = 1d6 + 修正 ≥ 难度(3~6)。自然 6 大成功，自然 1 大失败。
 *
 * ② 战斗不再"每人各打一轮"，而是每个「节拍」双方各投 1d6 抢行动权：
 *      你 1d6 + 速度修正  vs  敌人 1d6 + 速度修正  → 高者行动，平手你优先。
 *    连续行动的一方，本次判定 -1（本回合所有判定都 -1），
 *    连续第 3 次起 -2；对方行动一次后惩罚清零。
 *
 * ③ 伤害 = 角色伤害 + 武器加成 + 携带道具加成；骰面 = 武器暴击点 → ×2。
 *    例：猎人（伤害 3）持猎枪（+3，暴击 4）→ 命中 6 点，投出 4 时 12 点。
 *
 * 面板接口（ui.js 实现）：
 *   P.head / section / append / ask / next / foodDivide
 *   P.d6({label, mod, dc, who})  → {roll,total,ok,crit}
 *   P.versus({left,right,winner,label})  → 抢行动权对比动画
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
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const d6 = () => ri(1, 6);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  function weighted(table) {
    const total = table.reduce((s, x) => s + x[1], 0);
    let r = rnd() * total;
    for (const [k, w] of table) { if ((r -= w) <= 0) return k; }
    return table[0][0];
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sign = n => (n >= 0 ? '+' + n : String(n));

  /* ---------- 状态访问 ---------- */
  const alive = () => st.players.filter(p => !p.dead);
  const me = () => alive()[0] || st.players[0];
  const isNight = () => st.turn > C.DAY_TURNS;
  const scene = () => FT.SCENES[st.scene];
  const hasItem = id => st.inv.some(i => i.id === id && i.qty > 0);
  const hasLight = () => st.fire > 0 || hasItem('torch');
  const statName = s => ({ hp: '健康', stamina: '体力', sanity: '精神', dmg: '伤害' })[s] || s;

  function log(text, kind) {
    st.log.push({ t: `D${st.day}·T${st.turn}`, text, kind: kind || 'info' });
    if (st.log.length > C.MAX_LOG) st.log.shift();
  }

  /* ---------- 背包 ---------- */
  function slots() {
    const c = FT.CHARS.find(x => x.id === me().charId);
    return C.BASE_SLOTS + ((c && c.slotBonus) || 0);
  }
  const slotUsed = () => st.inv.length;
  function addItem(id, qty, expire) {
    if (!qty || !ITEMS[id]) return;
    const d = ITEMS[id];
    if (d.food) {
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
  const distinctTools = () => {
    const seen = {};
    st.inv.forEach(i => { const d = ITEMS[i.id]; if (d && i.qty > 0) seen[i.id] = d; });
    return Object.values(seen);
  };

  /* =====================================================================
   * 派生数值（界面与引擎共用同一套算式）
   * ===================================================================== */

  /* 当前武器：拿手里伤害最高的那把；没有武器就用拳头 */
  function weaponOf(p) {
    const carried = st.inv.map(i => ITEMS[i.id]).filter(d => d && d.cat === 'weapon');
    if (carried.length) return carried.sort((a, b) => (b.weapon.dmg + b.weapon.hit * 0.5) - (a.weapon.dmg + a.weapon.hit * 0.5))[0];
    return null;
  }
  const weaponName = p => { const w = weaponOf(p); return w ? w.name : '空手'; };

  /* 伤害 = 角色伤害 + 武器加成 + 道具加成 + 临时加成 */
  function attackDmg(p) {
    const w = weaponOf(p);
    let base = p.dmg + (w ? w.weapon.dmg : 0);
    distinctTools().forEach(d => { if (d.dmgBonus && !(w && w.weapon.twoHand && d.id === 'shield')) base += d.dmgBonus; });
    base += p.boost || 0;
    return Math.max(1, base);
  }
  /* 防御 = 基础 4 + 道具；长矛双手时不能拿盾 */
  function defense(p) {
    const w = weaponOf(p);
    let d = C.BASE_DEFENSE;
    distinctTools().forEach(t => { if (t.defBonus && !(w && w.weapon.twoHand && t.id === 'shield')) d += t.defBonus; });
    return d;
  }
  /* 攻击修正 = 健康属性修正 + 武器命中 + 状态 */
  function hitMod(p) {
    const w = weaponOf(p);
    let m = FT.attrMod(p.hp) + (w ? w.weapon.hit : 0);
    if (p.status.includes('bleeding')) m -= 1;
    if (p.status.includes('poisoned')) m -= 1;
    if (p.status.includes('hungry')) m -= 1;
    if (p.status.includes('collapse')) m -= 2;
    if (p.symptom === 'hallucination') m -= 1;
    return m;
  }

  /* 非战斗判定修正 */
  function checkMod(p, stat) {
    if (!p) return 0;
    let m = FT.attrMod(p[stat]);
    m += scene().checkMod;
    if (isNight() && !hasLight()) m -= 1;
    if (hasItem('odd_stone')) m += 1;
    if (p.charId === 'apostle' && p.sanity <= 8) m += 1;
    if (p.status.includes('poisoned')) m -= 1;
    if (p.status.includes('hungry')) m -= 1;
    if (p.status.includes('collapse')) m -= 2;
    if (p.status.includes('madness') && p.symptom === 'hallucination') m -= 1;
    if (p.symptom === 'aphasia' && stat === 'sanity') m -= 1;
    if (p.stamina <= 0) m -= 2;
    return m;
  }
  const bestPlayer = stat => alive().slice().sort((a, b) => b[stat] - a[stat])[0] || null;

  /* ---------- 伤害 / 治疗 / 状态 ---------- */
  function damage(p, n) {
    if (!p || p.dead || n <= 0) return;
    p.hp = clamp(p.hp - n, 0, p.maxHp);
    if (p.hp <= 0 && !p.status.includes('dying')) {
      p.status.push('dying');
      p.dyingTurns = C.DYING_TURNS;
      log(`${p.name} 倒下了，进入濒死状态。`, 'bad');
    }
  }
  function heal(p, n) {
    if (!p || p.dead) return;
    if (p.status.includes('hungry')) n = Math.ceil(n / 2);
    p.hp = clamp(p.hp + n, 0, p.maxHp);
    if (p.hp > 0) { p.status = p.status.filter(s => s !== 'dying'); p.dyingTurns = 0; }
  }
  function addStatus(p, s) {
    if (!s || !p || p.dead) return;
    if (s === 'hunger') s = 'hungry';
    if (s === 'madness') { if (p.status.includes('madness')) return; p.symptom = pick(FT.SYMPTOMS).id; }
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
      /* 精神归零不立刻死：进入「崩溃」，3 回合内没缓过来才退场
         ——和「濒死」同一套 3 回合宽限，玩家有得救 */
      if (p.sanity <= 0) {
        p.sanity = 0;
        if (!p.status.includes('collapse')) {
          p.status.push('collapse');
          p.collapseTurns = C.DYING_TURNS;
          log(`${p.name} 的眼神散了。精神归零，进入崩溃。`, 'bad');
        }
      } else if (p.status.includes('collapse')) {
        p.status = p.status.filter(s => s !== 'collapse');
        p.collapseTurns = 0;
        log(`${p.name} 缓过来了。`, 'good');
      }
    });
    if (alive().length === 0 && !st.over) { st.over = true; st.victory = false; }
  }

  /* ---------- 抽牌 ---------- */
  function drawCard() {
    const deck = isNight() ? 'night' : 'day';
    const usable = c => (!c.scene || c.scene === st.scene) && !st.used.includes(c.id);

    /* 精英牌：按阶段解锁，低概率插入 */
    const rarePool = FT.CARDS.filter(c => c.rare && (c.minStage || 0) <= st.phase && usable(c));
    /* 每个阶段最多一次精英，否则会变成"每局打三个 boss" */
    if (rarePool.length && !st.eliteThisPhase && rnd() < 0.10) {
      const c = pick(rarePool);
      st.used.push(c.id);
      return c;
    }

    const normal = c => !c.rare && (c.deck === deck || c.deck === 'any');
    let pool = FT.CARDS.filter(c => normal(c) && usable(c));
    if (!pool.length) {
      st.used = st.used.filter(id => { const c = FT.CARDS.find(x => x.id === id); return c && c.scene === st.scene; });
      pool = FT.CARDS.filter(c => normal(c) && usable(c));
    }
    if (!pool.length) { pool = FT.CARDS.filter(c => normal(c) && (!c.scene || c.scene === st.scene)); st.used = []; }
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
      progress: 0, goal: C.PROGRESS_GOALS[0], eliteThisPhase: 0,
      fire: 0, inv: [], used: [], log: [],
      preview: null, skipAction: false, over: false, victory: false,
      players: roster.map((r, i) => {
        const c = FT.CHARS.find(x => x.id === r.charId) || FT.CHARS[0];
        return {
          id: 'p' + (i + 1), name: r.name || c.name, charId: c.id,
          hp: c.hp, stamina: c.stamina, sanity: c.sanity, dmg: c.dmg,
          maxHp: c.hp, maxStamina: c.stamina, maxSanity: c.sanity,
          status: [], symptom: null, dyingTurns: 0, dead: false, boost: 0, firstHit: 0
        };
      }),
      stats: { turns: 0, events: 0, deaths: 0, foods: 0, fights: 0, elites: 0, crits: 0, maxChain: 0, eliteBeats: 0, eliteWins: 0, flee: 0 }
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
    ['riverside', 'dark_forest'],
    ['swamp', 'cliff'],
    ['waterfall', 'lakeshore']
  ];
  function enterPhase(idx) {
    st.phase = idx;
    st.goal = C.PROGRESS_GOALS[idx] || C.PROGRESS_GOALS[C.PROGRESS_GOALS.length - 1];
    st.progress = 0;
    st.scene = idx >= C.PROGRESS_GOALS.length - 1 ? 'lakeshore' : pick(PHASE_SCENES[idx] || PHASE_SCENES[0]);
    st.used = [];
    st.eliteThisPhase = 0;
  }

  /* =====================================================================
   * 判定：全游戏唯一的骰子公式
   * ===================================================================== */
  async function makeCheck(P, o) {
    const p = o.who || bestPlayer(o.stat) || me();
    const mod = o.modOverride !== undefined ? o.modOverride : checkMod(p, o.stat);
    const r = await P.d6({ label: o.label || `${statName(o.stat)}判定`, mod, dc: o.dc, who: p.name });
    /* 自然 6 大成功：额外回复 1 点该属性；自然 1 大失败：必失败 */
    if (r.roll === 6 && o.stat) {
      if (o.stat === 'stamina') p.stamina = clamp(p.stamina + 1, 0, p.maxStamina);
      else if (o.stat === 'sanity') p.sanity = clamp(p.sanity + 1, 0, p.maxSanity);
      else heal(p, 1);
    }
    return r;
  }

  /* =====================================================================
   * 事件
   * ===================================================================== */
  const TYPE_NAME = { encounter: '遭遇敌人', mystery: '神秘事件', hazard: '意外', skip: '强制' };

  async function resolveCard(card, P) {
    st.stats.events++;
    log(`【${card.title}】`, 'event');
    P.section(`事件 · ${TYPE_NAME[card.type] || '事件'}`, cardHtml(card));

    if (card.type === 'encounter') { await combat(card, P); return; }

    if (card.type === 'skip') {
      applyFx(card.fx);
      if (st.over) return;
      P.append(`<div class="eresult no">${esc(card.result || card.text)}</div><div class="mono">本回合行动阶段被跳过。</div>`);
      return;
    }
    if (card.type === 'hazard' && card.check) {
      const r = await makeCheck(P, { stat: card.check.stat, dc: card.check.dc, label: `${statName(card.check.stat)}判定` });
      const out = r.ok ? card.ok : card.bad;
      applyFx(out, me());
      if (st.over) return;
      P.append(`<div class="eresult ${r.ok ? 'ok' : 'no'}">${esc(out.result || (r.ok ? '你挺过去了。' : '事情变糟了。'))}</div>`);
      return;
    }
    if (card.type === 'mystery' && card.choices) {
      const v = await P.ask(card.choices.map((c, i) => ({ label: c.label, desc: c.desc, value: i })), '你怎么做？');
      const c = card.choices[v];
      applyFx(c.fx, me());
      if (st.over) return;
      P.append(`<div class="eresult ok">${esc(c.result || '')}</div>`);
    }
  }

  function cardHtml(card) {
    const deckName = card.deck === 'night' ? '夜晚' : card.deck === 'any' ? '不分昼夜' : '白天';
    return `<div class="ecard">
      <div class="etitle">${esc(card.title)}</div>
      <div class="etype">${deckName} · ${TYPE_NAME[card.type] || ''}${card.ambush ? ' · 突袭' : ''}${card.type === 'encounter' ? ' · 精英' : ''}</div>
      <div class="etext">${esc(card.text)}</div>
    </div>`;
  }

  /* =====================================================================
   * 战斗：d6 抢行动权
   * ===================================================================== */
  function buildEnemy(card) {
    const base = FT.ENEMIES[card.enemy];
    if (!base) return null;
    const g = base.group ? ri(base.group[0], base.group[1]) : 1;
    const hp = (base.hp[st.phase] || base.hp[base.hp.length - 1]) * g;
    return {
      key: card.enemy,
      name: base.name + (g > 1 ? ` ×${g}` : ''),
      hp, maxHp: hp, atk: base.atk + (g - 1), hit: base.hit, evade: base.evade, spd: base.spd,
      elite: !!base.elite, needsLight: !!base.needsLight, sanityDrain: base.sanityDrain || 0,
      rage: !!base.rage, enraged: false, desc: base.desc, flavor: base.flavor
    };
  }

  function ebar(e) {
    const pct = Math.max(0, e.hp / e.maxHp * 100);
    return `<div class="ebar"><i style="width:${pct}%"></i><span>${Math.max(0, e.hp)} / ${e.maxHp}</span></div>`;
  }

  async function combat(card, P) {
    const e = buildEnemy(card);
    if (!e) return;
    st.stats.fights++;
    if (e.elite) { st.stats.elites++; st.eliteThisPhase = 1; }
    const p = me();
    p.firstHit = 0;
    log(`${e.name} 出现。`, 'bad');

    const box = P.section(e.elite ? '战斗 · 精英' : '战斗', `
      <div class="ebox">
        <div class="ehead"><span class="ename">${esc(e.name)}</span>
          <span class="etags">${e.elite ? '<b class="etag elite">精英</b>' : ''}闪避 ${e.evade} · 命中 ${sign(e.hit)} · 伤害 ${e.atk} · 速度 ${sign(e.spd)}</span></div>
        <div data-hp>${ebar(e)}</div>
        <div class="eflavor">${esc(e.flavor || e.desc)}</div>
      </div>
      <div data-feed></div>`);
    const feed = box.querySelector('[data-feed]');
    const hpBox = box.querySelector('[data-hp]');
    const say = html => { feed.insertAdjacentHTML('beforeend', html); };
    /* 战斗中左侧面板要跟着掉血，不然玩家看不见自己还剩多少 */
    const sync = () => { try { FT.UI.render(); } catch (e) { } };

    say(`<div class="mono" style="margin-top:8px">你：伤害 ${attackDmg(p)}（${esc(weaponName(p))}）· 防御 ${defense(p)} · 攻击修正 ${sign(hitMod(p))}</div>`);

    const choice = await P.ask([
      { label: '迎战', desc: `每节拍双方各投 d6 抢出手，连击 -1`, value: 'fight' },
      { label: '试着逃', desc: `难度 ${e.elite ? C.FLEE_ELITE_DC : C.FLEE_DC}，失败会被咬一口`, value: 'flee' }
    ], '怎么办？');

    if (choice === 'flee') {
      const ok = await tryFlee(e, P, p, 0);
      if (ok) return;
    }

    let beat = 0, chainP = 0, chainE = 0, defendBonus = 0, defending = false, over = false;

    while (e.hp > 0 && p.hp > 0 && beat < 20 && !over) {
      beat++;

      /* --- ① 抢行动权 --- */
      const pPen = chainP > 0 ? -Math.min(chainP, C.CHAIN_PENALTY_MAX) : 0;
      const ePen = chainE > 0 ? -Math.min(chainE, C.CHAIN_PENALTY_MAX) : 0;
      const w = weaponOf(p);
      const pSpd = (w && w.weapon.firstStrike && beat === 1 ? 1 : 0) + defendBonus;
      const pRoll = d6(), eRoll = d6();
      const pTotal = pRoll + pSpd + pPen;
      const eTotal = eRoll + e.spd + ePen;
      const playerActs = pTotal >= eTotal;
      defendBonus = 0;

      await P.versus({
        label: `第 ${beat} 节拍 · 抢行动权`,
        left: { name: '你', roll: pRoll, mod: pSpd + pPen, total: pTotal, chain: chainP },
        right: { name: e.name, roll: eRoll, mod: e.spd + ePen, total: eTotal, chain: chainE },
        winner: playerActs ? 'left' : 'right'
      });

      if (playerActs) { chainP++; chainE = 0; if (chainP > st.stats.maxChain) st.stats.maxChain = chainP; }
      else { chainE++; chainP = 0; }

      /* --- ② 行动 --- */
      if (playerActs) {
        const act = await P.ask([
          { label: '攻击', desc: `d6${sign(hitMod(p) + pPen)} 命中 vs 闪避 ${e.evade} · 伤害 ${attackDmg(p)}`, value: 'atk' },
          { label: '防守', desc: `本回合被命中时 -${C.DEFEND_REDUCE} 伤害 · 下次抢行动权 +${C.DEFEND_INIT_BONUS}`, value: 'def' },
          { label: '用道具', desc: '绷带 / 药 / 燃烧瓶 / 火药', value: 'item' },
          { label: '撤退', desc: `难度 ${e.elite ? C.FLEE_ELITE_DC : C.FLEE_DC}`, value: 'flee' }
        ], `${p.name} 行动${pPen ? `（连击惩罚 ${pPen}）` : ''}`);

        if (act === 'flee') {
          if (await tryFlee(e, P, p, pPen)) return;
          continue; // 逃跑失败，敌人这次已经打过了（tryFlee 内部处理）
        }

        if (act === 'def') {
          defending = true; defendBonus = C.DEFEND_INIT_BONUS;
          say(`<div class="mono">你压低身体，把要害藏起来。<span class="good">下一次受到的伤害 -${C.DEFEND_REDUCE}</span>，下次抢行动权 +${C.DEFEND_INIT_BONUS}。</div>`);
          continue;
        }

        if (act === 'item') {
          const used = await combatItem(P, p, e, say);
          if (used === 'flee') return;
          if (used) { hpBox.innerHTML = ebar(e); if (e.hp <= 0) break; }
          continue;
        }

        /* 攻击 */
        const r = d6();
        const wNow = weaponOf(p);
        let modNow = hitMod(p) + pPen + (p.charId === 'hunter' && p.firstHit === 0 ? 1 : 0);
        p.firstHit = 1;
        const total = r + modNow;
        const critFace = wNow ? wNow.weapon.crit : 0;
        const isCrit = critFace > 0 && r === critFace;
        const hit = r !== 1 && total >= e.evade;

        if (!hit) {
          if (r === 1) {
            say(`<div class="mono bad">骰面 1 · 大失败。${esc(weaponName(p))}脱手了，你自己弄伤了自己 1 点。</div>`);
            damage(p, 1);
          } else {
            say(`<div class="mono" style="opacity:.7">${r} ${sign(modNow)} = ${total} &lt; 闪避 ${e.evade} —— 落空。</div>`);
          }
        } else {
          let dmg = attackDmg(p);
          if (isCrit) { dmg *= 2; st.stats.crits++; }
          else if (r === 6) dmg += 1;
          e.hp = Math.max(0, e.hp - dmg);
          p.boost = 0;
          hpBox.innerHTML = ebar(e);
          sync();
          say(`<div class="mono ${isCrit ? 'crit' : 'good'}">${r} ${sign(modNow)} = ${total} ≥ 闪避 ${e.evade} —— 命中${isCrit ? `<b class="crit">暴击（骰面 ${critFace}）</b>，${esc(weaponName(p))}造成 <b>${dmg}</b> 伤害` : `，造成 <b>${dmg}</b> 伤害`}。</div>`);
          log(`命中 ${e.name}，${dmg} 伤害${isCrit ? '（暴击）' : ''}。`, 'good');
          if (e.rage && !e.enraged && e.hp <= e.maxHp / 2) {
            e.enraged = true;
            say(`<div class="mono bad">它的动作变了。骨头缝里开始渗东西——<b>狂暴：伤害 +1、命中 +1</b>。</div>`);
          }
        }
        if (e.hp <= 0) break;

        /* 体力衰减：每 4 节拍 -1，防止无限磨 */
        if (beat % C.FATIGUE_EVERY === 0) {
          p.stamina = clamp(p.stamina - 1, 0, p.maxStamina);
          say(`<div class="mono" style="opacity:.6">僵持太久，体力 -1。</div>`);
        }
      } else {
        /* --- 敌人行动 --- */
        if (e.sanityDrain) {
          p.sanity = clamp(p.sanity - e.sanityDrain, 0, p.maxSanity);
          say(`<div class="mono" style="color:#8f7fb8">它的声音钻进你脑子里。精神 -${e.sanityDrain}。</div>`);
        }
        const r = d6();
        const modNow = e.hit + ePen + (e.enraged ? 1 : 0);
        const total = r + modNow;
        const def = defense(p) + (defending ? 1 : 0);
        if (r === 1 || total < def) {
          say(`<div class="mono" style="opacity:.7">${esc(e.name)} 扑过来（${r} ${sign(modNow)} = ${total} &lt; 你的防御 ${def}）—— 你躲开了。</div>`);
        } else {
          let dmg = e.atk + (e.enraged ? 1 : 0) + (r === 6 ? 2 : 0);
          if (defending) dmg = Math.max(1, dmg - C.DEFEND_REDUCE);
          if (e.needsLight && !hasLight()) { dmg *= 2; say(`<div class="mono" style="opacity:.7">没有光，你连它的边都看不清。</div>`); }
          damage(p, dmg);
          say(`<div class="mono bad">${esc(e.name)} 命中（${r} ${sign(modNow)} = ${total} ≥ ${def}）—— 你受到 <b>${dmg}</b> 点伤害${defending ? '（已减伤）' : ''}${r === 6 ? ' · 凶狠一击' : ''}。</div>`);
          sync();
        }
        defending = false;
        checkDeaths();
        if (p.hp <= 0) { over = true; break; }
      }
    }

    /* --- ③ 收尾 --- */
    if (e.elite) { st.stats.eliteBeats += beat; if (e.hp <= 0) st.stats.eliteWins++; }
    if (e.hp <= 0) {
      log(`${e.name} 倒下了。`, 'good');
      say(`<div class="eresult ok">它倒下的姿势，和人很像。</div>`);
      const base = FT.ENEMIES[card.enemy];
      const loot = base.loot || ['bone'];
      loot.forEach((id, i) => {
        if (i === 0 || rnd() < 0.6) {
          const d = ITEMS[id];
          addItem(id, 1, d && d.food ? d.expire : undefined);
          say(`<div class="mono">获得 ${d ? d.name : id}。</div>`);
        }
      });
      if (e.elite) { addItem('whetstone', 1); say(`<div class="mono">精英的骨头很硬。你抠下来一块，可以当磨刀石。</div>`); }
    } else if (p.hp <= 0) {
      say(`<div class="eresult no">你倒在了这里。血从耳朵里流出来，你听见森林在数你的骨头。</div>`);
      log('你在战斗中倒下了。', 'bad');
    } else {
      say(`<div class="eresult no">二十个节拍过去了，你们谁也没能杀死谁。你趁它换气的一瞬脱身。</div>`);
      p.stamina = clamp(p.stamina - 2, 0, p.maxStamina);
    }
    checkDeaths();
  }

  /* 撤退判定：成功 → 结束战斗；失败 → 敌人立刻攻击一次 */
  async function tryFlee(e, P, p, pen) {
    const dc = e.elite ? C.FLEE_ELITE_DC : C.FLEE_DC;
    const r = await P.d6({ label: '撤退判定', mod: FT.attrMod(p.stamina) + pen, dc });
    if (r.ok) {
      p.stamina = clamp(p.stamina - 2, 0, p.maxStamina);
      P.append(`<div class="eresult ok">你转身就跑，树在两侧飞快地退。体力 -2，但你活着。</div>`);
      log('脱离了战斗。', 'good');
      return true;
    }
    const dmg = Math.max(1, e.atk - 1);
    damage(p, dmg);
    P.append(`<div class="eresult no">它比你快。你被从背后撞了一下，健康 -${dmg}，又逃回了原地。</div>`);
    checkDeaths();
    return false;
  }

  /* 战斗中使用道具 */
  async function combatItem(P, p, e, say) {
    const usable = st.inv.filter(i => ITEMS[i.id] && ITEMS[i.id].use);
    if (!usable.length) { say(`<div class="mono" style="opacity:.6">背包里没有能在战斗中用的东西。</div>`); return false; }
    const opts = usable.map((u, i) => ({ label: `${ITEMS[u.id].name}（${u.qty}）`, desc: ITEMS[u.id].desc, value: i }));
    opts.push({ label: '算了', desc: '', value: -1, light: true });
    const idx = await P.ask(opts, '用哪个？这次行动就用掉了');
    if (idx < 0) return false;

    const u = usable[idx], use = ITEMS[u.id].use;
    removeItem(u.id, 1);
    if (use.burn) {
      e.hp = Math.max(0, e.hp - use.burn);
      say(`<div class="mono good">瓶子砸在它身上，火顺着骨头缝烧进去。造成 <b>${use.burn}</b> 点伤害。</div>`);
    }
    if (use.boost) {
      p.boost = (p.boost || 0) + use.boost;
      say(`<div class="mono good">你把火药抹在刀刃上。下一击伤害 +${use.boost}。</div>`);
    }
    if (use.hp) {
      heal(p, use.hp + (p.charId === 'medic' ? 2 : 0));
      say(`<div class="mono good">你处理了伤口。健康 +${use.hp + (p.charId === 'medic' ? 2 : 0)}。</div>`);
    }
    if (use.cure) p.status = p.status.filter(s => s !== use.cure);
    checkDeaths();
    return true;
  }

  /* =====================================================================
   * 行动
   * ===================================================================== */
  async function actionPhase(P) {
    const p = me();
    const dying = p.status.includes('dying');
    let opts = [
      { label: '前进', desc: `进度 +${C.ADVANCE_PROGRESS} · 体力 -${C.ADVANCE_COST}`, value: 'advance' },
      { label: '收集', desc: `按地形找资源 · 体力 -${C.GATHER_COST}`, value: 'gather' },
      { label: '合成', desc: '做武器、道具、食物（需材料／篝火）', value: 'craft' },
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
    const p = me();
    const cost = p.status.includes('hungry') ? Math.round(C.ADVANCE_COST * 1.5) : C.ADVANCE_COST;
    let gain = C.ADVANCE_PROGRESS;
    if (p.charId === 'hunter') gain += 1;
    p.stamina = clamp(p.stamina - cost, 0, p.maxStamina);
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
    const p = me();
    p.stamina = clamp(p.stamina - C.GATHER_COST, 0, p.maxStamina);
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
    const canMake = r => {
      if (r.needFire && st.fire <= 0) return false;
      return Object.entries(r.req).every(([id, q]) => countItem(id) >= q);
    };
    const opts = FT.RECIPES.map(r => {
      const ok = canMake(r);
      const req = Object.entries(r.req).map(([id, q]) => `${ITEMS[id].name} ${countItem(id)}/${q}`).join(' · ');
      let why = '';
      if (!ok) why = (r.needFire && st.fire <= 0) ? '需要篝火' : '材料不足';
      return { label: r.name + (r.cook ? '（烹饪）' : ''), desc: req + (why ? ' —— ' + why : '') + ' · ' + r.desc, value: r.id, disabled: !ok };
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
      const qty = (d && d.food && d.portions) ? d.portions : 1;
      addItem(r.out, qty, d && d.food ? d.expire : undefined);
      log(`合成了 ${d.name}${qty > 1 ? ' ×' + qty : ''}。`, 'good');
      const extra = d.cat === 'weapon' ? `<div class="mono">当前伤害 ${attackDmg(me())}（角色 ${me().dmg} + 武器 ${d.weapon.dmg} + 道具）· 暴击点 ${d.weapon.crit || '无'}</div>` : '';
      P.section(`合成 · ${d.name}`, `<div class="eflavor">${esc(r.desc)}</div><div class="mono">获得 ${d.name}${qty > 1 ? ' ×' + qty : ''}</div>${extra}`);
    }
  }

  async function doRest(P) {
    const p = me();
    const halve = p.symptom === 'paranoia' ? 0.5 : 1;
    p.stamina = clamp(p.stamina + Math.ceil(C.REST_STAMINA * halve), 0, p.maxStamina);
    p.sanity = clamp(p.sanity + Math.ceil(C.REST_SANITY * halve), 0, p.maxSanity);
    heal(p, Math.ceil(C.REST_HP * halve));
    /* 休整 = 用衣物按住伤口，自动止血（否则流血会变成死循环） */
    const hadBleed = p.status.includes('bleeding');
    if (hadBleed) p.status = p.status.filter(s => s !== 'bleeding');
    log(`休整：体力 +${Math.ceil(C.REST_STAMINA * halve)}、精神 +${Math.ceil(C.REST_SANITY * halve)}、健康 +${Math.ceil(C.REST_HP * halve)}。`, 'good');
    P.section('休整', `<div class="eflavor">你靠在树干上，把呼吸放慢。这段安静很短，但够用。</div>
      <div class="mono">体力 +${Math.ceil(C.REST_STAMINA * halve)} · 精神 +${Math.ceil(C.REST_SANITY * halve)} · 健康 +${Math.ceil(C.REST_HP * halve)}${halve < 1 ? '（偏执：回复减半）' : ''}${hadBleed ? ' · 已止血' : ''}</div>`);

    const act = await P.ask([
      { label: '吃点东西', desc: '从背包里选一样食物', value: 'eat' },
      { label: '使用物品', desc: '绷带、药——给自己处理伤口', value: 'use' },
      { label: '就这样', desc: '什么都不额外做', value: 'none', light: true }
    ], '还要做点什么吗？');
    if (act === 'eat') await eatFlow(P);
    else if (act === 'use') await useItemFlow(P);
  }

  async function eatFlow(P) {
    const p = me();
    const foods = st.inv.filter(i => ITEMS[i.id] && ITEMS[i.id].food);
    if (!foods.length) { P.append(`<div class="eresult no">背包里能吃的都吃完了。</div>`); return; }
    const opts = foods.map((f, i) => ({
      label: `${ITEMS[f.id].name}（${f.qty}）`,
      desc: `体力 +${ITEMS[f.id].stamina}${ITEMS[f.id].help ? ' · 精神 +' + ITEMS[f.id].help : ''}${f.expire !== undefined ? ' · 保质 ' + f.expire : ''}${ITEMS[f.id].portions ? ' · 可分食' : ''}`,
      value: i
    }));
    opts.push({ label: '不吃了', desc: '', value: -1, light: true });
    const idx = await P.ask(opts, '吃什么？');
    if (idx < 0) return;

    const f = foods[idx], def = ITEMS[f.id];
    st.stats.foods++;

    if (def.portions && f.qty > 1) {
      const alloc = await P.foodDivide({
        name: def.name, icon: def.icon, portions: f.qty,
        staminaEach: def.stamina, sanityEach: def.help || 0,
        players: alive().map(x => ({ id: x.id, name: x.name }))
      });
      let total = 0;
      Object.entries(alloc).forEach(([pid, n]) => {
        const pl = st.players.find(x => x.id === pid);
        if (!pl || !n) return;
        total += n;
        pl.stamina = clamp(pl.stamina + Math.round(def.stamina * n / def.portions), 0, pl.maxStamina);
        if (def.help) pl.sanity = clamp(pl.sanity + Math.ceil(def.help * n / def.portions), 0, pl.maxSanity);
      });
      f.qty -= total;
      if (f.qty <= 0) st.inv = st.inv.filter(x => x !== f);
      log(`吃了 ${def.name} ${total} 份。`, 'good');
    } else {
      f.qty -= 1;
      p.stamina = clamp(p.stamina + def.stamina, 0, p.maxStamina);
      if (def.help) p.sanity = clamp(p.sanity + def.help, 0, p.maxSanity);
      if (def.poison && rnd() < def.poison) {
        addStatus(p, 'poisoned');
        P.append(`<div class="eresult no">${esc(def.name)}不对劲。你开始反胃。</div>`);
        log(`${p.name} 吃坏了肚子。`, 'bad');
      } else {
        P.append(`<div class="eresult ok">吃了 ${esc(def.name)}。体力 +${def.stamina}${def.help ? '，精神 +' + def.help : ''}</div>`);
        log(`吃了 ${def.name}。`, 'good');
      }
      if (f.qty <= 0) st.inv = st.inv.filter(x => x !== f);
    }
    checkDeaths();
  }

  async function useItemFlow(P) {
    const p = me();
    const usable = st.inv.filter(i => ITEMS[i.id] && ITEMS[i.id].use);
    if (!usable.length) { P.append(`<div class="eresult no">没有可用的物品。绷带和药都用完了。</div>`); return; }
    const opts = usable.map((u, i) => ({ label: `${ITEMS[u.id].name}（${u.qty}）`, desc: ITEMS[u.id].desc, value: i }));
    opts.push({ label: '不用了', desc: '', value: -1, light: true });
    const idx = await P.ask(opts, '用哪个？');
    if (idx < 0) return;

    const u = usable[idx], use = ITEMS[u.id].use;
    const bonus = p.charId === 'medic' ? 2 : 0;
    if (use.hp) heal(p, use.hp + bonus);
    if (use.cure) p.status = p.status.filter(s => s !== use.cure);
    removeItem(u.id, 1);
    P.append(`<div class="eresult ok">用了 ${esc(ITEMS[u.id].name)}。${use.hp ? `健康 +${use.hp + bonus}` : ''}${use.cure ? '，解除' + (use.cure === 'bleeding' ? '流血' : '中毒') : ''}</div>`);
    log(`使用了 ${ITEMS[u.id].name}。`, 'good');
    checkDeaths();
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

      if (st.preview) {
        const card = st.preview;
        st.preview = null;
        await resolveCard(card, P);
        FT.UI.render();
        if (st.over) { finish(); return; }
      }

      if (st.skipAction) {
        st.skipAction = false;
        log('本回合行动阶段被跳过。', 'warn');
        P.section('行动被跳过', `<div class="eflavor">你没能做成任何事。这一天被什么东西吃掉了。</div>`);
      } else {
        await actionPhase(P);
        FT.UI.render();
        if (st.over) { finish(); return; }
      }

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

      if (st.progress >= st.goal) {
        const next = st.phase + 1;
        if (next >= C.PROGRESS_GOALS.length) { st.over = true; st.victory = true; finish(); return; }
        enterPhase(next);
        alive().forEach(p => p.sanity = clamp(p.sanity + 2, 0, p.maxSanity));
        log(`进入新场景：${scene().name}，精神 +2。`, 'event');
        P.section(`第 ${st.phase + 1} 阶段 · ${scene().name}`,
          `<div class="eflavor">${esc(scene().tagline)}</div>
           <div class="mono">新的进度目标 ${st.goal} · 精神 +2 · 这里的敌人更硬了</div>`);
        FT.UI.render();
      }

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
      p.stamina = clamp(p.stamina - (isNight() ? C.TURN_STAMINA_NIGHT : C.TURN_STAMINA_DAY), 0, p.maxStamina);

      let sc = isNight() ? C.TURN_SANITY_NIGHT : C.TURN_SANITY_DAY;
      if (st.fire > 0 && isNight()) sc = 0;
      sc -= scene().sanityMod;
      p.sanity = clamp(p.sanity - Math.max(0, sc), 0, p.maxSanity);

      /* 饥饿只是减益；真正的掉血发生在体力彻底见底（力竭）时 */
      if (p.stamina <= C.HUNGRY_AT) {
        if (!p.status.includes('hungry')) { addStatus(p, 'hungry'); log(`${p.name} 饿得发抖。`, 'warn'); }
      } else {
        p.status = p.status.filter(s => s !== 'hungry');
      }
      if (p.stamina <= 0) damage(p, 1);
      if (p.status.includes('bleeding')) damage(p, 1);
      if (p.status.includes('collapse')) damage(p, 1);
      if (p.status.includes('poisoned')) {
        damage(p, 1);
        if (rnd() < 0.28) { p.status = p.status.filter(x => x !== 'poisoned'); log(`${p.name} 的毒性退了。`, 'good'); }
      }
      if (p.charId === 'apostle' && p.sanity >= 20) p.sanity = clamp(p.sanity - 1, 0, p.maxSanity);
      if (p.sanity <= C.MADNESS_AT && !p.status.includes('madness')) {
        addStatus(p, 'madness');
        const sym = FT.SYMPTOMS.find(s => s.id === p.symptom);
        log(`${p.name} 出现心理疾病：${sym ? sym.name : '未知'}。`, 'bad');
      }
      if (p.status.includes('dying')) {
        p.dyingTurns--;
        if (p.dyingTurns <= 0) { p.dead = true; st.stats.deaths++; log(`${p.name} 没有撑过去。`, 'bad'); }
      }
      if (!p.dead && p.status.includes('collapse')) {
        p.collapseTurns--;
        if (p.collapseTurns <= 0) {
          p.dead = true; st.stats.deaths++;
          log(`${p.name} 在自己看不见的地方结束了。`, 'bad');
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

    if (isNight() && st.fire > 0) alive().forEach(p => p.sanity = clamp(p.sanity + 1, 0, p.maxSanity));
    if (st.fire > 0) {
      st.fire--;
      if (st.fire === 0) log('篝火熄灭了。', 'warn');
    }
    checkDeaths();
    if (alive().length === 0) { st.over = true; st.victory = false; }
  }

  async function start() {
    if (!st || st.over) return;
    while (!st.over) { await runTurn(); if (st.over) break; }
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
    ['stick', 'stone', 'vine', 'cloth', 'herb', 'moss', 'raw_meat', 'flint'].forEach(id => addItem(id, 4));
    addItem('ration', 3, 70); addItem('water', 3, 20);
    FT.UI.render(); FT.UI.save();
  }
  function debugNextPhase() { st.progress = st.goal; }
  function debugElite() { FT.UI.toast('遭遇精英'); }

  FT.Engine = {
    get state() { return st; },
    get rngState() { return rngState; },
    newGame, start, runTurn, drawCard,
    checkMod, statName, applyFx, attackDmg, defense, hitMod, weaponOf, weaponName,
    addItem, removeItem, countItem, hasItem, slots, slotUsed,
    alive, isNight, scene, heal, damage,
    debugJump, debugRefill, debugMaterials, debugNextPhase,
    restore(state, rng) { st = state; rngState = rng; finished = false; },
    _internal: { d6, ri, rnd, pick, testCombat: (card, P) => combat(card, P) }
  };
})();
