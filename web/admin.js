/* ===== APCA 管理后台 · 逻辑层 =====
 * 两种运行模式:
 *   服务端模式 —— 站点由 server/server.js 托管, 记录集中入库, 密码由服务端校验(真正管控)
 *   本地模式   —— 直接双击 admin.html, 无服务端, 仅可读本浏览器 localStorage 的记录
 *                 (此时密码为前端校验, 仅防随手点开, 不构成真正安全边界)
 */
(function () {
  'use strict';

  var D = window.APCA_DATA;
  var TOKEN_KEY = 'apca_admin_token_v1';
  // v0.8.8 S-01: 移除明文硬编码 LOCAL_USER/LOCAL_PASS
  // 本地模式 (直接双击 admin.html 无服务端) 仅在 localhost/127.0.0.1/file:// 下提供"无登录"快速预览;
  // 任何公网/非本地 host 都必须强制走服务端鉴权, 避免前端 JS 暴露后任何人用出厂口令进后台。
  var LOCAL_ALLOWED_HOSTS = ['localhost', '127.0.0.1', ''];   // '' = file:// 协议
  function isLocalHost() {
    var h = (window.location && window.location.hostname) || '';
    if (!h) return true;                                       // file://
    return LOCAL_ALLOWED_HOSTS.indexOf(h) !== -1;
  }

  var S = { mode: 'local', token: '', records: [], stats: null, tab: 'overview', peerEnabled: true, peerLastStatus: null, serverUnreachable: false };

  /* ---------------- 小工具 ---------------- */
  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (v) { if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }
  function round1(n) { return Math.round(n * 10) / 10; }
  function infoOf(r) { return r.info || {}; }

  function dimOf(id) { return D.dimensions.filter(function (d) { return d.id === id; })[0] || null; }
  function lvlOf(id) { return D.levels.filter(function (l) { return l.id === id; })[0] || null; }

  // questionTypes 在 data.js 中是"以题型 id 为键的对象"(非数组), 统一归一化为数组
  var QTYPES = (function () {
    var qt = D.questionTypes || {};
    if (Array.isArray(qt)) return qt;
    return Object.keys(qt).map(function (k) {
      return { id: k, name: qt[k].name, weight: qt[k].weight, desc: qt[k].desc };
    });
  })();
  function typeOf(id) { return QTYPES.filter(function (t) { return t.id === id; })[0] || null; }

  /* ---------------- 统计(本地模式 / 服务端降级时使用) ---------------- */
  function groupBy(list, keyFn) {
    var m = {};
    list.forEach(function (r) {
      var k = keyFn(r) || '未填写';
      var cur = m[k] || { key: k, count: 0, sum: 0 };
      cur.count += 1; cur.sum += (r.total || 0);
      m[k] = cur;
    });
    return Object.keys(m).map(function (k) {
      return { key: k, count: m[k].count, avg: round1(m[k].sum / m[k].count) };
    }).sort(function (a, b) { return b.count - a.count || b.avg - a.avg; });
  }
  function computeStats(list) {
    var n = list.length;
    var scores = list.map(function (r) { return r.total || 0; }).slice().sort(function (a, b) { return a - b; });
    var avg = n ? round1(scores.reduce(function (a, b) { return a + b; }, 0) / n) : 0;
    var median = n ? (n % 2 ? scores[(n - 1) / 2] : round1((scores[n / 2 - 1] + scores[n / 2]) / 2)) : 0;
    var levelDist = { L1: 0, L2: 0, L3: 0, L4: 0 };
    list.forEach(function (r) { if (levelDist[r.levelId] != null) levelDist[r.levelId] += 1; });
    var dimAvg = {};
    D.dimensions.forEach(function (d) {
      var vals = list.map(function (r) { return (r.dimScores && r.dimScores[d.id]) || 0; });
      dimAvg[d.id] = vals.length ? round1(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : 0;
    });
    var byDay = {};
    list.forEach(function (r) {
      var d = new Date(r.ts || Date.now());
      var k = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      byDay[k] = (byDay[k] || 0) + 1;
    });
    return {
      total: n, avg: avg, median: median,
      max: n ? scores[n - 1] : 0, min: n ? scores[0] : 0,
      levelDist: levelDist, dimAvg: dimAvg,
      byCompany: groupBy(list, function (r) { return infoOf(r).company; }),
      byPosition: groupBy(list, function (r) { return infoOf(r).position; }),
      byBatch: groupBy(list, function (r) { return infoOf(r).batch; }),
      byPack: groupBy(list, function (r) { return r.packName; }),
      trend: Object.keys(byDay).sort().map(function (k) { return { key: k, count: byDay[k] }; })
    };
  }

  /* ---------------- 模式探测与登录 ---------------- */
  function setMode(mode) {
    S.mode = mode;
    var tag = $('#modeTag');
    if (mode === 'server') {
      tag.textContent = '服务端模式 · 已连接后台服务';
      tag.className = 'mode-tag';
      $('#loginTip').textContent = '已连接后台服务，密码由服务端校验。';
    } else {
      tag.textContent = '本地模式 · 仅本机记录';
      tag.className = 'mode-tag local';
      $('#loginTip').textContent = (S.serverUnreachable
        ? '后端服务不可达（请确认 apca.service 已在 ' + (window.location.host || '当前 host') + ' 上运行），当前降级为本地模式：只能读取本浏览器的记录，且密码仅前端校验。'
        : '未检测到后台服务，当前为本地模式：只能读取本浏览器的记录，且密码仅前端校验。')
        + '启动服务可获得集中汇总与真正鉴权：node server/server.js';
    }
  }
  function detectMode() {
    if (typeof fetch !== 'function' || location.protocol === 'file:') {
      setMode('local'); return Promise.resolve();
    }
    return fetch('api/ping').then(function (r) { return r.json(); })
      .then(function (j) { S.serverUnreachable = false; setMode(j && j.ok ? 'server' : 'local'); })
      .catch(function () { S.serverUnreachable = true; setMode('local'); });
  }
  function verifyToken(token) {
    if (S.mode !== 'server') return Promise.resolve(token === 'local');
    return fetch('api/admin/ping', { headers: { 'X-Admin-Token': token } })
      .then(function (r) { return r.ok; }).catch(function () { return false; });
  }
  function doLogin(user, pass) {
    if (S.mode === 'server') {
      return fetch('api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: user, pass: pass })
      }).then(function (r) {
        return r.json().then(function (j) { return { status: r.status, body: j || {} }; });
      }).then(function (res) {
        if (res.status === 200 && res.body.ok) return { ok: true, token: res.body.token };
        return { ok: false, error: (res.body && res.body.error) || '登录失败' };
      }).catch(function (e) { return { ok: false, error: '无法连接服务：' + e.message }; });
    }
    if (isLocalHost()) {
      // v0.8.8 S-01: 本地模式无口令快速预览, 仅 file:// 或 127.0.0.1 生效, 不构成安全边界
      return Promise.resolve({ ok: true, token: 'local' });
    }
    // v0.8.8 S-01: 公网部署禁止本地 fallback, 必须走服务端鉴权
    // v0.8.9 D-02: serverUnreachable 时给运维提示, 区分"被禁"与"后端挂了"
    return Promise.resolve({ ok: false, error: S.serverUnreachable
      ? '后端服务不可达, 请联系运维确认 apca.service 是否在 ' + (window.location.host || '当前 host') + ' 上运行（admin 密码只能由服务端校验）'
      : '本地登录已禁用, 请通过服务端鉴权登录' });
  }

  /* ---------------- 数据读写 ---------------- */
  function loadRecords() {
    if (S.mode === 'server') {
      var url = 'api/admin/records';
      if (S.peerEnabled) url += '?mirror=1';
      return fetch(url, { headers: { 'X-Admin-Token': S.token } })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          S.records = (j && j.records) || [];
          if (j && j.peer) S.peerLastStatus = j.peer;
        })
        .catch(function () { S.records = []; toast('读取后台记录失败'); });
    }
    try { S.records = JSON.parse(localStorage.getItem('apca_history_v1') || '[]'); }
    catch (e) { S.records = []; }
    // 本地记录无服务端 id, 补一个稳定的本地 id 便于删除
    S.records.forEach(function (r, i) { if (!r.id) r.id = 'L' + i + '_' + (r.ts || Date.now()); });
    return Promise.resolve();
  }
  function loadPeerStatus() {
    if (S.mode !== 'server') return Promise.resolve();
    var el = document.getElementById('peerState');
    var wrap = document.getElementById('peerToggleWrap');
    if (!el) return Promise.resolve();
    el.className = 'peer-state loading';
    el.textContent = '探活对端...';
    return fetch('api/admin/peer-status', { headers: { 'X-Admin-Token': S.token } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var configured = j && j.configured;
        if (!configured) {
          el.className = 'peer-state not-configured';
          el.textContent = '本机部署（无对端）';
          if (wrap) wrap.hidden = true;
          S.peerEnabled = false;
          return;
        }
        if (wrap) wrap.hidden = false;
        // 配置了但还没拉过, 触发一次合并拉取看真实状态
        return loadRecords().then(function () {
          renderPeerState();
        });
      })
      .catch(function () {
        el.className = 'peer-state unreachable';
        el.textContent = '对端探活失败';
      });
  }
  function renderPeerState() {
    var el = document.getElementById('peerState');
    if (!el) return;
    var p = S.peerLastStatus;
    if (!p || !p.configured) {
      el.className = 'peer-state not-configured';
      el.textContent = '本机部署（无对端）';
      return;
    }
    if (p.ok) {
      el.className = 'peer-state ok';
      el.textContent = '对端在线 · ' + (p.url || '') + ' · ' + p.count + ' 条 · ' + p.latencyMs + 'ms';
    } else {
      el.className = 'peer-state unreachable';
      el.textContent = '对端不可达 · ' + (p.url || '') + ' · ' + (p.error || '');
    }
  }
  function loadStats() {
    if (S.mode === 'server') {
      return fetch('api/admin/stats', { headers: { 'X-Admin-Token': S.token } })
        .then(function (r) { return r.json(); })
        .then(function (j) { S.stats = (j && j.stats) || computeStats(S.records); })
        .catch(function () { S.stats = computeStats(S.records); });
    }
    S.stats = computeStats(S.records);
    return Promise.resolve();
  }
  function delRecord(id) {
    if (S.mode === 'server') {
      return fetch('api/admin/records', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': S.token },
        body: JSON.stringify({ id: id })
      }).then(function () { return refresh(); });
    }
    var next = S.records.filter(function (r) { return r.id !== id; });
    localStorage.setItem('apca_history_v1', JSON.stringify(next));
    return refresh();
  }
  function clearAll() {
    if (S.mode === 'server') {
      return fetch('api/admin/records/clear', {
        method: 'POST', headers: { 'X-Admin-Token': S.token }
      }).then(function () { toast('已清空全部记录'); return refresh(); });
    }
    localStorage.removeItem('apca_history_v1');
    toast('已清空本机记录');
    return refresh();
  }
  function refresh() {
    return loadRecords().then(loadStats).then(function () {
      renderOverview(); renderPeople(); renderBank(); renderRules(); renderPeerState();
    });
  }

  /* ---------------- 渲染 · 概览 ---------------- */
  function bars(rows) {
    var max = 1;
    rows.forEach(function (r) { if (r.value > max) max = r.value; });
    return rows.map(function (r) {
      var pct = Math.round(r.value / max * 100);
      var rate = r.total ? Math.round(r.value / r.total * 100) : null;
      return '<div class="bar-row">' +
        '<div class="bar-label" title="' + esc(r.label) + '">' + esc(r.label) + '</div>' +
        '<div class="bar-track"><div class="bar-fill ' + (r.cls || '') + '" style="width:' + pct + '%"></div></div>' +
        '<div class="bar-val">' + r.value + (r.unit || ' 人') + (rate !== null ? '（' + rate + '%）' : '') + '</div>' +
        '</div>';
    }).join('');
  }
  function topRows(arr, n, unit) {
    return arr.slice(0, n || 8).map(function (g) {
      return { label: g.key, value: unit === '分' ? g.avg : g.count, unit: unit || ' 人' };
    });
  }
  function renderOverview() {
    var st = S.stats || computeStats(S.records);
    var companies = uniq(S.records.map(function (r) { return infoOf(r).company; }));
    var batches = uniq(S.records.map(function (r) { return infoOf(r).batch; }));

    var cards = [
      { label: '测评总人次', value: st.total, sub: '全部记录' },
      { label: '平均得分', value: st.avg, sub: '满分 100' },
      { label: '中位得分', value: st.median, sub: '居中水平' },
      { label: '最高 / 最低', value: st.max + ' / ' + st.min, sub: '分数区间' },
      { label: '涉及公司', value: companies.length, sub: '去重统计' },
      { label: '测评批次', value: batches.length, sub: '去重统计' }
    ];
    $('#statGrid').innerHTML = cards.map(function (c) {
      return '<div class="stat-card"><div class="stat-label">' + esc(c.label) + '</div>' +
        '<div class="stat-value">' + esc(c.value) + '</div>' +
        '<div class="stat-sub">' + esc(c.sub) + '</div></div>';
    }).join('');

    $('#levelBadge').textContent = st.total + ' 人次';
    $('#distLevel').innerHTML = bars(D.levels.map(function (l) {
      return { label: l.id + ' ' + l.name, value: st.levelDist[l.id] || 0, total: st.total, cls: 'lvl-' + l.id };
    }));
    $('#distDim').innerHTML = bars(D.dimensions.map(function (d) {
      return { label: d.name, value: st.dimAvg[d.id] || 0, unit: ' 分' };
    }));
    $('#distBatch').innerHTML = st.byBatch.length
      ? bars(topRows(st.byBatch, 8)) : '<p class="empty">暂无批次数据</p>';
    $('#distCompany').innerHTML = st.byCompany.length
      ? bars(topRows(st.byCompany, 8)) : '<p class="empty">暂无公司数据</p>';
    $('#distPosition').innerHTML = st.byPosition.length
      ? bars(topRows(st.byPosition, 8)) : '<p class="empty">暂无岗位数据</p>';
    $('#distPack').innerHTML = st.byPack.length
      ? bars(topRows(st.byPack, 8)) : '<p class="empty">暂无数据</p>';

    // 趋势
    var trend = st.trend || [];
    if (!trend.length) { $('#trendBox').innerHTML = '<p class="empty">暂无数据</p>'; }
    else {
      var max = 1;
      trend.forEach(function (t) { if (t.count > max) max = t.count; });
      $('#trendBox').innerHTML = trend.slice(-30).map(function (t) {
        var h = Math.round(t.count / max * 90);
        return '<div class="trend-col"><div class="trend-bar" style="height:' + h + 'px" title="' +
          esc(t.key) + '：' + t.count + ' 人次"></div><div class="trend-lab">' + esc(t.key.slice(5)) + '</div></div>';
      }).join('');
    }
  }

  /* ---------------- 渲染 · 人员清单 ---------------- */
  function fillSelect(sel, values, allLabel) {
    var el = $(sel);
    var cur = el.value;
    el.innerHTML = '<option value="">' + esc(allLabel) + '</option>' +
      uniq(values).map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
    if (cur && values.indexOf(cur) !== -1) el.value = cur;
  }
  function filtered() {
    var q = ($('#searchInput').value || '').trim().toLowerCase();
    var b = $('#filterBatch').value, c = $('#filterCompany').value;
    var l = $('#filterLevel').value, p = $('#filterPack').value;
    return S.records.filter(function (r) {
      var i = infoOf(r);
      if (b && i.batch !== b) return false;
      if (c && i.company !== c) return false;
      if (l && r.levelId !== l) return false;
      if (p && r.packName !== p) return false;
      if (q) {
        var hay = [i.name, i.company, i.position, i.batch, r.packName, r.levelName].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }
  function renderPeople() {
    fillSelect('#filterBatch', S.records.map(function (r) { return infoOf(r).batch; }), '全部批次');
    fillSelect('#filterCompany', S.records.map(function (r) { return infoOf(r).company; }), '全部公司');
    fillSelect('#filterLevel', D.levels.map(function (l) { return l.id; }), '全部等级');
    fillSelect('#filterPack', S.records.map(function (r) { return r.packName; }), '全部测评卷');
    renderTable();
  }
  function renderTable() {
    var list = filtered();
    $('#peopleCount').textContent = list.length + ' 人';
    var body = $('#peopleBody');
    if (!list.length) { body.innerHTML = ''; $('#peopleEmpty').hidden = false; return; }
    $('#peopleEmpty').hidden = true;
    body.innerHTML = list.map(function (r, idx) {
      var i = infoOf(r);
      return '<tr data-idx="' + idx + '">' +
        '<td>' + esc(i.name || '匿名') + '</td>' +
        '<td>' + esc(i.company || '—') + '</td>' +
        '<td>' + esc(i.position || '—') + '</td>' +
        '<td>' + esc(i.batch || '—') + '</td>' +
        '<td>' + esc(r.packName || '—') + (r.isStandalone ? (r.merged ? '（单卷·已合并通用）' : '（单卷）') : '') + '</td>' +
        '<td class="num">' + esc(r.total) + '</td>' +
        '<td><span class="chip lvl-' + esc(r.levelId) + '">' + esc(r.levelId) + '</span> ' + esc(r.levelName || '') + '</td>' +
        '<td class="muted">' + esc(fmtDate(r.ts)) + '</td>' +
        '<td><button class="btn-sm btn-danger" data-del="' + esc(r.id) + '">删除</button></td>' +
        '</tr>';
    }).join('');

    Array.prototype.forEach.call(body.querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function (e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute('data-del') != null) return;
        openDetail(list[+tr.getAttribute('data-idx')]);
      });
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-del]'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!window.confirm('确定删除这条测评记录？此操作不可恢复。')) return;
        delRecord(btn.getAttribute('data-del'));
      });
    });
  }
  function openDetail(r) {
    var i = infoOf(r);
    var lvl = lvlOf(r.levelId);
    var html = '';
    html += '<div class="rule-row"><div class="rule-key">测评人</div><div class="rule-val">' +
      esc(i.name || '匿名') + (i.company ? ' · ' + esc(i.company) : '') + (i.position ? ' · ' + esc(i.position) : '') + '</div></div>';
    html += '<div class="rule-row"><div class="rule-key">批次</div><div class="rule-val">' + esc(i.batch || '—') + '</div></div>';
    html += '<div class="rule-row"><div class="rule-key">备注</div><div class="rule-val">' + esc(i.notes || '—') + '</div></div>';
    html += '<div class="rule-row"><div class="rule-key">测评卷</div><div class="rule-val">' +
      esc(r.packName || '—') + (r.isStandalone ? (r.merged ? '（单卷·已合并通用）' : '（单独成卷）') : '') + ' · ' + esc(r.qcount || '—') + ' 题</div></div>';
    html += '<div class="rule-row"><div class="rule-key">题目版本</div><div class="rule-val">' + esc(r.qVersion || 'unknown') + (r.framework ? ' <span class="muted">(' + esc(r.framework) + ')</span>' : '') + '</div></div>';
    // v0.8.9 P0-2 配套: 展示完整度与实答题数, 便于识别缺答样本(缺答不出等级)
    if (r.completeness != null) {
      var pct = Math.round(Number(r.completeness) * 100);
      var complete = Number(r.completeness) >= 1;
      html += '<div class="rule-row"><div class="rule-key">作答完整度</div><div class="rule-val">' +
        '<b>' + pct + '%</b>' + (r.answered != null ? ' <span class="muted">（实际作答 ' + esc(r.answered) + ' 题）</span>' : '') +
        (complete ? '' : ' <span class="muted">· 未答完, 不出等级</span>') + '</div></div>';
    }
    html += '<div class="rule-row"><div class="rule-key">完成时间</div><div class="rule-val">' + esc(fmtDate(r.ts)) + '</div></div>';
    html += '<div class="rule-row"><div class="rule-key">综合得分</div><div class="rule-val">' +
      '<b style="font-size:18px">' + esc(r.total) + '</b> / 100 · ' +
      '<span class="chip lvl-' + esc(r.levelId) + '">' + esc(r.levelId) + '</span> ' + esc(r.levelName || '') +
      (lvl ? ' <span class="muted">（' + esc(lvl.subtitle) + '）</span>' : '') + '</div></div>';
    if (r.isStandalone && r.merged) {
      var mdate = r.mergedFromTs ? new Date(Number(r.mergedFromTs)) : null;
      var mp = function (n) { return (n < 10 ? '0' : '') + n; };
      var mstr = mdate ? (mdate.getFullYear() + '-' + mp(mdate.getMonth() + 1) + '-' + mp(mdate.getDate())) : '之前';
      html += '<div class="rule-row"><div class="rule-key">合并说明</div><div class="rule-val">' +
        '单独成卷已与 ' + esc(mstr) + ' 的「' + esc(r.mergedFromPack || '通用版') + '」记录合并出分（通用 ' + (D.core.length || 0) + ' 题 + 本专项）</div></div>';
      html += '<div class="rule-row"><div class="rule-key">专项单独得分</div><div class="rule-val">' +
        (r.standaloneTotal != null ? esc(r.standaloneTotal) : '—') + ' / 100 · ' +
        (r.standaloneLevelId ? '<span class="chip lvl-' + esc(r.standaloneLevelId) + '">' + esc(r.standaloneLevelId) + '</span> ' + esc(r.standaloneLevelName || '') : '—') +
        '</div></div>';
    }
    html += '<div style="margin-top:14px"><b>六维得分</b></div>';
    html += bars(D.dimensions.map(function (d) {
      return { label: d.name, value: (r.dimScores && r.dimScores[d.id]) || 0, unit: ' 分' };
    }));
    $('#detailTitle').textContent = (i.name || '匿名') + ' · ' + esc(r.total) + ' 分';
    $('#detailBody').innerHTML = html;
    $('#detailModal').hidden = false;
  }

  /* ---------------- 渲染 · 题库 ---------------- */
  function bankQuestions() {
    var pack = $('#bankPackSelect').value || 'core';
    if (pack === 'core') return D.core.slice();
    var p = D.packs.filter(function (x) { return x.id === pack; })[0];
    return p ? p.questions.slice() : [];
  }
  function renderBank() {
    var packs = [{ id: 'core', name: '通用版（' + D.core.length + ' 题）' }]
      .concat(D.packs.map(function (p) { return { id: p.id, name: p.name + '（' + p.questions.length + ' 题）' }; }));
    fillSelect('#bankPackSelect', packs.map(function (p) { return p.id; }), '全部卷别');
    // 把 value=core 的显示名改成"通用版"
    var opt = $('#bankPackSelect').querySelector('option[value="core"]');
    if (opt) opt.textContent = '通用版（' + D.core.length + ' 题）';

    fillSelect('#bankDimSelect', D.dimensions.map(function (d) { return d.id; }), '全部维度');
    renderBankList();
  }
  function renderBankList() {
    var dim = $('#bankDimSelect').value;
    var packId = $('#bankPackSelect').value || 'core';
    var packLabel = packId === 'core' ? '通用版'
      : ((D.packs.filter(function (x) { return x.id === packId; })[0] || {}).name || packId);
    var qs = bankQuestions().filter(function (q) { return !dim || q.dimension === dim; });
    $('#bankCount').textContent = qs.length + ' 题';
    if (!qs.length) { $('#bankList').innerHTML = '<p class="empty">该筛选下没有题目。</p>'; return; }
    $('#bankList').innerHTML = qs.map(function (q) {
      var d = dimOf(q.dimension), t = typeOf(q.type);
      return '<div class="bank-item">' +
        '<div class="q-head"><span class="q-id">' + esc(q.id) + '</span>' +
        '<span class="q-meta">' + esc(d ? d.name : q.dimension) + ' · ' + esc(t ? t.name : q.type) + ' · ' + esc(packLabel) + '</span></div>' +
        (q.scene ? '<div class="q-scene">场景：' + esc(q.scene) + '</div>' : '') +
        '<div class="q-text">' + esc(q.question) + '</div>' +
        '<div class="q-opts">' + ['A', 'B', 'C', 'D'].map(function (L) {
          return '<div class="q-opt"><b>' + L + '.</b> ' + esc(q.options[L]) +
            ' <span class="muted">（' + (q.scores || D.scoreMap)[L] + ' 分）</span></div>';
        }).join('') + '</div>' +
        '<div class="q-analysis">解析：' + esc(q.analysis) + '</div>' +
        '</div>';
    }).join('');
  }

  /* ---------------- 渲染 · 规则库 ---------------- */
  function renderRules() {
    var html = '';

    // 计分规则
    html += '<div class="card"><div class="card-h">计分规则</div>';
    html += '<div class="rule-row"><div class="rule-key">选项分值</div><div class="rule-val">' +
      '每题四选项<b>乱序呈现</b>，分值随选项内容走，为 <b>0 / 33.3 / 66.7 / 100</b> 四档；各题字母与分值的对应不同，见题库页每题标注。' +
      '<br><span class="muted">100 分选项是「最高成熟度」锚点，代表量表顶端，并非对所有人唯一正确的解。</span></div></div>';
    html += '<div class="rule-row"><div class="rule-key">维度合成</div><div class="rule-val">' +
      '维度内各题取平均；<b>通用/加测</b>模式按 6 维等权平均，<b>单独成卷</b>模式按该专项权重加权。</div></div>';
    html += '</div>';

    // 维度
    html += '<div class="card"><div class="card-h">6 大能力维度</div>';
    html += '<table class="w-table"><thead><tr><th>维度</th><th>权重</th><th>定位</th><th>能力项</th></tr></thead><tbody>';
    D.dimensions.forEach(function (d) {
      html += '<tr><td><b>' + esc(d.name) + '</b> <span class="muted">' + esc(d.id) + '</span></td>' +
        '<td>' + Math.round(d.weight * 100) + '%</td>' +
        '<td>' + esc(d.tagline) + '</td>' +
        '<td>' + esc((d.abilities || []).join(' / ')) + '</td></tr>';
    });
    html += '</tbody></table></div>';

    // 等级
    html += '<div class="card"><div class="card-h">4 级能力模型</div>';
    html += '<table class="w-table"><thead><tr><th>等级</th><th>名称</th><th>分数区间</th><th>特征</th></tr></thead><tbody>';
    D.levels.forEach(function (l) {
      html += '<tr><td><span class="chip lvl-' + esc(l.id) + '">' + esc(l.id) + '</span></td>' +
        '<td><b>' + esc(l.name) + '</b></td>' +
        '<td>' + l.score_range[0] + ' – ' + l.score_range[1] + '</td>' +
        '<td>' + esc(l.subtitle) + '</td></tr>';
    });
    html += '</tbody></table></div>';

    // 题型
    html += '<div class="card"><div class="card-h">题型</div>';
    html += '<table class="w-table"><thead><tr><th>标识</th><th>题型</th><th>权重</th><th>说明</th></tr></thead><tbody>';
    QTYPES.forEach(function (t) {
      html += '<tr><td><code>' + esc(t.id) + '</code></td><td><b>' + esc(t.name) + '</b></td>' +
        '<td>' + (t.weight != null ? Math.round(t.weight * 100) + '%' : '—') + '</td>' +
        '<td>' + esc(t.desc || '—') + '</td></tr>';
    });
    html += '</tbody></table></div>';

    // 专项权重
    html += '<div class="card"><div class="card-h">专项权重模型</div>';
    html += '<table class="w-table"><thead><tr><th>专项</th><th>题量</th>' +
      D.dimensions.map(function (d) { return '<th>' + esc(d.id) + '</th>'; }).join('') + '</tr></thead><tbody>';
    D.packs.forEach(function (p) {
      html += '<tr><td><b>' + esc(p.name) + '</b><div class="muted" style="font-size:12px">' + esc(p.desc) + '</div></td>' +
        '<td>' + p.questions.length + ' 题</td>' +
        D.dimensions.map(function (d) {
          return '<td>' + (p.weights && p.weights[d.id] != null ? Math.round(p.weights[d.id] * 100) + '%' : '—') + '</td>';
        }).join('') +
        '</tr>';
    });
    html += '</tbody></table></div>';

    // 报告文案
    html += '<div class="card"><div class="card-h">报告文案规则</div>';
    D.levels.forEach(function (l) {
      var advice = (D.reports.coreAdvice || {})[l.id] || [];
      var tip = (D.reports.levelTips || {})[l.id] || '';
      html += '<div class="rule-row"><div class="rule-key">' +
        '<span class="chip lvl-' + esc(l.id) + '">' + esc(l.id) + '</span> ' + esc(l.name) + '</div>' +
        '<div class="rule-val"><ul>' +
        advice.map(function (a) { return '<li><b>' + esc(a.t) + '</b>：' + esc(a.d) + '</li>'; }).join('') +
        '</ul><div class="muted" style="margin-top:6px">等级提示：' + esc(tip) + '</div></div></div>';
    });
    html += '</div>';

    // 元信息
    html += '<div class="card"><div class="card-h">题库元信息</div>';
    html += '<div class="rule-row"><div class="rule-key">框架版本</div><div class="rule-val">' + esc(D.meta.framework) + '</div></div>';
    html += '<div class="rule-row"><div class="rule-key">题集版本</div><div class="rule-val">' + esc(D.meta.questionSetVersion) + '</div></div>';
    html += '<div class="rule-row"><div class="rule-key">题量</div><div class="rule-val">通用 ' + D.core.length + ' 题' +
      D.packs.map(function (p) { return '；' + esc(p.name) + ' ' + p.questions.length + ' 题'; }).join('') + '</div></div>';
    html += '<div class="rule-row"><div class="rule-key">生成时间</div><div class="rule-val">' + esc(D.meta.generatedAt) + '</div></div>';
    html += '</div>';

    $('#rulesBody').innerHTML = html;
  }

  /* ---------------- 导出 CSV ---------------- */
  function exportCSV() {
    var list = filtered();
    if (!list.length) { toast('当前没有可导出的记录'); return; }
    var head = ['姓名', '公司', '岗位', '批次', '测评卷', '总分', '等级', '等级名', '完成时间', '备注'];
    var dimHead = D.dimensions.map(function (d) { return d.name; });
    var rows = list.map(function (r) {
      var i = infoOf(r);
      return [i.name || '匿名', i.company || '', i.position || '', i.batch || '',
        r.packName || '', r.total, r.levelId, r.levelName || '', fmtDate(r.ts), i.notes || ''
      ].concat(D.dimensions.map(function (d) { return (r.dimScores && r.dimScores[d.id]) || 0; }));
    });
    function cell(v) {
      var s = String(v == null ? '' : v);
      // v0.8.9 P1-2: 防 CSV 公式注入(Excel/LibreOffice 在 CSV 中将 =/+/-/@ 开头视为公式)
      //   用户可控字段(姓名/公司/岗位/批次/备注)若以这些字符开头会触发执行;
      //   在前加单引号 + 转义双引号包裹, Excel 会原样显示单引号后文本(不再当公式)
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var csv = '﻿' + [head.concat(dimHead)].concat(rows).map(function (r) {
      return r.map(cell).join(',');
    }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'APCA测评记录_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast('已导出 ' + rows.length + ' 条记录');
  }

  /* ---------------- 视图切换 ---------------- */
  function switchTab(name) {
    S.tab = name;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === name);
    });
    ['overview', 'people', 'bank', 'rules'].forEach(function (n) {
      $('#tab' + n.charAt(0).toUpperCase() + n.slice(1)).hidden = (n !== name);
    });
  }

  /* ---------------- 进入 / 退出 ---------------- */
  function enterAdmin(token) {
    S.token = token;
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* 忽略 */ }
    $('#loginWrap').hidden = true;
    $('#adminWrap').hidden = false;
    loadPeerStatus().then(refresh);
  }
  function showLogin() {
    $('#loginWrap').hidden = false;
    $('#adminWrap').hidden = true;
  }
  function logout() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* 忽略 */ }
    S.token = ''; S.records = []; S.stats = null;
    showLogin();
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var u = $('#loginUser').value.trim();
      var p = $('#loginPass').value;
      var err = $('#loginErr');
      err.hidden = true;
      if (!u || !p) { err.textContent = '请输入账号与密码'; err.hidden = false; return; }
      $('#btnLogin').disabled = true;
      doLogin(u, p).then(function (res) {
        $('#btnLogin').disabled = false;
        if (res.ok) { enterAdmin(res.token); }
        else { err.textContent = res.error || '登录失败'; err.hidden = false; }
      });
    });

    $('#btnLogout').addEventListener('click', logout);

    $('#tabs').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.tab') : null;
      if (b) switchTab(b.getAttribute('data-tab'));
    });

    $('#btnRefresh').addEventListener('click', function () { refresh().then(function () { toast('已刷新'); }); });
    $('#btnExport').addEventListener('click', exportCSV);
    $('#btnClearAll').addEventListener('click', function () {
      if (!window.confirm('确定清空全部测评记录？此操作不可恢复。')) return;
      clearAll();
    });

    var peerToggleEl = $('#peerToggle');
    if (peerToggleEl) {
      peerToggleEl.addEventListener('change', function () {
        S.peerEnabled = peerToggleEl.checked;
        refresh();
      });
    }

    ['#searchInput', '#filterBatch', '#filterCompany', '#filterLevel', '#filterPack'].forEach(function (sel) {
      $(sel).addEventListener('input', renderTable);
      $(sel).addEventListener('change', renderTable);
    });

    $('#bankPackSelect').addEventListener('change', renderBankList);
    $('#bankDimSelect').addEventListener('change', renderBankList);

    $('#btnDetailClose').addEventListener('click', function () { $('#detailModal').hidden = true; });
    $('#detailMask').addEventListener('click', function () { $('#detailModal').hidden = true; });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    if (!D) {
      document.body.innerHTML = '<p style="padding:24px">题库数据加载失败：data.js 未找到。</p>';
      return;
    }
    bind();
    renderBank();
    renderRules();
    var saved = null;
    try { saved = sessionStorage.getItem(TOKEN_KEY); } catch (e) { saved = null; }
    detectMode().then(function () {
      if (!saved) { showLogin(); return; }
      verifyToken(saved).then(function (ok) {
        if (ok) enterAdmin(saved); else { try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} showLogin(); }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
