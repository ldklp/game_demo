/* =====================================================================
 * ForestTable · 界面层 v1.1（单人 + 舞台步骤流）
 * ---------------------------------------------------------------------
 * 核心：FT.UI.stage() 返回一个"舞台面板"，引擎把本回合发生的事
 * 一段一段追加进去，玩家只在决策点点击底部的按钮。全程不弹窗。
 * 仅"调试"和"结局"仍用浮层。
 * ===================================================================== */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const ITEMS = FT.ITEMS;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /* ------------------------------------------------------------------
   * 基础
   * ------------------------------------------------------------------ */
  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    $('#toastLayer').appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 2000);
  }
  const itemName = id => ITEMS[id] ? ITEMS[id].name : id;
  const itemIcon = id => ITEMS[id] ? ITEMS[id].icon : '·';

  /* ------------------------------------------------------------------
   * 舞台面板
   * ------------------------------------------------------------------ */
  function stage() {
    const box = $('#stageBox');
    box.innerHTML = `<div class="stage">
      <div class="shead"><span data-left></span><span data-right></span></div>
      <div class="sbody" data-body></div>
      <div class="sfoot" data-foot></div>
    </div>`;
    const body = box.querySelector('[data-body]');
    const foot = box.querySelector('[data-foot]');
    const left = box.querySelector('[data-left]');
    const right = box.querySelector('[data-right]');

    const toBottom = () => { body.scrollTop = body.scrollHeight; };
    const clearFoot = () => { foot.innerHTML = ''; };

    const api = {
      head(l, r) { left.innerHTML = l || ''; right.innerHTML = r || ''; },
      section(label, html) {
        const d = document.createElement('div');
        d.className = 'sect';
        d.innerHTML = `<div class="slabel">${esc(label)}</div>${html}`;
        body.appendChild(d);
        toBottom();
        return d;
      },
      append(html) {
        const d = document.createElement('div');
        d.className = 'sect';
        d.innerHTML = html;
        body.appendChild(d);
        toBottom();
        return d;
      },
      ask(options, prompt) {
        return new Promise(resolve => {
          clearFoot();
          if (prompt) {
            const p = document.createElement('div');
            p.style.cssText = 'flex:1 0 100%;font-size:11.5px;color:#6f7c70;letter-spacing:.04em;margin-bottom:2px';
            p.textContent = prompt;
            foot.appendChild(p);
          }
          options.forEach(o => {
            const b = document.createElement('button');
            b.className = 'btn' + (o.light ? ' light' : '') + (o.disabled ? ' dis' : '');
            b.disabled = !!o.disabled;
            b.innerHTML = `<span class="bl">${esc(o.label)}</span>${o.desc ? `<span class="bd">${esc(o.desc)}</span>` : ''}`;
            b.addEventListener('click', () => {
              if (b.disabled) return;
              clearFoot();
              resolve(o.value);
            });
            foot.appendChild(b);
          });
          toBottom();
        });
      },
      next(label) {
        return new Promise(resolve => {
          clearFoot();
          const b = document.createElement('button');
          b.className = 'btn next';
          b.innerHTML = `<span class="bl">${esc(label || '下一步')}</span>`;
          b.addEventListener('click', () => { clearFoot(); resolve(true); });
          foot.appendChild(b);
          toBottom();
        });
      },
      /* d6 判定：全游戏唯一公式 1d6 + 修正 ≥ 难度 */
      async d6(o) {
        const wrap = document.createElement('div');
        wrap.className = 'rolline';
        const sg = o.mod >= 0 ? '+' + o.mod : String(o.mod);
        wrap.innerHTML = `<div class="die spin">?</div>
          <div class="rollmeta">${esc(o.label)}　1d6 ${sg} vs 难度 ${o.dc}</div>`;
        body.appendChild(wrap);
        toBottom();
        const die = wrap.querySelector('.die');
        const meta = wrap.querySelector('.rollmeta');
        for (let i = 0; i < 7; i++) {
          die.textContent = 1 + Math.floor(Math.random() * 6);
          await wait(36);
        }
        const n = FT.Engine._internal.d6();
        const total = n + o.mod;
        const ok = n === 1 ? false : total >= o.dc;   // 自然 1 必失败
        die.textContent = n;
        die.classList.remove('spin');
        die.classList.add(ok ? 'ok' : 'bad');
        const tag = n === 6 ? ' · <b class="crit">大成功</b>' : n === 1 ? ' · <b class="bad">大失败</b>' : '';
        meta.innerHTML = `${esc(o.label)}　<b>${n} ${sg} = ${total}</b> ${ok ? '≥' : '&lt;'} ${o.dc}
          · <span class="${ok ? 'good' : 'bad'}">${ok ? '成功' : '失败'}</span>${tag}`;
        await wait(240);
        return { roll: n, total, ok, crit: n === 6 ? 1 : n === 1 ? -1 : 0 };
      },

      /* 抢行动权：双方各投 1d6，抢到的人行动 */
      async versus(o) {
        const wrap = document.createElement('div');
        wrap.className = 'vrow';
        const side = (s, w) => `<div class="vside ${w ? 'win' : ''}">
            <div class="vname">${esc(s.name)}</div>
            <div class="vdie spin">?</div>
            <div class="vmod">${s.mod >= 0 ? '+' + s.mod : s.mod}${s.chain > 0 ? ` <i class="chain">连${s.chain}</i>` : ''}</div>
            <div class="vtotal">?</div>
          </div>`;
        wrap.innerHTML = `<div class="vlabel">${esc(o.label)}</div>
          <div class="vsides">${side(o.left, o.winner === 'left')}<div class="vsvs">VS</div>${side(o.right, o.winner === 'right')}</div>`;
        body.appendChild(wrap);
        toBottom();
        const dies = wrap.querySelectorAll('.vdie');
        const totals = wrap.querySelectorAll('.vtotal');
        for (let i = 0; i < 7; i++) {
          dies.forEach(d => d.textContent = 1 + Math.floor(Math.random() * 6));
          await wait(34);
        }
        [o.left, o.right].forEach((s, i) => {
          dies[i].textContent = s.roll;
          dies[i].classList.remove('spin');
          totals[i].textContent = s.total;
        });
        wrap.querySelector('.vside.win').classList.add('in');
        await wait(200);
        return o.winner === 'left';
      },

      foodDivide(ctx) {
        const wrap = document.createElement('div');
        wrap.className = 'foodbox';
        body.appendChild(wrap);
        toBottom();

        /* 单人：没有先后之争，只需要决定吃几份 */
        if (ctx.players.length === 1) {
          const p = ctx.players[0];
          return new Promise(resolve => {
            const draw = () => {
              wrap.innerHTML = `<div class="foodhead"><div class="ficon">${esc(ctx.icon || '🍲')}</div>
                <div><h4>${esc(ctx.name)}（${ctx.portions} 份）</h4>
                <div class="fsub">每份体力 +${Math.round(ctx.staminaEach / (ctx.portions / 10)) / 10 * 1}${ctx.sanityEach ? ' · 精神 +' + ctx.sanityEach : ''}
                · 剩下的会留在背包里继续坏</div></div></div>`;
            };
            draw();
            const opts = [1, 2, 3].filter(n => n <= ctx.portions).map(n => ({
              label: `吃 ${n} 份`,
              desc: `体力 +${Math.round(ctx.staminaEach * n / ctx.portions)}`,
              value: n
            }));
            opts.push({ label: '全吃掉', desc: `${ctx.portions} 份，一点不留`, value: ctx.portions });
            opts.push({ label: '不吃了', desc: '', value: 0, light: true });
            api.ask(opts, `${p.name}，吃多少？`).then(v => {
              wrap.innerHTML += `<div class="eresult ok" style="margin-top:10px">${v ? `吃了 ${v} 份。` : '你把锅放下了。'}</div>`;
              const alloc = {};
              alloc[p.id] = v;
              resolve(alloc);
            });
          });
        }

        /* 多人：原版骰子定序 + 依次取用 */
        const rolls = ctx.players.map(p => ({ ...p, r: 1 + Math.floor(Math.random() * 6) }));
        const order = rolls.slice().sort((a, b) => b.r - a.r);
        const alloc = {}; ctx.players.forEach(p => alloc[p.id] = 0);
        let left = ctx.portions, idx = 0;
        const seq = order.concat(order.slice().reverse());

        return new Promise(resolve => {
          const render = () => {
            const cur = seq[Math.min(idx, seq.length - 1)];
            wrap.innerHTML = `<div class="foodhead"><div class="ficon">${esc(ctx.icon || '🍲')}</div>
              <div><h4>${esc(ctx.name)}（${left} / ${ctx.portions} 份）</h4>
              <div class="fsub">最小单位 1/10 份 · 依次取用，每次 1~3 份</div></div></div>
              <div class="dicerow">${order.map(p => `<div class="dchip ${p.id === cur.id ? 'act' : ''}">
                <span class="dn">${esc(p.name)}</span><span class="dr">${p.r}</span>
                <span class="da">${alloc[p.id] || 0} 份</span></div>`).join('')}</div>`;
            const maxTake = Math.min(3, left);
            const opts = [1, 2, 3].map(n => ({ label: `取 ${n} 份`, desc: '', value: n, disabled: n > maxTake }));
            opts.push({ label: '不要', desc: '', value: 0, light: true });
            api.ask(opts, `轮到 ${cur.name} 取用`).then(n => {
              alloc[cur.id] += Math.min(n, left);
              left -= Math.min(n, left);
              idx++;
              if (left <= 0 || idx >= seq.length) {
                wrap.innerHTML += `<div class="eresult ok" style="margin-top:10px">分完了。</div>`;
                resolve(alloc);
              } else render();
            });
          };
          render();
        });
      }
    };
    return api;
  }

  /* ------------------------------------------------------------------
   * 渲染
   * ------------------------------------------------------------------ */
  function bar(v, max, cls) {
    const pct = Math.max(0, Math.min(100, v / max * 100));
    return `<div class="bar ${cls}"><i style="width:${pct}%"></i><span>${Math.round(v)}</span></div>`;
  }
  const ST_NAME = { hungry: '饥饿', dying: '濒死', bleeding: '流血', poisoned: '中毒', madness: '心理疾病' };

  function render() {
    const st = FT.Engine.state;
    if (!st) return;
    const sc = FT.SCENES[st.scene];
    const night = FT.Engine.isNight();

    /* 顶栏 */
    $('#topbar').innerHTML = `
      <div class="brandline"><b>ForestTable</b><span class="sep">/</span>
        <span>第 ${st.phase + 1} 阶段 · ${esc(sc.name)}</span></div>
      <div class="clock">
        <span class="daytag">第 ${st.day} 天</span>
        <span class="turnpips">${[1, 2, 3, 4, 5].map(i =>
          `<i class="${i === st.turn ? 'on' : ''} ${i > FT.CONFIG.DAY_TURNS ? 'night' : ''}"></i>`).join('')}</span>
        <span class="tod ${night ? 'night' : 'day'}">${night ? '夜晚' : '白天'}</span>
        ${st.fire > 0 ? `<span class="firetag">🔥 ${st.fire}</span>` : ''}
      </div>
      <div class="prog"><span>进度 ${st.progress}/${st.goal}</span>
        <div class="pbar"><i style="width:${Math.min(100, st.progress / st.goal * 100)}%"></i></div></div>
      <div class="tools">
        <button data-act="save">存档</button>
        <button data-act="export">导出</button>
        <button data-act="debug" title="调试">⚙</button>
      </div>`;

    /* 角色 */
    $('#playersCol').innerHTML = st.players.map(p => {
      const c = FT.CHARS.find(x => x.id === p.charId);
      const sts = p.status.map(s => `<span class="st ${s}">${ST_NAME[s] || s}</span>`).join('');
      return `<div class="pcard ${p.dead ? 'dead' : ''}">
        <div class="phead">
          <div class="portrait"><img src="assets/chars/${p.charId}.jpg" alt="" onerror="this.remove()">
            <span>${esc(p.name.slice(0, 1))}</span></div>
          <div><div class="pname">${esc(p.name)}</div>
            <div class="ptag">${esc(c ? c.name : '')} · ${esc(c ? c.tag : '')}</div></div>
        </div>
        <div class="attrs">
          <div class="arow"><label>健康</label>${bar(p.hp, p.maxHp, 'hp')}</div>
          <div class="arow"><label>体力</label>${bar(p.stamina, p.maxStamina, 'st')}</div>
          <div class="arow"><label>精神</label>${bar(p.sanity, p.maxSanity, 'sa')}</div>
          <div class="arow dmgrow"><label>伤害</label>
            <span class="dmgbig">${FT.Engine.attackDmg(p)}</span>
            <span class="dmgsub">基础 ${p.dmg} · ${esc(FT.Engine.weaponName(p))}${p.boost ? ` · 蓄力 +${p.boost}` : ''}</span></div>
        </div>
        <div class="cstats">
          <span>防御 <b>${FT.Engine.defense(p)}</b></span>
          <span>命中 <b>${FT.Engine.hitMod(p) >= 0 ? '+' + FT.Engine.hitMod(p) : FT.Engine.hitMod(p)}</b></span>
          <span>骰 d6</span>
        </div>
        <div class="sts">${sts || '<span class="st none">状态良好</span>'}</div>
        <div class="passive">${esc(c ? c.passive : '')}</div>
      </div>`;
    }).join('');

    /* 场景 */
    $('#sceneBox').innerHTML = `
      <div class="scene" style="--c1:${sc.palette[0]};--c2:${sc.palette[1]}">
        <img class="sceneimg" src="assets/scenes/${st.scene}.jpg" alt="" onerror="this.remove()">
        <div class="sceneinfo">
          <div class="sname">${esc(sc.name)}</div>
          <div class="stag">${esc(sc.tagline)}</div>
          <div class="senv">
            <span>遇敌率 ${Math.round(sc.enemyRate * 100)}%</span>
            <span>精神修正 ${sc.sanityMod > 0 ? '+' : ''}${sc.sanityMod}</span>
            <span>判定修正 ${sc.checkMod > 0 ? '+' : ''}${sc.checkMod}</span>
          </div>
        </div>
      </div>`;

    /* 背包 */
    const used = FT.Engine.slotUsed(), cap = FT.Engine.slots();
    $('#invPanel').innerHTML = `
      <div class="ph">背包 <span class="${used > cap ? 'bad' : ''}">${used}/${cap} 格</span></div>
      <div class="invlist">${st.inv.length ? st.inv.map(i => {
        const d = ITEMS[i.id];
        if (!d) return '';
        const exp = i.expire !== undefined ? `<span class="exp ${i.expire <= 3 ? 'soon' : ''}">${i.expire}</span>` : '';
        return `<div class="invitem"><span class="ii">${d.icon}</span>
          <span class="in">${esc(d.name)}</span><span class="iq">×${i.qty}</span>${exp}</div>`;
      }).join('') : '<div class="empty">空的</div>'}</div>`;

    /* 预告 */
    const pv = st.preview;
    $('#previewBox').innerHTML = pv ? `<div class="pvcard">
        <div class="pvlabel">下回合预告 · ${night ? '夜' : '昼'}转${night ? '昼' : '夜'}</div>
        <div class="pvtitle">${esc(pv.title)}</div>
        <div class="pvtype">${{ encounter: '遭遇', mystery: '神秘', hazard: '意外', skip: '强制' }[pv.type] || ''}</div>
        <div class="pvtext">${esc(pv.text)}</div>
        ${pv.type === 'encounter' && pv.ambush ? '<div class="ambushtag">突袭 · 立即结算</div>' : ''}
      </div>` : `<div class="pvcard"><div class="pvlabel">下回合预告</div><div class="pvtext">——</div></div>`;

    /* 记录 */
    $('#logPanel').innerHTML = `<div class="ph">记录</div><div class="loglist" id="loglist">` +
      st.log.slice(-80).map(l => `<div class="logline ${l.kind}"><span class="lt">${esc(l.t)}</span>${esc(l.text)}</div>`).join('') +
      '</div>';
    const ll = $('#loglist');
    if (ll) ll.scrollTop = ll.scrollHeight;
  }

  /* ------------------------------------------------------------------
   * 存档
   * ------------------------------------------------------------------ */
  function save() {
    if (!FT.Engine.state) return false;
    try {
      localStorage.setItem(FT.CONFIG.SAVE_KEY, JSON.stringify({
        v: FT.CONFIG.VERSION, state: FT.Engine.state, rng: FT.Engine.rngState
      }));
      return true;
    } catch (e) { return false; }
  }
  function load() {
    try {
      const raw = localStorage.getItem(FT.CONFIG.SAVE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return (o && o.state) ? o : null;
    } catch (e) { return null; }
  }
  function clearSave() { try { localStorage.removeItem(FT.CONFIG.SAVE_KEY); } catch (e) { } }

  /* ------------------------------------------------------------------
   * 结局 / 调试（仅这两个用浮层）
   * ------------------------------------------------------------------ */
  function overlay(html, cls) {
    const layer = $('#modalLayer');
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${cls || ''}">${html}</div>`;
    layer.appendChild(back);
    requestAnimationFrame(() => back.classList.add('in'));
    return back;
  }

  function gameOver(victory, st) {
    const back = overlay(`
      <div class="overtag" style="color:${victory ? 'var(--accent)' : 'var(--danger)'}">
        ${victory ? '你 走 出 去 了' : '森 林 留 下 了 你'}</div>
      <div class="mbody">
        <p class="eflavor">${victory
          ? '雾散了。湖对岸那道灰白的线，原来是一条公路。你站在路边，没有回头。'
          : '最后一个声音也停了。森林把它该收的都收走了。'}</p>
        <div class="sumgrid" style="margin-top:14px">
          <div class="sumrow"><span class="sn">存活天数</span><span class="sv">${st.day}</span></div>
          <div class="sumrow"><span class="sn">经历回合</span><span class="sv">${st.stats.turns}</span></div>
          <div class="sumrow"><span class="sn">遭遇事件</span><span class="sv">${st.stats.events}</span></div>
          <div class="sumrow"><span class="sn">战斗 / 精英</span><span class="sv">${st.stats.fights} / ${st.stats.elites}</span></div>
          <div class="sumrow"><span class="sn">暴击次数</span><span class="sv">${st.stats.crits}</span></div>
          <div class="sumrow"><span class="sn">最长连击</span><span class="sv">${st.stats.maxChain}</span></div>
          <div class="sumrow"><span class="sn">进食次数</span><span class="sv">${st.stats.foods}</span></div>
          <div class="sumrow"><span class="sn">抵达阶段</span><span class="sv">${st.phase + 1} / 4</span></div>
        </div>
      </div>
      <div class="mfoot"><button class="primary" id="againBtn">再来一局</button></div>`, 'over ' + (victory ? 'win' : 'lose'));
    back.querySelector('#againBtn').addEventListener('click', () => location.reload());
  }

  function debugPanel() {
    const back = overlay(`
      <h3>调试 / 演示</h3>
      <div class="mbody">
        <div class="prompt">给美术看场景、给测试跳过流程用。</div>
        <div class="dbgsec"><div class="dbgh">跳到场景</div><div class="dbgrow">
          ${Object.entries(FT.SCENES).map(([k, v]) => `<button data-jump="${k}">${esc(v.name)}</button>`).join('')}
        </div></div>
        <div class="dbgsec"><div class="dbgh">资源</div><div class="dbgrow">
          <button data-dbg="refill">回满状态</button>
          <button data-dbg="mats">给材料</button>
          <button data-dbg="phase">直达下一阶段</button>
        </div></div>
      </div>
      <div class="mfoot"><button class="ghost" data-close>关闭</button></div>`, 'wide');
    back.addEventListener('click', e => {
      const j = e.target.closest('[data-jump]');
      const d = e.target.closest('[data-dbg]');
      if (j) { FT.Engine.debugJump(j.dataset.jump); back.remove(); }
      else if (d) {
        if (d.dataset.dbg === 'refill') FT.Engine.debugRefill();
        if (d.dataset.dbg === 'mats') FT.Engine.debugMaterials();
        if (d.dataset.dbg === 'phase') FT.Engine.debugNextPhase();
      } else if (e.target.closest('[data-close]')) back.remove();
    });
  }

  /* ------------------------------------------------------------------
   * 初始化
   * ------------------------------------------------------------------ */
  let selectedChar = null;

  function init() {
    /* 角色卡 */
    const roster = $('#roster');
    roster.innerHTML = FT.CHARS.map(c => `
      <button class="charcard" data-char="${c.id}">
        <div class="cc-name">${esc(c.name)}</div>
        <div class="cc-tag">${esc(c.tag)}</div>
        <div class="cc-attrs"><span>健康 ${c.hp}</span><span>体力 ${c.stamina}</span><span>精神 ${c.sanity}</span><span class="dm">伤害 ${c.dmg}</span></div>
        <div class="cc-pass">${esc(c.passive)}</div>
      </button>`).join('');
    const cards = $$('#roster .charcard');
    const select = id => {
      selectedChar = id;
      cards.forEach(b => b.classList.toggle('on', b.dataset.char === id));
    };
    cards.forEach(b => b.addEventListener('click', () => select(b.dataset.char)));
    select(FT.CHARS[0].id);

    /* 继续存档 */
    const saved = load();
    const cBtn = $('#continueBtn');
    if (saved) {
      cBtn.classList.remove('hidden');
      cBtn.addEventListener('click', () => {
        FT.Engine.restore(saved.state, saved.rng);
        $('#screenTitle').classList.add('hidden');
        $('#screenGame').classList.remove('hidden');
        render();
        toast('已读取存档');
        setTimeout(() => FT.Engine.start(), 250);
      });
    }

    /* 开始 */
    $('#startBtn').addEventListener('click', () => {
      const name = ($('#playerName').value || '').trim() || '旅人';
      FT.Engine.newGame([{ name, charId: selectedChar }]);
      clearSave(); save();
      $('#screenTitle').classList.add('hidden');
      $('#screenGame').classList.remove('hidden');
      render();
      setTimeout(() => FT.Engine.start(), 250);
    });

    /* 顶栏工具 */
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'save') {
        const ok = save();
        toast(ok ? '已存档' : '此浏览器不允许本地存档，请用「导出」', ok ? '' : 'bad');
      }
      if (b.dataset.act === 'export') {
        const data = JSON.stringify({ state: FT.Engine.state, rng: FT.Engine.rngState });
        const blob = new Blob([data], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `foresttable_${Date.now()}.json`;
        a.click();
      }
      if (b.dataset.act === 'debug') debugPanel();
    });

    /* 回车 = 点第一个可用按钮，方便快速推进 */
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const foot = $('#stageBox .sfoot');
      if (!foot) return;
      const btn = foot.querySelector('button.btn:not(:disabled)');
      if (btn) { e.preventDefault(); btn.click(); }
    });
  }

  FT.UI = {
    init, render, stage, toast, save, load, clearSave, gameOver, debugPanel
  };
})();
