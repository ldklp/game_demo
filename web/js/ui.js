/* =====================================================================
 * ForestTable · 界面层
 * ---------------------------------------------------------------------
 * 所有 FT.Engine 需要的交互都以 Promise 形式暴露在这里。
 * 美术替换点见 css/style.css 顶部的 :root 变量与 assets/ 目录约定。
 * ===================================================================== */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const ITEMS = FT.ITEMS;

  let saveBroken = false;

  /* ------------------------------------------------------------------
   * 基础工具
   * ------------------------------------------------------------------ */
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function itemName(id) { return ITEMS[id] ? ITEMS[id].name : id; }
  function itemIcon(id) { return ITEMS[id] ? ITEMS[id].icon : '·'; }

  function toast(msg, kind) {
    const t = el('div', 'toast ' + (kind || ''), esc(msg));
    $('#toastLayer').appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 2200);
  }

  function flash(text) {
    return new Promise(res => {
      const f = el('div', 'flash', esc(text));
      $('#toastLayer').appendChild(f);
      requestAnimationFrame(() => f.classList.add('in'));
      setTimeout(() => {
        f.classList.remove('in');
        setTimeout(() => { f.remove(); res(); }, 400);
      }, 900);
    });
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ------------------------------------------------------------------
   * 通用模态框
   * ------------------------------------------------------------------ */
  function openModal(spec) {
    return new Promise(resolve => {
      const layer = $('#modalLayer');
      const back = el('div', 'modal-back');
      const card = el('div', 'modal' + (spec.wide ? ' wide' : '') + (spec.cls ? ' ' + spec.cls : ''));

      let html = '';
      if (spec.who) html += `<div class="who">${esc(spec.who)} 正在表决</div>`;
      if (spec.badge) html += `<div class="badge">${esc(spec.badge)}</div>`;
      if (spec.title) html += `<h3>${esc(spec.title)}</h3>`;
      if (spec.body) html += `<div class="mbody">${spec.body}</div>`;

      if (spec.options && spec.options.length) {
        html += '<div class="opts">' + spec.options.map((o, i) => `
          <button class="opt ${o.cls || ''}" data-v="${i}">
            <span class="olabel">${esc(o.label)}</span>
            ${o.desc ? `<span class="odesc">${esc(o.desc)}</span>` : ''}
          </button>`).join('') + '</div>';
      }
      if (spec.footer) html += `<div class="mfoot">${spec.footer}</div>`;

      card.innerHTML = html;
      back.appendChild(card);
      layer.appendChild(back);
      requestAnimationFrame(() => back.classList.add('in'));

      function close(v) {
        back.classList.remove('in');
        setTimeout(() => { back.remove(); resolve(v); }, 180);
      }
      card.addEventListener('click', e => {
        const b = e.target.closest('button[data-v]');
        if (b) {
          $$('button', card).forEach(x => x.disabled = true);
          close(spec.options[+b.dataset.v].value);
        }
        const f = e.target.closest('button[data-foot]');
        if (f) {
          if (f.dataset.foot === 'skip' && spec.onSkip) { close(spec.onSkip()); return; }
          if (f.dataset.foot === 'continue') { close(true); }
        }
      });
    });
  }

  /* ------------------------------------------------------------------
   * 文字/选择/判定
   * ------------------------------------------------------------------ */
  function say(o) {
    return openModal({
      title: o.title, body: o.body,
      cls: (o.tone || '') + (o.compact ? ' compact' : '') + (o.phaseChange ? ' phase' : ''),
      options: [{ label: '继续', desc: '', value: true, cls: 'primary' }]
    });
  }

  function choose(o) {
    return openModal({ title: o.title, body: o.body, options: o.options, wide: o.wide });
  }

  async function rollDialog(o) {
    return new Promise(resolve => {
      const layer = $('#modalLayer');
      const back = el('div', 'modal-back');
      const card = el('div', 'modal roll');
      card.innerHTML = `
        <h3>${esc(o.title)}</h3>
        <div class="mbody">
          <div class="rollbox">
            <div class="die" id="dieFace">?</div>
            <div class="rollmeta">
              <div>${esc(o.who)} · ${esc(o.stat)}判定</div>
              <div class="mono">d20 ${o.mod >= 0 ? '+' + o.mod : o.mod} vs 难度 ${o.dc}</div>
            </div>
          </div>
          <div class="rollresult" id="rollRes"></div>
        </div>
        <div class="opts"><button class="opt primary" id="rollBtn">投掷</button></div>`;
      back.appendChild(card);
      layer.appendChild(back);
      requestAnimationFrame(() => back.classList.add('in'));

      const die = card.querySelector('#dieFace');
      const res = card.querySelector('#rollRes');
      const btn = card.querySelector('#rollBtn');
      let done = false;

      btn.addEventListener('click', async () => {
        if (done) return;
        done = true;
        btn.disabled = true;
        let n = 0;
        const ticks = 10;
        for (let i = 0; i < ticks; i++) {
          die.textContent = 1 + Math.floor(Math.random() * 20);
          die.classList.add('spin');
          await wait(45);
        }
        die.classList.remove('spin');
        n = FT.Engine._internal.roll(20);
        const total = n + o.mod;
        const ok = total >= o.dc;
        die.textContent = n;
        die.classList.add(ok ? 'ok' : 'bad');
        const crit = n === 20 ? ' 大成功！' : n === 1 ? ' 大失败！' : '';
        res.innerHTML = `<div class="${ok ? 'good' : 'bad'}">${n} ${o.mod >= 0 ? '+' + o.mod : o.mod} = <b>${total}</b> ${ok ? '≥' : '&lt;'} ${o.dc} · ${ok ? '成功' : '失败'}${crit}</div>`;
        await wait(500);
        back.classList.remove('in');
        setTimeout(() => { back.remove(); resolve({ roll: n, total, ok, raw: n }); }, 180);
      });
    });
  }

  function dice(o) {
    return new Promise(resolve => {
      const layer = $('#modalLayer');
      const back = el('div', 'modal-back die-back');
      const box = el('div', 'diebox');
      box.innerHTML = `<div class="dl">${esc(o.label || '掷骰')}</div><div class="die small" id="d2">?</div>`;
      back.appendChild(box);
      layer.appendChild(back);
      requestAnimationFrame(() => back.classList.add('in'));
      const d = box.querySelector('#d2');
      let i = 0;
      const iv = setInterval(() => {
        d.textContent = 1 + Math.floor(Math.random() * 6);
        if (++i > 5) {
          clearInterval(iv);
          setTimeout(() => {
            back.classList.remove('in');
            setTimeout(() => { back.remove(); resolve(1); }, 120);
          }, 120);
        }
      }, 55);
    });
  }

  /* ------------------------------------------------------------------
   * 依次投票（热座）
   * ------------------------------------------------------------------ */
  async function vote(o) {
    const players = FT.Engine.alive();
    const votes = {};
    let skipAll = false;

    for (const p of players) {
      if (skipAll) { votes[p.id] = o.options[Math.floor(Math.random() * o.options.length)].value; continue; }
      const v = await openModal({
        who: p.name,
        title: o.title,
        body: o.body + `<div class="prompt">${esc(o.prompt || '')}</div>`,
        options: o.options,
        wide: o.wide,
        footer: `<button class="ghost" data-foot="skip">跳过投票（剩余随机）</button>`,
        onSkip: () => { skipAll = true; return null; }
      });
      if (v === null || v === undefined) { // 跳过
        votes[p.id] = o.options[Math.floor(Math.random() * o.options.length)].value;
      } else {
        votes[p.id] = v;
      }
    }

    // 计票
    const count = {};
    o.options.forEach(op => count[op.value] = 0);
    Object.values(votes).forEach(v => { if (count[v] !== undefined) count[v]++; });
    const max = Math.max(...Object.values(count));
    const winners = Object.keys(count).filter(k => count[k] === max);
    const tie = winners.length > 1;

    const tallyHtml = o.options.map(op => {
      const n = count[op.value];
      const whoVoted = players.filter(p => votes[p.id] === op.value).map(p => p.name).join('、') || '—';
      return `<div class="tallyrow ${n === max && !tie ? 'win' : ''}">
        <div class="tl">${esc(op.label)}</div>
        <div class="tb"><i style="width:${(n / players.length) * 100}%"></i></div>
        <div class="tn">${n}</div>
        <div class="tw">${esc(whoVoted)}</div>
      </div>`;
    }).join('');

    await openModal({
      title: tie ? '平票' : '表决结果',
      body: `<div class="tally">${tallyHtml}</div>` +
        (tie ? `<div class="prompt bad">${esc(o.timeoutText || '平票 → 本回合强制休整（不回复体力）')}</div>` : ''),
      options: [{ label: '确认', value: true, cls: 'primary' }]
    });

    return tie ? 'tie' : (isNaN(Number(winners[0])) ? winners[0] : Number(winners[0]));
  }

  /* ------------------------------------------------------------------
   * 分食物
   * ------------------------------------------------------------------ */
  function foodDivide(ctx) {
    return new Promise(resolve => {
      const layer = $('#modalLayer');
      const back = el('div', 'modal-back');
      const card = el('div', 'modal wide food');
      back.appendChild(card);
      layer.appendChild(back);
      requestAnimationFrame(() => back.classList.add('in'));

      const players = ctx.players.slice();
      const rolls = players.map(p => ({ ...p, r: 1 + Math.floor(Math.random() * 6) }));
      const order = rolls.slice().sort((a, b) => b.r - a.r || a.name.localeCompare(b.name));
      const alloc = {}; players.forEach(p => alloc[p.id] = 0);
      let left = ctx.portions;
      let idx = 0;
      let pass = 0;
      const seq = order.concat(order.slice().reverse()); // 第一轮顺序取，第二轮反向补

      function render() {
        const cur = seq[idx];
        const maxTake = Math.min(3, left);
        card.innerHTML = `
          <div class="foodhead">
            <div class="ficon">${esc(ctx.icon || '🍲')}</div>
            <div>
              <h3>${esc(ctx.name)}（${left} / ${ctx.portions} 份）</h3>
              <div class="prompt">最小单位 1/10 份 · 依次取用，每次 1~3 份</div>
            </div>
          </div>
          <div class="dicerow">
            ${order.map(p => `<div class="dchip ${p.id === cur.id ? 'act' : ''}">
              <span class="dn">${esc(p.name)}</span><span class="dr">${p.r}</span>
              <span class="da">${alloc[p.id] || 0} 份</span>
            </div>`).join('')}
          </div>
          <div class="foodbody">
            <div class="curturn">轮到 <b>${esc(cur.name)}</b> 取用${left > 0 ? '' : '（已取完）'}</div>
            <div class="opts inline">
              ${[1, 2, 3].map(n => `<button class="opt ${n > maxTake ? 'dis' : ''}" data-take="${n}" ${n > maxTake ? 'disabled' : ''}>取 ${n} 份</button>`).join('')}
              <button class="opt ghost" data-take="0">不要</button>
            </div>
          </div>`;
      }

      card.addEventListener('click', e => {
        const b = e.target.closest('button[data-take]');
        if (!b || b.disabled) return;
        const n = Math.min(Number(b.dataset.take), left);
        const cur = seq[idx];
        alloc[cur.id] += n;
        left -= n;
        idx++;
        if (left <= 0 || idx >= seq.length) {
          // 结束
          const summary = players.map(p => `<div class="tallyrow"><div class="tl">${esc(p.name)}</div><div class="tn">${alloc[p.id]}</div><div class="tw">+${Math.round(ctx.staminaEach * alloc[p.id] / ctx.portions)} 体力</div></div>`).join('');
          card.innerHTML = `<h3>分食完毕</h3><div class="mbody"><div class="tally">${summary}</div></div>
            <div class="mfoot"><button class="primary" data-done>好</button></div>`;
          card.querySelector('[data-done]').addEventListener('click', () => {
            back.classList.remove('in');
            setTimeout(() => { back.remove(); resolve(alloc); }, 180);
          });
          return;
        }
        render();
      });

      render();
    });
  }

  /* ------------------------------------------------------------------
   * 合成菜单
   * ------------------------------------------------------------------ */
  function craftMenu(ids) {
    return new Promise(resolve => {
      const layer = $('#modalLayer');
      const back = el('div', 'modal-back');
      const card = el('div', 'modal wide craftmodal');
      const st = FT.Engine.state;
      const rows = FT.RECIPES.map(r => {
        const ok = ids.includes(r.id);
        const req = Object.entries(r.req).map(([id, q]) => {
          const have = FT.Engine.countItem(id);
          return `<span class="${have >= q ? 'okc' : 'badc'}">${itemName(id)} ${have}/${q}</span>`;
        }).join(' · ');
        let why = '';
        if (!ok) why = (r.needFire && st.fire <= 0) ? '需要篝火' : '材料不足';
        return `<button class="recipe ${ok ? '' : 'dis'}" ${ok ? '' : 'disabled'} data-r="${r.id}">
          <span class="rname">${esc(r.name)}${r.cook ? ' <i class="cooktag">烹饪</i>' : ''}</span>
          <span class="rreq">${req}${why ? ` <b class="badc">（${why}）</b>` : ''}</span>
          <span class="rdesc">${esc(r.desc)}</span>
        </button>`;
      }).join('');
      card.innerHTML = `<h3>合成 / 烹饪</h3>
        <div class="mbody">
          <div class="prompt">本回合只能做一件。材料从全队背包取用。${st.fire > 0 ? '<b class="good">篝火燃烧中（剩 ' + st.fire + ' 回合）</b>' : '没有篝火。'}</div>
          <div class="recipes">${rows}</div>
        </div>
        <div class="mfoot"><button class="ghost" data-skip>放弃合成</button></div>`;
      back.appendChild(card);
      layer.appendChild(back);
      requestAnimationFrame(() => back.classList.add('in'));
      card.addEventListener('click', e => {
        const b = e.target.closest('button[data-r]');
        const s = e.target.closest('button[data-skip]');
        const done = v => {
          back.classList.remove('in');
          setTimeout(() => { back.remove(); resolve(v); }, 180);
        };
        if (b && !b.disabled) done(b.dataset.r);
        else if (s) done(null);
      });
    });
  }

  /* ------------------------------------------------------------------
   * 休整附加菜单
   * ------------------------------------------------------------------ */
  function restMenu() {
    return openModal({
      title: '休整',
      body: '<div class="prompt">体力已经回复。还要做点什么吗？</div>',
      options: [
        { label: '吃东西', desc: '从背包里选一样食物（可分食）', value: 'eat' },
        { label: '使用物品', desc: '绷带、药——用来救人', value: 'use' },
        { label: '就这样', desc: '什么都不做', value: 'none', cls: 'ghost' }
      ]
    });
  }

  /* ------------------------------------------------------------------
   * 事件牌展示
   * ------------------------------------------------------------------ */
  function eventModal(card) {
    const deckName = card.deck === 'night' ? '夜晚事件' : '白天事件';
    const typeName = { encounter: '遭遇敌人', mystery: '神秘事件', hazard: '意外', skip: '强制' }[card.type] || '事件';
    const artPath = `assets/cards/${card.id}.jpg`;
    return openModal({
      title: card.title,
      badge: `${deckName} · ${typeName}`,
      cls: 'eventcard',
      body: `<div class="cardart" data-art="card:${card.id}">
               <img src="${artPath}" alt="" onerror="this.remove()">
               <span class="artph">${esc(typeName)}</span>
             </div>
             <p class="flavor">${esc(card.text)}</p>`,
      options: [{ label: '应对', value: true, cls: 'primary' }],
      wide: true
    });
  }

  /* ------------------------------------------------------------------
   * 渲染
   * ------------------------------------------------------------------ */
  function bar(v, max, cls) {
    const pct = Math.max(0, Math.min(100, v / max * 100));
    return `<div class="bar ${cls}"><i style="width:${pct}%"></i><span>${Math.round(v)}</span></div>`;
  }

  function render() {
    const st = FT.Engine.state;
    if (!st) return;
    const sc = FT.SCENES[st.scene];
    const night = FT.Engine.isNight();

    /* 顶部 */
    const tb = $('#topbar');
    tb.innerHTML = `
      <div class="brandline">
        <b>ForestTable</b>
        <span class="sep">/</span>
        <span>第 ${st.phase + 1} 阶段 · ${esc(sc.name)}</span>
      </div>
      <div class="clock">
        <span class="daytag">第 ${st.day} 天</span>
        <span class="turnpips">${[1, 2, 3, 4, 5].map(i => `<i class="${i === st.turn ? 'on' : ''} ${i > FT.CONFIG.DAY_TURNS ? 'night' : ''}"></i>`).join('')}</span>
        <span class="tod ${night ? 'night' : 'day'}">${night ? '夜晚' : '白天'}</span>
        ${st.fire > 0 ? `<span class="firetag">🔥 ${st.fire}</span>` : ''}
      </div>
      <div class="prog">
        <span>进度 ${st.progress}/${st.goal}</span>
        <div class="pbar"><i style="width:${Math.min(100, st.progress / st.goal * 100)}%"></i></div>
      </div>
      <div class="tools">
        <button data-act="save" title="保存">存档</button>
        <button data-act="export" title="导出存档">导出</button>
        <button data-act="debug" title="调试">⚙</button>
      </div>`;

    /* 玩家 */
    $('#playersCol').innerHTML = st.players.map(p => {
      const c = FT.CHARS.find(x => x.id === p.charId);
      const sym = p.symptom ? FT.SYMPTOMS.find(s => s.id === p.symptom) : null;
      const sts = p.status.filter(s => s !== 'hungry' || p.stamina <= p.maxStamina * 0.25)
        .map(s => `<span class="st ${s}">${{ hungry: '饥饿', dying: '濒死', bleeding: '流血', poisoned: '中毒', madness: '心理疾病' }[s] || s}</span>`).join('');
      return `<div class="pcard ${p.dead ? 'dead' : ''}" data-art="char:${p.charId}">
        <div class="phead">
          <div class="portrait"><img src="assets/chars/${p.charId}.jpg" alt="" onerror="this.remove()"><span>${esc(p.name.slice(0, 1))}</span></div>
          <div>
            <div class="pname">${esc(p.name)}</div>
            <div class="ptag">${esc(c ? c.name : '')} · ${esc(c ? c.tag : '')}</div>
          </div>
        </div>
        <div class="attrs">
          <div class="arow"><label>健康</label>${bar(p.hp, p.maxHp, 'hp')}</div>
          <div class="arow"><label>体力</label>${bar(p.stamina, p.maxStamina, 'st')}</div>
          <div class="arow"><label>精神</label>${bar(p.sanity, p.maxSanity, 'sa')}</div>
        </div>
        <div class="sts">${sts || '<span class="st none">状态良好</span>'}</div>
        ${p.dead ? '<div class="deadmask">已故</div>' : ''}
      </div>`;
    }).join('');

    /* 场景 + 预告 */
    const pv = st.preview;
    $('#centerCol').innerHTML = `
      <div class="scene" data-art="scene:${st.scene}" style="--c1:${sc.palette[0]};--c2:${sc.palette[1]}">
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
      </div>
      <div class="preview">
        <div class="pvlabel">下回合预告 · ${night ? '夜' : '昼'}</div>
        <div class="pvcard ${pv ? '' : 'empty'}">
          ${pv ? `<div class="pvtitle">${esc(pv.title)}</div>
                 <div class="pvtype">${{ encounter: '遭遇', mystery: '神秘', hazard: '意外', skip: '强制' }[pv.type]}</div>
                 <div class="pvtext">${esc(pv.text)}</div>
                 ${pv.type === 'encounter' && pv.ambush ? '<div class="ambushtag">突袭 · 立即结算</div>' : ''}` :
          '<div class="pvtext">——</div>'}
        </div>
      </div>`;

    /* 背包 */
    const used = FT.Engine.slotUsed(), cap = FT.Engine.slots();
    $('#invPanel').innerHTML = `
      <div class="ph">队伍背包 <span class="${used > cap ? 'bad' : ''}">${used}/${cap} 格</span></div>
      <div class="invlist">
        ${st.inv.length ? st.inv.map((i, k) => {
          const d = ITEMS[i.id];
          if (!d) return '';
          const exp = i.expire !== undefined ? `<span class="exp ${i.expire <= 3 ? 'soon' : ''}">${i.expire}</span>` : '';
          return `<div class="invitem"><span class="ii">${d.icon}</span>
            <span class="in">${esc(d.name)}</span>
            <span class="iq">×${i.qty}</span>${exp}</div>`;
        }).join('') : '<div class="empty">空的</div>'}
      </div>`;

    /* 日志 */
    const logEl = $('#logPanel');
    logEl.innerHTML = `<div class="ph">记录</div><div class="loglist" id="loglist">` +
      st.log.slice(-60).map(l => `<div class="logline ${l.kind}"><span class="lt">${esc(l.t)}</span>${esc(l.text)}</div>`).join('') +
      '</div>';
    const ll = $('#loglist');
    if (ll) ll.scrollTop = ll.scrollHeight;
  }

  /* ------------------------------------------------------------------
   * 回合结束小结
   * ------------------------------------------------------------------ */
  function endTurnSummary(previewText, day, turn) {
    const st = FT.Engine.state;
    const d = day || st.day, t = turn || st.turn;
    return openModal({
      title: `第 ${d} 天 · 第 ${t} 回合结束`,
      cls: 'summary',
      body: `<div class="sumgrid">
        ${st.players.map(p => `<div class="sumrow ${p.dead ? 'dead' : ''}">
          <span class="sn">${esc(p.name)}</span>
          <span class="sv">健康 ${Math.round(p.hp)}</span>
          <span class="sv">体力 ${Math.round(p.stamina)}</span>
          <span class="sv">精神 ${Math.round(p.sanity)}</span>
        </div>`).join('')}
      </div>
      <div class="prompt">下回合预告：<b>${esc(previewText)}</b></div>`,
      options: [{ label: '进入下一回合', value: true, cls: 'primary' }]
    });
  }

  /* ------------------------------------------------------------------
   * 结局
   * ------------------------------------------------------------------ */
  function gameOver(victory, st) {
    const layer = $('#modalLayer');
    const back = el('div', 'modal-back');
    const card = el('div', 'modal wide over ' + (victory ? 'win' : 'lose'));
    card.innerHTML = `
      <div class="overtag">${victory ? '你 们 走 出 去 了' : '森 林 留 下 了 你 们'}</div>
      <div class="mbody">
        <p class="flavor">${victory
          ? '雾散了。湖对岸那道灰白的线，原来是一条公路。你们站在路边，谁也没有回头看一眼。'
          : '最后一个声音也停了。森林把它该收的都收走了。'}</p>
        <div class="sumgrid">
          <div class="sumrow"><span class="sn">存活天数</span><span class="sv">${st.day}</span></div>
          <div class="sumrow"><span class="sn">经历回合</span><span class="sv">${st.stats.turns}</span></div>
          <div class="sumrow"><span class="sn">遭遇事件</span><span class="sv">${st.stats.events}</span></div>
          <div class="sumrow"><span class="sn">死亡人数</span><span class="sv">${st.stats.deaths}</span></div>
          <div class="sumrow"><span class="sn">进食次数</span><span class="sv">${st.stats.foods}</span></div>
          <div class="sumrow"><span class="sn">抵达阶段</span><span class="sv">${st.phase + 1} / 4</span></div>
        </div>
      </div>
      <div class="mfoot"><button class="primary" id="againBtn">再来一局</button></div>`;
    back.appendChild(card);
    layer.appendChild(back);
    requestAnimationFrame(() => back.classList.add('in'));
    card.querySelector('#againBtn').addEventListener('click', () => location.reload());
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
    } catch (e) { saveBroken = true; return false; }
  }
  function load() {
    try {
      const raw = localStorage.getItem(FT.CONFIG.SAVE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.state) return null;
      return o;
    } catch (e) { return null; }
  }
  function clearSave() {
    try { localStorage.removeItem(FT.CONFIG.SAVE_KEY); } catch (e) { }
  }

  /* ------------------------------------------------------------------
   * 调试面板
   * ------------------------------------------------------------------ */
  function debugPanel() {
    const layer = $('#modalLayer');
    const back = el('div', 'modal-back');
    const card = el('div', 'modal wide');
    card.innerHTML = `
      <h3>调试 / 演示</h3>
      <div class="mbody">
        <div class="prompt">给美术看场景与卡面用。改动会立即生效。</div>
        <div class="dbgsec">
          <div class="dbgh">跳到场景</div>
          <div class="opts inline">
            ${Object.entries(FT.SCENES).map(([k, v]) => `<button class="opt" data-jump="${k}">${esc(v.name)}</button>`).join('')}
          </div>
        </div>
        <div class="dbgsec">
          <div class="dbgh">资源</div>
          <div class="opts inline">
            <button class="opt" data-dbg="refill">回满状态</button>
            <button class="opt" data-dbg="mats">给材料</button>
            <button class="opt" data-dbg="phase">直达下一阶段</button>
          </div>
        </div>
      </div>
      <div class="mfoot"><button class="ghost" data-close>关闭</button></div>`;
    back.appendChild(card);
    layer.appendChild(back);
    requestAnimationFrame(() => back.classList.add('in'));
    card.addEventListener('click', e => {
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
  function init() {
    const saved = load();
    const continueBtn = $('#continueBtn');
    if (saved && continueBtn) {
      continueBtn.classList.remove('hidden');
      continueBtn.addEventListener('click', () => {
        FT.Engine.restore(saved.state, saved.rng);
        $('#screenTitle').classList.add('hidden');
        $('#screenGame').classList.remove('hidden');
        render();
        toast('已读取存档');
        setTimeout(() => FT.Engine.start(), 300);
      });
    } else if (continueBtn) {
      continueBtn.classList.add('hidden');
    }

    // 角色选择
    const rosterEl = $('#roster');
    const count = () => $$('#roster .rslot').length;
    function addSlot() {
      if (count() >= 4) return;
      const i = count();
      const slot = el('div', 'rslot');
      slot.innerHTML = `
        <div class="sidx">玩家 ${i + 1}</div>
        <input class="rnameIn" maxlength="8" value="${['你', '老陈', '小满', '阿岩'][i]}" />
        <select class="rchar">
          ${FT.CHARS.map((c, k) => `<option value="${c.id}" ${k === i ? 'selected' : ''}>${c.name} · ${c.tag}</option>`).join('')}
        </select>
        <div class="rhint"></div>
        ${i > 1 ? '<button class="rm" title="移除">×</button>' : ''}`;
      rosterEl.appendChild(slot);
      const sel = slot.querySelector('.rchar');
      const hint = slot.querySelector('.rhint');
      const upd = () => {
        const c = FT.CHARS.find(x => x.id === sel.value) || FT.CHARS[0];
        hint.innerHTML = `<b>${c.name}</b> 健${c.hp} 体${c.stamina} 神${c.sanity} · ${esc(c.passive)}`;
      };
      sel.addEventListener('change', upd); upd();
      const rm = slot.querySelector('.rm');
      if (rm) rm.addEventListener('click', () => { slot.remove(); renumber(); });
    }
    function renumber() {
      $$('#roster .rslot').forEach((s, i) => {
        s.querySelector('.sidx').textContent = `玩家 ${i + 1}`;
        if (i < 2 && s.querySelector('.rm')) s.querySelector('.rm').remove();
      });
      $('#addSlot').classList.toggle('hidden', count() >= 4);
    }
    for (let i = 0; i < 2; i++) addSlot();
    $('#addSlot').addEventListener('click', () => { addSlot(); renumber(); });

    $('#startBtn').addEventListener('click', () => {
      const roster = $$('#roster .rslot').map(s => ({
        name: s.querySelector('.rnameIn').value.trim() || s.querySelector('.rchar').selectedOptions[0].text.split(' ·')[0],
        charId: s.querySelector('.rchar').value
      }));
      const used = {};
      for (const r of roster) { if (used[r.charId]) { toast('角色不能重复', 'bad'); return; } used[r.charId] = 1; }
      FT.Engine.newGame(roster);
      clearSave(); save();
      $('#screenTitle').classList.add('hidden');
      $('#screenGame').classList.remove('hidden');
      render();
      setTimeout(() => FT.Engine.start(), 300);
    });

    // 工具按钮
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'save') { const ok = save(); toast(ok ? '已存档' : '此浏览器不允许本地存档，请用「导出」', ok ? '' : 'bad'); }
      if (b.dataset.act === 'export') {
        const data = JSON.stringify({ state: FT.Engine.state, rng: FT.Engine.rngState });
        const blob = new Blob([data], { type: 'application/json' });
        const a = el('a'); a.href = URL.createObjectURL(blob);
        a.download = `foresttable_${Date.now()}.json`; a.click();
      }
      if (b.dataset.act === 'debug') debugPanel();
    });

    // 键盘快捷：Enter 继续
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const btn = $('#modalLayer .modal button.primary, #modalLayer .modal button[data-v="0"]');
        if (btn && !btn.disabled) btn.click();
      }
    });
  }

  FT.UI = {
    init, render, toast, flash, save, load, clearSave,
    say, choose, vote, roll: rollDialog, dice,
    foodDivide, craftMenu, restMenu,
    eventModal, endTurnSummary, gameOver, debugPanel
  };
})();
