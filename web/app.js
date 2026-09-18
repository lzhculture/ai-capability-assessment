/* ===== 个人AI办公能力测评 · 网站版逻辑层 (APCA Web) =====
 * 题库与计分语义源自 miniprogram/ 历史源码 (6 维 / 4 级 / 四档分值 0/33.3/66.7/100):
 *   通用 (D.core.length 题, 当前 32) + bid/mfg/retail 各 18 题; blended 等权 6 维平均; standalone 按专项 weights 加权
 * v0.8: 每题选项乱序呈现 (构建期按 qid 确定性乱序), 各字母实际分值见每题 q.scores,
 *   防止受测者发现"总选 D 得高分"的规律; 历史记录存分值不存字母, 天然兼容。
 *   零服务端模式: 数据仅存本机 localStorage。
 */
(function () {
  'use strict';

  var D = window.APCA_DATA;
  var SCORE_MAP = D.scoreMap;                 // 四档分值 {A:0,B:33.3,C:66.7,D:100} (兜底/未乱序题用)
  var LETTER_BY_SCORE = { 0: 'A', 33.3: 'B', 66.7: 'C', 100: 'D' };  // 仅供未乱序题的反查
  var DIM_SHORT = { D1: 'AI沟通', D2: '任务拆解', D3: '流程选择', D4: '质量管控', D5: '风险应对', D6: '经验复用' };
  // v0.8: 每题各字母实际分值 (乱序后各题不同)
  function qScores(q) { return q.scores || SCORE_MAP; }
  // 分值 → 该题对应字母 (乱序后须按题查)
  function letterOfScore(q, score) {
    if (score == null) return '—';
    var sc = qScores(q);
    for (var L in sc) { if (sc[L] === score) return L; }
    return LETTER_BY_SCORE[score] || '—';
  }
  // 该题最高分选项字母 (「最高成熟度」锚点)
  function bestLetter(q) {
    var sc = qScores(q), best = 'A';
    ['A', 'B', 'C', 'D'].forEach(function (L) { if (sc[L] > sc[best]) best = L; });
    return best;
  }

  /* ---------- 存储键 ---------- */
  var K_PROGRESS = 'apca_progress_v1';
  var K_HISTORY = 'apca_history_v1';

  /* ---------- 小工具 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 1800);
  }

  /* ---------- 计分 (与 calc.js 一致) ---------- */
  function buildQuestions(packId, mode) {
    if (packId && packId !== 'none') {
      var p = D.packs.find(function (x) { return x.id === packId; });
      if (p) {
        if (mode === 'standalone') return p.questions.slice();
        return D.core.concat(p.questions);
      }
    }
    return D.core.slice();
  }
  function packWeights(packId) {
    var p = D.packs.find(function (x) { return x.id === packId; });
    return (p && p.weights) ? p.weights : null;
  }
  function packName(packId) {
    if (!packId || packId === 'none') return '通用版';
    var p = D.packs.find(function (x) { return x.id === packId; });
    return p ? p.name : '通用版';
  }
  function levelOf(score) {
    var ls = D.levels;
    for (var i = ls.length - 1; i >= 0; i--) {
      if (score >= ls[i].score_range[0]) return ls[i];
    }
    return ls[0];
  }
  // answers: {qid: score}; weights: 维度权重|null(等权)
  function calcResult(questions, answers, weights) {
    var dimScores = {}, dimCount = {};
    Object.keys(answers).forEach(function (qid) {
      var q = questions.find(function (x) { return x.id === qid; });
      if (!q) return;
      var s = answers[qid];
      if (s == null) return;
      dimScores[q.dimension] = (dimScores[q.dimension] || 0) + s;
      dimCount[q.dimension] = (dimCount[q.dimension] || 0) + 1;
    });
    Object.keys(dimScores).forEach(function (d) {
      dimScores[d] = +(dimScores[d] / dimCount[d]).toFixed(1);
    });
    var total;
    if (weights) {
      var ws = 0, sw = 0;
      Object.keys(dimScores).forEach(function (d) {
        var w = weights[d] || 0; ws += dimScores[d] * w; sw += w;
      });
      total = sw > 0 ? ws / sw : 0;
    } else {
      // v0.8.5: 原为固定 /6。当有维度未作答时 (dimScores 键数 < 6, 例如中途提交),
      // 固定分母会系统性低估总分; 且与 standalone 分支按实际权重和 sw 归一化的口径不一致。
      // 现改为按**实际参与计分的维度数**归一化 (通用卷六维等权)。
      var dn = Object.keys(dimScores).length;
      total = dn > 0 ? Object.keys(dimScores).reduce(function (a, d) { return a + dimScores[d]; }, 0) / dn : 0;
    }
    // v0.8.7: 完整性校验防缺答刷满分 (P0-2.1)
    //   answered = 实答题数 (排除 null)
    //   totalQuestions = 题库总题数 (questions.length)
    // v0.8.9 P0-2: 只有全答完(completeness < 1 即未答完)才出等级,
    //   之前 0.5 阈值留了「答到 50% 即拿 L4」边界漏洞(Codex 审查发现: 18/32=0.5625 仍出 L4)
    var answered = 0;
    Object.keys(answers).forEach(function (qid) { if (answers[qid] != null) answered++; });
    var completeness = questions.length > 0 ? +(answered / questions.length).toFixed(3) : 0;
    var lv = levelOf(total);
    if (completeness < 1) lv = { id: null, name: '未答完 · 不出等级' };
    return {
      total: +total.toFixed(1),
      dimScores: dimScores,
      answered: answered,
      completeness: completeness,
      level: lv
    };
  }
  function weakDims(dimScores, top) {
    return D.dimensions.map(function (d) { return { id: d.id, score: dimScores[d.id] || 0 }; })
      .sort(function (a, b) { return a.score - b.score; }).slice(0, top || 2).map(function (x) { return x.id; });
  }
  // v0.8.4: 原实现每维度只取 1 天 → 共 6 天 (与"30 天提升路线"标题不符),
  // 且 TIPS[dim][idx % 5] 用维度排名当 tips 下标, 第 6 名错位取回 tips[0]。
  // 现改为: 维度按得分升序 (弱项优先), 每维度连续铺满其全部 5 条 tips → 6×5=30 天。
  // v0.8.7 P0-2.3: 30 天路线固定 6 维 × 5 天 = 30 天
  //   - dimScores 升序排 (弱项优先), 弱 2 维前 5 张卡片用 ACTION_DICT 中画像最弱能力点的具体动作
  //   - 弱 2 维不够 5 条时回退该维度 tips 模板补足
  //   - 其余 4 维直接用 tips 模板
  //   - 满 30 张卡片, 与 "30 天提升路线" 标题一致
  function buildLearningMap(dimScores, abilityScores) {
    var sorted = D.dimensions.map(function (d) { return { dim: d, score: dimScores[d.id] || 0 }; })
      .sort(function (a, b) { return a.score - b.score; });
    var TIPS = D.reports.learningTips || {};
    var ACTION = D.reports.actionDict || {};
    var map = [];
    sorted.forEach(function (s, idx) {
      var tipsRaw = TIPS[s.dim.id] || [];
      var tips = tipsRaw.map(function (t) { return { t: '本周动作', d: t }; });
      var acts = [];
      // 弱 2 维: 用 ACTION_DICT 中画像最弱能力点的动作 (≤5 条)
      if (idx < 2 && abilityScores && abilityScores[s.dim.id]) {
        var abl = abilityScores[s.dim.id];
        var ablSorted = Object.keys(abl).map(function (k) { return { k: k, s: abl[k] }; })
          .sort(function (a, b) { return a.s - b.s; });
        for (var ai = 0; ai < ablSorted.length && acts.length < 5; ai++) {
          var arr = ACTION[s.dim.id] && ACTION[s.dim.id][ablSorted[ai].k];
          if (arr && arr.length) {
            for (var aj = 0; aj < arr.length && acts.length < 5; aj++) acts.push(arr[aj]);
          }
        }
      }
      // 弱 2 维补足到 5 条; 其余维直接模板 5 条
      var pool = acts.length >= 5 ? acts.slice(0, 5) : acts.concat(tips).slice(0, 5);
      while (pool.length < 5) pool.push(tips[pool.length] || { t: '本周动作', d: '保持当前节奏, 持续在真实任务中验证' });
      pool.forEach(function (p) { map.push({ dim: s.dim.id, dimName: s.dim.name, actionTitle: p.t, actionDetail: p.d }); });
    });
    // 给每条加 Day N 标签 (固定第 1=Day 1 ... 第 30=Day 30)
    map.forEach(function (m, i) { m.t = 'Day ' + (i + 1); });
    return map;
  }

  // v0.8.6: 个体化解读 — 基于 record.answers + record.dimScores 推导画像,
  // 根据画像中最弱维度+最弱能力点, 从 ACTION_DICT 选 3 条具体动作。
  // 旧 buildAdvice 只读 levelId 已被替换为 buildAdviceForRecord(record)。
  function analyzeProfile(record) {
    var profile = {
      byDim: {},
      abilityScores: {},          // {D1: { "受众识别 (...)": 40, ... }, ...}
      globalWeakAbilities: [],    // 全卷最弱 3 个能力点 (字符串数组)
      globalStrongAbilities: [],  // 全卷最强 2 个能力点
      abilityTitleMap: {}         // 能力点名 → 维度
    };
    if (!record || !record.answers) return profile;
    var qs = buildQuestions(record.packId || 'none', record.merged ? 'blended' : (record.mode || 'blended'));
    var dimQ = {};   // 维度 → 该维度下题数
    qs.forEach(function (q) { dimQ[q.dimension] = (dimQ[q.dimension] || 0) + 1; });
    // 1. 维度内按 ability 点平局 (该题得分 / 该题满分 100)
    Object.keys(record.answers).forEach(function (qid) {
      var q = qs.find(function (x) { return x.id === qid; });
      if (!q) return;
      var s = record.answers[qid];
      if (s == null) return;
      var abls = q.abilities || [];
      if (!abls.length) return;
      var perAbl = s / abls.length;
      abls.forEach(function (a) {
        if (!profile.abilityScores[q.dimension]) profile.abilityScores[q.dimension] = {};
        // 累加再做平均; 用加权 (题数) 方式更准, 此处用直接累加 + 后续按维度题数归一
        profile.abilityScores[q.dimension][a] = (profile.abilityScores[q.dimension][a] || 0) + perAbl;
        profile.abilityTitleMap[a] = q.dimension;
      });
    });
    // 2. 按每个维度的实际题数做平均, 得到最终能力点分 (0-100)
    Object.keys(profile.abilityScores).forEach(function (dim) {
      var abl = profile.abilityScores[dim];
      var qN = dimQ[dim] || 1;
      Object.keys(abl).forEach(function (a) {
        // 累加值是「分 / 该题含的能力点个数」之和 → 近似为 abl[i] * ablCount_i 的总和
        // 直接除以 100 让单位变 0-100 的初估; 然后乘 qN 让 6 题平均
        abl[a] = +((abl[a] / 100) * 100 / qN).toFixed(1);  // ≈ 该能力点的平均分子贡献
        // 简化: 能力点分 = 该能力点所有题平均分 ≈ abl[a] 直接就是平均分 (≈ 0-100)
        abl[a] = +abl[a].toFixed(1);
      });
    });
    // 3. byDim 汇总
    Object.keys(record.dimScores || {}).forEach(function (d) {
      var abl = profile.abilityScores[d] || {};
      var ablArr = Object.keys(abl).map(function (k) { return { k: k, s: abl[k] }; });
      ablArr.sort(function (a, b) { return a.s - b.s; });
      profile.byDim[d] = {
        score: record.dimScores[d] || 0,
        weakAbilities: ablArr.slice(0, 2).map(function (x) { return x.k; }),
        strongAbilities: ablArr.slice(-2).map(function (x) { return x.k; })
      };
    });
    // 4. 全卷最弱/最强能力点
    var allAb = [];
    Object.keys(profile.abilityScores).forEach(function (d) {
      Object.keys(profile.abilityScores[d]).forEach(function (a) {
        allAb.push({ k: a, dim: d, s: profile.abilityScores[d][a] });
      });
    });
    allAb.sort(function (a, b) { return a.s - b.s; });
    profile.globalWeakAbilities = allAb.slice(0, 3).map(function (x) { return x.k; });
    profile.globalStrongAbilities = allAb.slice(-2).reverse().map(function (x) { return x.k; });
    return profile;
  }

  // v0.8.9 P2-3: 按「维度分升序 → 维度内能力分升序」取最弱 N 个能力点(每维最多 1 个),
//   修正复盘默认折叠偏 D1 的问题(globalWeakAbilities 受 D1 题多+能力点多影响, 实测最弱能力点约 74.7% 落 D1)
  //   n=3 → 覆盖最低分的 3 个维度, 每维取该维最弱能力点
  function pickWeakAbilitiesByDim(record, n, profile) {
    if (!record || !record.dimScores || !profile || !profile.abilityScores) return [];
    var allDims = D.dimensions.map(function (d) { return d.id; });
    var sortedDims = allDims.slice().sort(function (a, b) {
      return (record.dimScores[a] || 0) - (record.dimScores[b] || 0);
    });
    var out = [];
    for (var i = 0; i < sortedDims.length && out.length < n; i++) {
      var dim = sortedDims[i];
      var abl = profile.abilityScores[dim] || {};
      var ranked = Object.keys(abl).map(function (k) { return { k: k, s: abl[k] }; })
        .sort(function (a, b) { return a.s - b.s; });
      if (ranked.length) out.push({ dim: dim, ability: ranked[0].k, score: ranked[0].s });
    }
    return out;
  }

  // v0.8.7 P0-2.2: 个体化解读改为「按 dimScores 升序取最低维度, 在该维度内取最弱能力点」选 3 条动作,
  // 不再用 globalWeakAbilities (v0.8.6 全卷最弱会在题数+能力点最多的 D1 偏 74.7%)
  // 容错链: ACTION_DICT[weakDim][weakAbl] 第 1 能力 → 同维度下一弱 → 次低维度 → CORE_ADVICE 模板
  function buildAdviceForRecord(record) {
    var ACTION = D.reports.actionDict || {};
    var items = [];
    if (!record) return D.reports.coreAdvice.L1;
    if (!record.dimScores) return D.reports.coreAdvice[record.levelId] || D.reports.coreAdvice.L1;
    var profile = analyzeProfile(record);
    // 1. dimScores 升序, 取最低维度 (按全部 6 维排, 缺的当 0, 这正是要发现的「未作答」盲区)
    var allDims = D.dimensions.map(function (d) { return d.id; });
    var sortedDims = allDims.slice().sort(function (a, b) {
      return (record.dimScores[a] || 0) - (record.dimScores[b] || 0);
    });
    // 2. 同维度内 abilityScores 升序, 取最弱能力点
    function pickActsInDim(dim) {
      var abl = (profile.abilityScores && profile.abilityScores[dim]) || {};
      var ranked = Object.keys(abl).map(function (k) { return { k: k, s: abl[k] }; })
        .sort(function (a, b) { return a.s - b.s; });
      for (var i = 0; i < ranked.length; i++) {
        var acts = ACTION[dim] && ACTION[dim][ranked[i].k];
        if (acts && acts.length) return { ability: ranked[i].k, score: ranked[i].s, acts: acts };
      }
      return null;
    }
    var chosen = null;
    for (var di = 0; di < sortedDims.length && !chosen; di++) {
      chosen = pickActsInDim(sortedDims[di]);
      if (chosen) chosen.dim = sortedDims[di];
    }
    if (!chosen) {
      // 全维度都查不到能力点 → 兜底模板 (例如分享链接丢 answers 但 record.levelId 还在)
      return D.reports.coreAdvice[record.levelId] || D.reports.coreAdvice.L1;
    }
    // 3. 拼 3 条: 第 1=最强动作, 第 2=次动作, 第 3=同能力点的延展动作 (若有) 否则次维度最弱
    var acts = chosen.acts;
    var dimName = (D.dimensions.find(function (x) { return x.id === chosen.dim; }) || {}).name || chosen.dim;
    items.push({
      t: '本周重点练: ' + chosen.ability + ' · ' + chosen.dim + ' (' + (record.dimScores[chosen.dim] || 0) + ' 分 · ' + dimName + ')',
      d: acts[0].t + ' · ' + acts[0].d
    });
    if (acts[1]) {
      items.push({ t: '推进路径: ' + acts[1].t, d: acts[1].d });
    } else if (acts[0]) {
      items.push({ t: '推进路径: ' + acts[0].t, d: acts[0].d });
    }
    // 第 3 条: 同能力点动作池第 3 条; 不足则取「次弱维度」的最弱能力点
    if (acts[2]) {
      items.push({ t: '继续: ' + acts[2].t, d: acts[2].d });
    } else {
      var nextDim = sortedDims.find(function (x) { return x !== chosen.dim; });
      if (nextDim) {
        var nextActs = ACTION[nextDim] && Object.keys(ACTION[nextDim])
          .map(function (k) { return { k: k, arr: ACTION[nextDim][k] }; })
          .sort(function (a, b) { return (record.dimScores[nextDim] || 0) - 0; });
        // 简化: 取 ACTION_DICT[nextDim] 的第一个有内容的 ability
        if (nextActs && nextActs.length) {
          for (var j = 0; j < nextActs.length; j++) {
            if (nextActs[j].arr && nextActs[j].arr[0]) {
              items.push({ t: '扩展边界: ' + nextActs[j].k, d: nextActs[j].arr[0].t + ' · ' + nextActs[j].arr[0].d });
              break;
            }
          }
        }
      }
      if (items.length < 3) items.push((D.reports.coreAdvice[record.levelId] || D.reports.coreAdvice.L1)[2] || (D.reports.coreAdvice[record.levelId] || D.reports.coreAdvice.L1)[0]);
    }
    return items;
  }

  function buildAdvice(level) {
    // 兼容层: 旧调用走模板; 新调用请用 buildAdviceForRecord(record)
    return D.reports.coreAdvice[level.id] || D.reports.coreAdvice.L1;
  }
  function buildTip(level) { return D.reports.levelTips[level.id] || D.reports.levelTips.L1; }
  function buildTipForRecord(record) {
    var TIP = D.reports.levelTips;
    // v0.8.6: 段位提示保持模板 (它是段位定性, 不是行动建议)
    var id = (record && record.levelId) || 'L1';
    return TIP[id] || TIP.L1;
  }

  /* ---------- 全局状态 ---------- */
  var state = {
    packId: 'none',
    mode: 'blended',
    questions: [],
    weights: null,
    answers: {},
    index: 0,
    result: null,
    shared: false,
    info: null            // 测评人信息 {name,company,position,batch,notes}
  };

  /* ---------- 路由 ---------- */
  var VIEW_TITLES = { home: '个人AI办公能力测评', info: '测评人信息', quiz: '答题中', result: '测评结果', history: '历史记录', about: '关于与隐私' };
  function showView(name) {
    $all('.view').forEach(function (v) { v.hidden = true; v.classList.remove('is-active'); });
    var el = $('#view-' + name);
    el.hidden = false; el.classList.add('is-active');
    $('#appbarTitle').textContent = VIEW_TITLES[name] || '';
    $('#btnBack').hidden = (name === 'home');
    window.scrollTo(0, 0);
  }
  function goHome() { showView('home'); renderHome(); }

  /* ============ 首页 ============ */
  function renderHome() {
    $('#heroVersion').textContent = D.meta.framework;
    // 卷别
    var packs = [{ id: 'none', kind: 'general', name: '通用版', desc: '6 维度通用场景，适合全员普查与横向对比（产品主入口）', tag: '共 ' + D.core.length + ' 题' }]
      .concat(D.packs.map(function (p) {
        return { id: p.id, kind: 'specialized', name: p.name, desc: p.desc, tag: '加 ' + p.questions.length + ' 题 · 共 ' + (D.core.length + p.questions.length) + ' 题' };
      }));
    var list = $('#packList');
    list.innerHTML = packs.map(function (p) {
      var sel = (p.id === state.packId) ? ' selected' : '';
      return '' +
        '<div class="pack' + sel + '" data-pack="' + p.id + '">' +
        '<div class="pack-radio"></div>' +
        '<div class="pack-main">' +
        '<div class="pack-name">' + esc(p.name) + '</div>' +
        '<div class="pack-desc">' + esc(p.desc) + '</div>' +
        '<span class="pack-tag">' + esc(p.tag) + '</span>' +
        '</div></div>';
    }).join('');
    $all('.pack', list).forEach(function (node) {
      node.addEventListener('click', function () {
        state.packId = node.getAttribute('data-pack');
        renderHome();
      });
    });
    // 专项测法
    var isSpec = state.packId !== 'none';
    $('#modeCard').hidden = !isSpec;
    if (isSpec) {
      var p = D.packs.find(function (x) { return x.id === state.packId; });
      $('#modeBlendedDesc').textContent = '通用 ' + D.core.length + ' 题 + 专项 ' + p.questions.length + ' 题';
      // 单独成卷门槛: 必须已有可合并的通用测评记录 (P1-3.1: 必须同 qVersion)
      var compat = findCompatibleGeneralRecord();
      var hasGeneral = !!compat.compat;
      var hasCrossVersion = compat.any && !compat.compat;
      var saInput = $('.mode-opt input[value="standalone"]');
      var saOpt = saInput ? (saInput.closest ? saInput.closest('.mode-opt') : null) : null;
      if (saInput) saInput.disabled = !hasGeneral;
      if (saOpt) saOpt.classList.toggle('disabled', !hasGeneral);
      var descText;
      if (hasGeneral) {
        descText = '只做本专项 ' + p.questions.length + ' 题 · 完成后与最近通用测评合并出分';
      } else if (hasCrossVersion) {
        descText = '你之前的通用测评是旧版本, 单独成卷前请先重答当前通用卷';
      } else {
        descText = '需先完成通用测评(' + D.core.length + ' 题)后才可单独成卷';
      }
      $('#modeStandaloneDesc').textContent = descText;
      if (!hasGeneral && state.mode === 'standalone') state.mode = 'blended';
      var modeInput = $('.mode-opt input[value="' + state.mode + '"]');
      if (modeInput) modeInput.checked = true;
    }
    // 续答横幅: 0 题已答的"空进度"视为无进度, 静默清理, 避免误报"检测到未完成的测评"
    var prog = loadProgress();
    if (prog && (prog.answeredCount || 0) === 0) { clearProgress(); prog = null; }
    var banner = $('#resumeBanner');
    if (prog && prog.answeredCount < prog.total) {
      banner.hidden = false;
      $('#resumeInfo').textContent = packName(prog.packId) + ' · 已答 ' + prog.answeredCount + '/' + prog.total + ' 题';
    } else {
      banner.hidden = true;
    }
  }

  /* ============ 测评人信息 ============ */
  function gotoInfo() {
    // 新一次测评: 清空表单后进入信息页
    $('#infoName').value = '';
    $('#infoCompany').value = '';
    $('#infoPosition').value = '';
    $('#infoBatch').value = '';
    $('#infoNotes').value = '';
    showView('info');
  }
  function startFromInfo() {
    var name = ($('#infoName').value || '').trim();
    var company = ($('#infoCompany').value || '').trim();
    var position = ($('#infoPosition').value || '').trim();
    if (!name || !company || !position) {
      alert('请先填写姓名、公司、岗位（均可虚拟填写）后再开始测评。');
      return;
    }
    state.info = {
      name: name,
      company: company,
      position: position,
      batch: ($('#infoBatch').value || '').trim(),
      notes: ($('#infoNotes').value || '').trim()
    };
    startFresh();
  }

  /* ============ 答题 ============ */
  function startFresh() {
    // state.mode 已由专项测法单选的 change 事件维护, 直接复用, 避免依赖 :checked 选择器
    state.questions = buildQuestions(state.packId, state.mode);
    state.weights = packWeights(state.packId);
    state.answers = {};
    state.index = 0;
    saveProgress();
    showView('quiz');
    renderQuestion();
  }
  function resumeProgress() {
    var prog = loadProgress();
    if (!prog) { startFresh(); return; }
    state.packId = prog.packId;
    state.mode = prog.mode;
    state.questions = buildQuestions(state.packId, state.mode);
    state.weights = packWeights(state.packId);
    state.answers = prog.answers || {};
    state.info = prog.info || null;
    state.index = Math.min(prog.index || 0, state.questions.length - 1);
    showView('quiz');
    renderQuestion();
  }
  function renderQuestion() {
    var i = state.index, q = state.questions[i], N = state.questions.length;
    $('#quizCounter').textContent = '第 ' + (i + 1) + ' / ' + N + ' 题';
    $('#quizPackTag').textContent = packName(state.packId) + (state.packId !== 'none' && state.mode === 'standalone' ? '（单独成卷）' : '');
    $('#quizBarFill').style.width = (((i + 1) / N) * 100) + '%';

    var html = '';
    if (q.scene) html += '<div class="quiz-scene">' + esc(q.scene) + '</div>';
    html += '<p class="quiz-q">' + esc(q.question) + '</p>';
    html += '<div class="quiz-options">';
    var sc = qScores(q);
    ['A', 'B', 'C', 'D'].forEach(function (L) {
      var sel = (state.answers[q.id] === sc[L]) ? ' selected' : '';
      html += '' +
        '<div class="opt' + sel + '" data-letter="' + L + '">' +
        '<div class="opt-letter">' + L + '</div>' +
        '<div class="opt-text">' + esc(q.options[L]) + '</div>' +
        '</div>';
    });
    html += '</div>';
    var card = $('#quizCard');
    card.innerHTML = html;

    $all('.opt', card).forEach(function (node) {
      node.addEventListener('click', function () {
        var L = node.getAttribute('data-letter');
        state.answers[q.id] = qScores(q)[L];
        $all('.opt', card).forEach(function (n) { n.classList.remove('selected'); });
        node.classList.add('selected');
        saveProgress();
      });
    });

    $('#btnPrev').disabled = (i === 0);
    $('#btnNext').textContent = (i === N - 1) ? '提交测评' : '下一题';
  }
  function nextQuestion() {
    var N = state.questions.length;
    if (state.index === N - 1) { submit(); return; }
    state.index++;
    saveProgress();
    renderQuestion();
  }
  function prevQuestion() {
    if (state.index === 0) return;
    state.index--;
    renderQuestion();
  }
  function submit() {
    var N = state.questions.length;
    var answered = Object.keys(state.answers).length;
    if (answered < N) {
      if (!window.confirm('还有 ' + (N - answered) + ' 题未作答，确定提交？未答题目不计入得分。')) return;
    }
    var res = calcResult(state.questions, state.answers, state.weights);
    var record = {
      packId: state.packId,
      mode: state.mode,
      isStandalone: (state.packId !== 'none' && state.mode === 'standalone'),
      packName: packName(state.packId),
      answers: state.answers,
      total: res.total,
      levelId: res.level.id,
      levelName: res.level.name,
      dimScores: res.dimScores,
      qcount: N,
      info: state.info || null,
      // v0.8.5: 记录/分享带 qVersion, 后台 byPack 按 (packId, qVersion) 分组避免混池
      qVersion: D.meta.questionSetVersion,
      framework: D.meta.framework,
      clientId: getClientId(),
      ts: Date.now()
    };
    // 单独成卷: 与最近一次含通用作答的记录合并, 按 blended 同口径重新出分
    if (record.isStandalone) {
      var g = findGeneralRecord();
      if (g && g.answers) {
        var coreIds = {};
        D.core.forEach(function (q) { coreIds[q.id] = 1; });
        var mergedAnswers = {};
        Object.keys(g.answers).forEach(function (qid) { if (coreIds[qid]) mergedAnswers[qid] = g.answers[qid]; });
        Object.keys(state.answers).forEach(function (qid) { mergedAnswers[qid] = state.answers[qid]; });
        var bq = buildQuestions(state.packId, 'blended');
        var mres = calcResult(bq, mergedAnswers, null);
        record.merged = true;
        record.mergedFromTs = g.ts || null;
        record.mergedFromPack = g.packName || '通用版';
        record.standaloneTotal = res.total;
        record.standaloneLevelId = res.level.id;
        record.standaloneLevelName = res.level.name;
        record.answers = mergedAnswers;
        record.total = mres.total;
        record.levelId = mres.level.id;
        record.levelName = mres.level.name;
        record.dimScores = mres.dimScores;
        record.qcount = bq.length;
      }
    }
    saveHistory(record);
    flushPendingSync();
    syncToServer(record);
    clearProgress();
    renderResult(record, { shared: false });
  }

  /* ============ 结果 ============ */
  // v0.8.6: 解读基于作答画像生成, 30 天路线取 ACTION_DICT, 复盘默认折叠到本次解读相关题
  function renderResult(record, opts) {
    state.result = record;
    state.shared = !!(opts && opts.shared);
    var level = { id: record.levelId, name: record.levelName };
    var dimScores = record.dimScores || {};
    var profile = analyzeProfile(record);
    var advice = buildAdviceForRecord(record);
    var tip = buildTipForRecord(record);
    var map = buildLearningMap(dimScores, profile.abilityScores);
    var weak = weakDims(dimScores, 2);

    var html = '';
    // 等级卡
    html += '' +
      '<div class="level-card lvl-' + esc(record.levelId) + '">' +
      '<div class="lvl-badge">' + esc(record.levelId) + '</div>' +
      '<p class="lvl-name">' + esc(record.levelName) + '</p>' +
      '<p class="lvl-sub">' + esc(levelSub(record.levelId)) + '</p>' +
      '<div class="level-score"><span class="num">' + record.total + '</span><span class="max">/ 100</span></div>' +
      '<div class="level-pack">' + esc(record.packName) +
        (record.isStandalone ? (record.merged ? ' · 单独成卷 · 已合并通用测评' : ' · 单独成卷') : '') + '</div>' +
      (record.isStandalone && record.merged ?
        '<div class="level-merge-note">本卷已与你 ' + esc(dateStrOf(record.mergedFromTs)) + ' 的「' + esc(record.mergedFromPack || '通用版') +
        '」记录合并出分（通用 ' + D.core.length + ' 题 + 本专项）。专项单独得分：' + (record.standaloneTotal != null ? record.standaloneTotal : '—') +
        ' 分' + (record.standaloneLevelId ? '（' + esc(record.standaloneLevelId) + ' ' + esc(record.standaloneLevelName || '') + '）' : '') + '</div>' : '') +
      (record.info && (record.info.name || record.info.company || record.info.position || record.info.batch) ?
        '<div class="level-person">' + esc(record.info.name || '匿名') +
        (record.info.company ? ' · ' + esc(record.info.company) : '') +
        (record.info.position ? ' · ' + esc(record.info.position) : '') +
        (record.info.batch ? ' · 批次 ' + esc(record.info.batch) : '') + '</div>' : '') +
      '</div>';
    // 雷达
    html += '<div class="block"><div class="block-h">六维能力雷达 <span class="badge">6 维度</span></div><div class="radar-wrap">' + radarSVG(dimScores) + '</div></div>';
    // 维度明细
    html += '<div class="block"><div class="block-h">维度得分</div>' + dimRows(dimScores) + '</div>';
    // 个体化解读 (基于作答画像)
    // v0.8.9 P2-4: 明确画像口径 —— 专项题无 abilities 标签, 画像仅由通用卷作答推导;
    //   在专项卷/合并卷下加一句说明, 避免用户误以为专项题也参与了画像
    var profileScopeNote = (record.packId && record.packId !== 'none')
      ? ' <span class="badge" title="专项题不含能力点标签, 画像仅由通用卷作答生成">画像口径: 基于通用卷作答</span>'
      : '';
    html += '<div class="block"><div class="block-h">最该做的 3 件事 <span class="badge">基于本次作答 · 个体化</span>' + profileScopeNote + '</div>';
    advice.forEach(function (a) {
      html += '<div class="advice-item"><div class="advice-t">' + esc(a.t) + '</div><div class="advice-d">' + esc(a.d) + '</div></div>';
    });
    html += '</div>';
    // 30 天地图 (v0.8.6: 用 ACTION_DICT 取具体动作)
    html += '<div class="block"><div class="block-h">30 天提升路线 <span class="badge">按画像 · 弱项优先</span></div>';
    map.forEach(function (m) {
      var title = m.actionTitle || '本周动作';
      var detail = m.actionDetail || m.d || '';
      html += '<div class="map-item"><div class="map-day">' + esc(m.t) + '<div class="map-dim">' + esc(m.dimName) + '</div></div><div class="map-d"><b>' + esc(title) + '</b> · ' + esc(detail) + '</div></div>';
    });
    html += '</div>';
    // 等级提示
    html += '<div class="block" style="background:var(--blue-soft2)"><div class="advice-d">' + esc(tip) + '</div></div>';
    // 逐题复盘 (v0.8.6: 默认折叠, 仅显示本次解读涉及能力点相关的题, 加切换按钮)
    html += '<div class="block"><div class="block-h">逐题复盘 <span class="badge">' + record.qcount + ' 题</span>' +
      ' <button id="btnReviewToggle" class="btn-mini" style="float:right;font-size:12px;padding:4px 10px;border-radius:14px;border:1px solid var(--ink-3);background:#fff;color:var(--ink-2);cursor:pointer">展开全部题目 ▼</button></div>' +
      '<p class="review-note">计分规则：每题 4 个选项<b>乱序呈现</b>，四个选项分别计 <b>0 / 33.3 / 66.7 / 100 分</b>——各选项对应多少分<b>每题都不同</b>（见各选项后的分值标注）。其中 <b>100 分选项代表该维度「最高成熟度行为」锚点</b>，是框架量表的顶端，并非对所有人唯一正确的解。下方解析说明各选项的适用情境，<b>高亮「你的选择」</b>是本次实际作答。<br>默认折叠到「本次解读提到的题」——点按钮可展开全部。</p>' +
      reviewHTML(record, profile) + '</div>';

    $('#resultBody').innerHTML = html;
    // 绑定复盘折叠切换
    var reviewBox = $('#resultBody .review-list');
    var toggleBtn = $('#btnReviewToggle');
    if (reviewBox && toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        var showAll = reviewBox.getAttribute('data-showall') === '1';
        if (showAll) {
          reviewBox.setAttribute('data-showall', '0');
          toggleBtn.textContent = '展开全部题目 ▼';
          $all('.review-item', reviewBox).forEach(function (el) {
            if (el.getAttribute('data-relevant') === '0') el.hidden = true;
          });
        } else {
          reviewBox.setAttribute('data-showall', '1');
          toggleBtn.textContent = '只看本次解读提到的 ▲';
          $all('.review-item', reviewBox).forEach(function (el) { el.hidden = false; });
        }
      });
    }
    $('#sharedBanner').hidden = !state.shared;
    showView('result');
  }
  function levelSub(id) {
    var l = D.levels.find(function (x) { return x.id === id; });
    return l ? l.subtitle : '';
  }
  function dateStrOf(ts) {
    if (!ts) return '之前';
    var d = new Date(Number(ts));
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function dimRows(dimScores) {
    return D.dimensions.map(function (d) {
      var v = dimScores[d.id] || 0;
      return '' +
        '<div class="dim-row"><div class="dim-row-top"><span class="dn">' + esc(d.name) + '</span><span class="ds">' + v + '</span></div>' +
        '<div class="dim-bar"><div class="dim-bar-fill" style="width:' + v + '%"></div></div></div>';
    }).join('');
  }
  // v0.8.6: 接受 profile 参数, 给每题标 relevant (本次解读提到的能力点) 用于折叠切换
  // v0.8.9 P2-3: 弱项来源由 globalWeakAbilities 改为 pickWeakAbilitiesByDim
  //   (与 buildAdviceForRecord 同款「维度内最弱」逻辑, 修正默认折叠偏 D1 的问题)
  function reviewHTML(record, profile) {
    var qs = buildQuestions(record.packId, record.merged ? 'blended' : record.mode);
    var dimNameOf = function (id) { var d = D.dimensions.find(function (x) { return x.id === id; }); return d ? d.name : id; };
    // 解码能力点评分用于匹配 relevance
    var ablByQ = {};
    if (profile && profile.abilityScores) {
      Object.keys(profile.abilityScores).forEach(function (dim) {
        Object.keys(profile.abilityScores[dim]).forEach(function (a) {
          ablByQ[a] = profile.abilityScores[dim][a];
        });
      });
    }
    // 收集"本次解读提及"的能力点: v0.8.9 P2-3 改为「最弱 3 个维度各取该维最弱能力点」+ 强项 1 个
    //   (旧实现用 globalWeakAbilities = 全卷最弱 3 个, 受 D1 题多+能力点多影响会偏 D1)
    var mentionedAb = {};
    if (profile) {
      pickWeakAbilitiesByDim(record, 3, profile).forEach(function (x) { mentionedAb[x.ability] = 'weak'; });
      (profile.globalStrongAbilities || []).slice(0, 1).forEach(function (a) { mentionedAb[a] = 'strong'; });
    }
    var html = '<div class="review-list" data-showall="0">';
    var shownCount = 0, hiddenCount = 0;
    qs.forEach(function (q) {
      var myScore = record.answers[q.id];
      var myLetter = (myScore != null) ? letterOfScore(q, myScore) : '未答';
      var best = bestLetter(q);
      // 判断该题是否与本次解读有关 (任一 ability 出现在 mentionedAb)
      var qAb = q.abilities || [];
      var relevant = qAb.some(function (a) { return mentionedAb[a]; });
      var hiddenAttr = relevant ? '' : ' hidden';
      if (relevant) shownCount++; else hiddenCount++;
      html += '<div class="review-item" data-relevant="' + (relevant ? '1' : '0') + '"' + hiddenAttr + '>';
      html += '<div class="review-q">' + esc(q.question) + '</div>';
      html += '<div class="review-meta">' + esc(dimNameOf(q.dimension)) + ' · 你的选择：' + myLetter +
        (qAb.length ? ' · 相关能力: ' + esc(qAb.join(' · ')) : '') + '</div>';
      var sc = qScores(q);
      ['A', 'B', 'C', 'D'].forEach(function (L) {
        var cls = 'review-choice';
        var tags = '<span class="tag-score">' + (sc[L] === 100 ? '100' : String(sc[L]).replace(/\.0$/, '')) + ' 分</span>';
        if (myLetter === L) { cls += ' mine'; tags += ' <span class="tag-mine">你的选择</span>'; }
        if (L === best) { cls += ' best'; tags += ' <span class="tag-best">最高成熟度</span>'; }
        html += '<div class="' + cls + '"><span class="lab">' + L + '：</span>' + esc(q.options[L]) + tags + '</div>';
      });
      html += '<div class="review-analysis">解析：' + esc(q.analysis) + '</div></div>';
    });
    html += '</div>';
    if (shownCount === 0 && qs.length > 0) {
      // v0.8.10 P2-4 降级文案: 区分"专项卷作答(暂无能力点级画像)"与"分享链接异常"
      // 此前统一写「画像信息缺失, 已展开全部题目」, 对专项用户不明不白;
      // 专项卷的根因是 54 道专项题尚未打 abilities 标签 (v0.9.0 题库能力点 V2 专项处理),
      // 这里给用户明确的「下一步做什么」, 而不暴露内部标签数据缺失。
      var items = html.match(/<div class="review-item"[^>]*>/g) || [];
      items.forEach(function (m) {
        // 把每个 review-item 的 data-relevant 从 0 改为 1, hidden 去掉
        html = html.replace(m, m.replace('data-relevant="0" hidden', 'data-relevant="1"'));
      });
      html = html.replace('data-showall="0"', 'data-showall="1"');   // 全部展开
      var isSpecialistPack = record.packId && record.packId !== 'none';
      var tip;
      if (isSpecialistPack) {
        // 专项卷作答 — 给「配合通用 32 题获得能力点级解读」的明确引导
        var qcount = qs.length;
        tip = '<div class="review-tip" style="margin:12px 0 4px;padding:10px 14px;background:#f7f8fa;border-radius:10px;font-size:12px;line-height:1.7;color:var(--ink-2)">'
          + '本次为专项卷作答（' + qcount + ' 题），能力点级解读需配合通用 ' + (D.core.length) + ' 题作答开启；'
          + '本次仅按维度+动作给出建议，建议先做一次通用 ' + (D.core.length) + ' 题获得能力点级画像。'
          + '</div>';
      } else {
        // 通用卷/分享链接异常 — 保留兜底说明 (例如分享链接丢了 answers / 旧版本分享被回放)
        tip = '<div class="review-tip" style="margin:12px 0 4px;padding:10px 14px;background:#f7f8fa;border-radius:10px;font-size:12px;line-height:1.7;color:var(--ink-2)">'
          + '画像信息缺失，已展开全部题目（分享链接或作答数据异常）。'
          + '</div>';
      }
      // 把 tip 插到 review-list 闭合之前 (reviewHTML 返回的 html 末尾是 review-list 的 '</div>')
      //   不能 replace('btnReviewToggle') — 那按钮在 renderResult 里, 不在 reviewHTML 内。
      //   找到最后一个 '</div>' 位置, 在它前面插入 tip (review-list 收尾, 不动内部 review-item 的 </div>)
      var lastCloseIdx = html.lastIndexOf('</div>');
      html = html.slice(0, lastCloseIdx) + tip + html.slice(lastCloseIdx);
    }
    return html;
  }

  /* ============ 分享 ============ */
  // v0.8.9 P1-4: 分享 payload 不再带 total/levelId/dimScores(只带 answers + 必要的上下文),
  //   接收方 tryLoadShared() 强制按 answers 重算, 任何人无法伪造分享结果。
  //   payload 仍带 merged/mergedFromPack/standaloneTotal* 等展示信息(来自服务端/前端权威计算,
  //   不影响数值计算), 但 total/levelId/dimScores 必须重算。
  function buildShareURL(record) {
    var payload = {
      t: 'r', v: 1,
      packId: record.packId, mode: record.mode, isStandalone: record.isStandalone,
      packName: record.packName,
      answers: record.answers,
      ts: record.ts,
      qVersion: D.meta.questionSetVersion,
      framework: D.meta.framework,
      merged: record.merged || false, mergedFromPack: record.mergedFromPack || '',
      // 展示信息(不参与重算, 仅文案用): standalone 单独得分是本地权威结果, 但仍不参与伪造 total
      standaloneTotal: record.standaloneTotal,
      standaloneLevelId: record.standaloneLevelId || '', standaloneLevelName: record.standaloneLevelName || ''
    };
    return location.href.split('#')[0] + '#r=' + b64encodeUnicode(JSON.stringify(payload));
  }
  function buildTextSummary(record) {
    var lines = [];
    lines.push('【个人AI办公能力测评 · ' + D.meta.framework + '】');
    lines.push('综合得分：' + record.total + ' / 100 · 等级：' + record.levelId + ' ' + record.levelName);
    lines.push('测评卷：' + record.packName +
      (record.isStandalone ? (record.merged ? '（单独成卷 · 已合并通用测评出分）' : '（单独成卷）') : ''));
    if (record.isStandalone && record.merged) {
      lines.push('已与 ' + dateStrOf(record.mergedFromTs) + ' 的「' + (record.mergedFromPack || '通用版') +
        '」记录合并出分；专项单独得分：' + (record.standaloneTotal != null ? record.standaloneTotal : '—') +
        ' 分' + (record.standaloneLevelId ? '（' + record.standaloneLevelId + ' ' + (record.standaloneLevelName || '') + '）' : ''));
    }
    lines.push('—— 六维得分 ——');
    D.dimensions.forEach(function (d) {
      lines.push('· ' + d.name + '：' + (record.dimScores[d.id] || 0));
    });
    lines.push('—— 最该做的 3 件事 ——');
    buildAdviceForRecord(record).forEach(function (a, i) {
      lines.push((i + 1) + '. ' + a.t + '：' + a.d);
    });
    lines.push('—— 由「个人AI办公能力测评」生成 ——');
    return lines.join('\n');
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); resolve(); }
      catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }
  function b64encodeUnicode(str) {
    // v0.8.8 C-01: 分块拼接, 避免 String.fromCharCode.apply 一次性传超大数组触发 RangeError
    // 块大小 0x8000 = 32768 远小于 V8 apply 上限 (~65535), 留足余量
    var bytes = new TextEncoder().encode(str);
    var chunks = [];
    for (var i = 0; i < bytes.length; i += 0x8000) {
      chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
    }
    return btoa(chunks.join(''));
  }
  function b64decodeUnicode(b64) {
    var bin = atob(b64);
    var bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
    return new TextDecoder().decode(bytes);
  }

  /* ============ 海报 ============ */
  // 主体绘制: QR 码异步加载, 加载完或失败后统一调这里
  function drawPosterBody(ctx, record, qrImg) {
    var W = 750, H = 1080;
    // 背景渐变
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2f6bff'); g.addColorStop(1, '#1746c4');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 装饰光斑
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.beginPath(); ctx.arc(W - 60, 40, 200, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(30, H - 80, 120, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
    // 标题
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.font = '700 40px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('个人AI办公能力测评', W / 2, 90);
    ctx.font = '400 22px -apple-system, "PingFang SC", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('APCA · ' + D.meta.framework, W / 2, 130);
    // 等级 + 分数卡
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    roundRect(ctx, 75, 165, W - 150, 200, 24); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '800 30px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(record.levelName, W / 2, 235);
    ctx.font = '800 96px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(String(record.total), W / 2, 335);
    ctx.font = '400 24px -apple-system, "PingFang SC", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('/ 100 · ' + record.packName, W / 2, 370);
    // 雷达
    drawRadarCanvas(ctx, W / 2, 600, 150, record.dimScores);
    // 强弱项
    var weak = weakDims(record.dimScores, 2);
    var strongTop = D.dimensions.map(function (d) { return { id: d.id, score: record.dimScores[d.id] || 0 }; })
      .sort(function (a, b) { return b.score - a.score; }).slice(0, 2).map(function (x) { return x.id; });
    ctx.textAlign = 'left'; ctx.font = '600 24px -apple-system, "PingFang SC", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText('待提升：' + weak.map(function (id) { return DIM_SHORT[id]; }).join('、'), 75, 815);
    ctx.fillText('优势：' + strongTop.map(function (id) { return DIM_SHORT[id]; }).join('、'), 75, 855);

    // ---- 二维码 (白底圆角 + QR 图), QR 不可用时降级为占位块 ----
    var qrSize = 150;
    var qrX = 75;
    var qrY = 880;
    ctx.fillStyle = '#fff';
    roundRect(ctx, qrX, qrY, qrSize, qrSize, 16); ctx.fill();
    if (qrImg) {
      var pad = 10;
      ctx.drawImage(qrImg, qrX + pad, qrY + pad, qrSize - pad * 2, qrSize - pad * 2);
    } else {
      // 占位降级: 三个定位角 + 中部提示
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.font = '600 16px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText('二维码未载入', qrX + qrSize / 2, qrY + qrSize / 2);
    }
    // 右侧三行文案
    var textX = qrX + qrSize + 30;
    ctx.textAlign = 'left';
    ctx.font = '700 30px -apple-system, "PingFang SC", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText('扫码测你的 AI 段位', textX, qrY + 48);
    ctx.font = '500 20px -apple-system, "PingFang SC", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('6 维度 · 4 等级 · 约 8 分钟', textX, qrY + 84);
    ctx.font = '400 16px -apple-system, "PingFang SC", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(D.meta.questionSetVersion + ' · ' + record.packName + ' · 网页版直入', textX, qrY + 112);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('生成于 ' + new Date(record.ts).toLocaleString('zh-CN'), textX, qrY + 134);
  }

  function downloadPoster(record) {
    var canvas = $('#posterCanvas');
    var ctx = canvas.getContext('2d');
    var qrImg = new Image();
    var done = false;
    function finish(hasQr) {
      if (done) return; done = true;
      drawPosterBody(ctx, record, hasQr ? qrImg : null);
      try {
        var url = canvas.toDataURL('image/png');
        var a = document.createElement('a');
        a.href = url;
        a.download = 'AI办公能力测评_' + record.total + '分_' + D.meta.questionSetVersion + '.png';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        toast('海报已下载');
      } catch (e) {
        toast('海报生成失败：' + e.message);
      }
    }
    qrImg.onload = function () { finish(true); };
    qrImg.onerror = function () { finish(false); };
    // 用版本号做查询串绕过缓存 (QR 文件随版本可能重生成)
    qrImg.src = 'qrcode.png?v=' + encodeURIComponent(D.meta.questionSetVersion);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawRadarCanvas(ctx, cx, cy, R, dimScores) {
    var dims = D.dimensions, n = dims.length;
    function ang(i) { return (-90 + i * 360 / n) * Math.PI / 180; }
    ctx.save();
    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      ctx.beginPath();
      for (var i = 0; i <= n; i++) {
        var a = ang(i % n), r = R * f;
        var x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    // 轴
    dims.forEach(function (d, i) {
      var a = ang(i);
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a)); ctx.stroke();
    });
    // 数据多边形
    ctx.beginPath();
    dims.forEach(function (d, i) {
      var v = dimScores[d.id] || 0, a = ang(i), r = R * v / 100;
      var x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.30)'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    // 顶点
    dims.forEach(function (d, i) {
      var v = dimScores[d.id] || 0, a = ang(i), r = R * v / 100;
      ctx.beginPath(); ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#fff'; ctx.fill();
    });
    // 标签
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.textAlign = 'center';
    ctx.font = '500 18px -apple-system, "PingFang SC", sans-serif';
    dims.forEach(function (d, i) {
      var a = ang(i);
      ctx.fillText(DIM_SHORT[d.id], cx + (R + 26) * Math.cos(a), cy + (R + 26) * Math.sin(a) + 6);
    });
    ctx.restore();
  }

  /* ============ v0.8.1 计分锚点迁移 ============ */
  // v0.8.1 修正了 12 道通用题的"分值↔内容"错位 (此前解析公认最优的行为曾被计 0 分)。
  // 对修正前的作答数据按置换表换算分值, 并重算总分/维度分/等级, 保证复盘展示正确。
  var ANCHOR_CUTOFF = Date.UTC(2026, 8, 3, 17, 0, 0); // 2026-09-04 01:00 GMT+8 (v0.8.1 上线时点)
  var ANCHOR_FIX = {
    'D2-1': { 0: 100, 33.3: 66.7, 66.7: 0, 100: 33.3 },
    'D3-1': { 0: 0, 33.3: 66.7, 66.7: 100, 100: 33.3 },
    'D3-3': { 0: 100, 33.3: 33.3, 66.7: 0, 100: 66.7 },
    'D3-5': { 0: 33.3, 33.3: 66.7, 66.7: 100, 100: 0 },
    'D4-1': { 0: 100, 33.3: 33.3, 66.7: 66.7, 100: 0 },
    'D4-2': { 0: 100, 33.3: 33.3, 66.7: 0, 100: 66.7 },
    'D4-4': { 0: 0, 33.3: 100, 66.7: 66.7, 100: 33.3 },
    'D4-5': { 0: 0, 33.3: 100, 66.7: 33.3, 100: 66.7 },
    'D5-1': { 0: 66.7, 33.3: 0, 66.7: 100, 100: 33.3 },
    'D5-4': { 0: 0, 33.3: 33.3, 66.7: 100, 100: 66.7 },
    'D5-5': { 0: 66.7, 33.3: 100, 66.7: 33.3, 100: 0 },
    'D6-5': { 0: 0, 33.3: 66.7, 66.7: 100, 100: 33.3 }
  };
  function migrateAnchorRecord(r) {
    if (!r || !r.answers) return false;
    if (!r.ts || r.ts >= ANCHOR_CUTOFF) return false; // v0.8.1 之后的数据无需迁移
    var touched = false;
    Object.keys(ANCHOR_FIX).forEach(function (qid) {
      var s = r.answers[qid];
      if (s != null && ANCHOR_FIX[qid][s] != null && ANCHOR_FIX[qid][s] !== s) {
        r.answers[qid] = ANCHOR_FIX[qid][s];
        touched = true;
      }
    });
    if (!touched) return false;
    var qs = buildQuestions(r.packId, (r.merged ? 'blended' : r.mode) || 'none');
    var w = (r.mode === 'standalone' && !r.merged) ? packWeights(r.packId) : null;
    var res = calcResult(qs, r.answers, w);
    r.total = res.total; r.dimScores = res.dimScores;
    r.levelId = res.level.id; r.levelName = res.level.name;
    return true;
  }

  /* ============ 历史 ============ */
  function loadHistory() {
    var list;
    try { list = JSON.parse(localStorage.getItem(K_HISTORY) || '[]'); } catch (e) { return []; }
    if (!Array.isArray(list)) return [];
    var changed = false;
    list.forEach(function (r) { if (migrateAnchorRecord(r)) changed = true; });
    if (changed) { try { localStorage.setItem(K_HISTORY, JSON.stringify(list)); } catch (e) {} }
    return list;
  }
  // 可作为"单独成卷"合并基础的记录: 通用版本身、任一加测卷(已含完整通用作答)、
  // 或此前合并结果(同样含完整通用作答)。loadHistory 最新在前, 取首条即最近一次。
  // v0.8.7 P1-3.1: 跨版本不合并 (qVersion 不一致时跳过, 提示用户重测通用卷)
  function findGeneralRecord() {
    var list = loadHistory();
    var currentVer = (D.meta && D.meta.questionSetVersion) || (D.meta && D.meta.framework) || '';
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r) continue;
      if (r.packId === 'none' || r.mode === 'blended' || r.merged) {
        // 跨版本隔离: 只合并同版本记录; 不同时返回 null, 调用方会识别为「需重测通用卷」
        if (currentVer && r.qVersion && r.qVersion !== currentVer) continue;
        return r;
      }
    }
    return null;
  }
  // v0.8.7 P1-3.1: 上报的"是否存在可合并通用卷"提示, 区分「没有」与「有但跨版本」
  function findCompatibleGeneralRecord() {
    var list = loadHistory();
    var currentVer = (D.meta && D.meta.questionSetVersion) || (D.meta && D.meta.framework) || '';
    var hasAny = false, hasCompat = null;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r) continue;
      if (r.packId === 'none' || r.mode === 'blended' || r.merged) {
        hasAny = true;
        if (!currentVer || !r.qVersion || r.qVersion === currentVer) {
          if (!hasCompat) hasCompat = r;
        }
      }
    }
    return { any: hasAny, compat: hasCompat };
  }
  function saveHistory(record) {
    if (state.shared) return; // 分享结果不落本地
    var list = loadHistory();
    list.unshift(record);
    if (list.length > 20) list = list.slice(0, 20);
    localStorage.setItem(K_HISTORY, JSON.stringify(list));
  }
  // 本机稳定标识: 便于后台按终端归并同一人的多次提交
  var K_CLIENT = 'apca_client_v1';
  function getClientId() {
    try {
      var id = localStorage.getItem(K_CLIENT);
      if (!id) {
        id = 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        localStorage.setItem(K_CLIENT, id);
      }
      return id;
    } catch (e) { return 'c_unknown'; }
  }
  // 若站点由 server/server.js 托管, 则同步提交一份用于后台汇总;
  // 纯静态打开(file://)或静态托管时静默失败, 仅留本机 —— 不影响测评本身。
  // v0.8.7 P1-3.2: 同步成功 toast 提示, 失败给重试入口 (不再静默)
  // v0.8.7 P1-3.2: 上次同步失败留了 pending, 这次提交时先尝试再发
  function flushPendingSync() {
    try {
      var s = localStorage.getItem('apca_pending_sync_v1');
      if (!s) return;
      var prev = JSON.parse(s);
      if (!prev || typeof fetch !== 'function' || location.protocol === 'file:') return;
      fetch('api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prev)
      }).then(function (r) {
        if (r.ok) localStorage.removeItem('apca_pending_sync_v1');
      }).catch(function () {});
    } catch (_) {}
  }
  function syncToServer(record) {
    try {
      if (typeof fetch !== 'function' || location.protocol === 'file:') return;
      fetch('api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      }).then(function (r) {
        if (r.ok) {
          // 服务端可能因 total 偏差拒绝 (400), 需看 body
          return r.json().then(function (b) {
            if (b && b.ok) toast('已保存到服务端');
            else toast('服务端校验未通过: ' + (b && b.error || '未知'));
          }).catch(function () { toast('已保存到服务端'); });
        } else {
          toast('同步失败 (HTTP ' + r.status + ')，结果仅保存到本机');
        }
      }).catch(function () {
        // 网络错误 / fetch 抛异常: 提供重试 (持久化状态供下一次重试)
        try { localStorage.setItem('apca_pending_sync_v1', JSON.stringify(record)); } catch (_) {}
        toast('同步失败：网络不可达，结果仅保存到本机（会在下次提交时自动重试）');
      });
    } catch (e) { /* 忽略: 无服务端时仅留本机 */ }
  }
  function renderHistory() {
    var list = loadHistory();
    var box = $('#historyList');
    var empty = $('#historyEmpty');
    var clearBtn = $('#btnClearHistory');
    if (!list.length) {
      box.innerHTML = ''; empty.hidden = false; clearBtn.hidden = true; return;
    }
    empty.hidden = true; clearBtn.hidden = false;
    box.innerHTML = list.map(function (r, idx) {
      var lvlClass = 'lvl-' + r.levelId;
      var date = new Date(r.ts);
      var dateStr = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
      return '' +
        '<div class="hist-item" data-idx="' + idx + '">' +
        '<div class="hist-score ' + lvlClass + '">' + r.total + '</div>' +
        '<div class="hist-main"><div class="hist-lvl">' + esc(r.levelName) + ' <span style="font-weight:400;color:var(--ink-3);font-size:12px">' + r.levelId + '</span></div>' +
        '<div class="hist-meta">' + (r.info && r.info.name ? esc(r.info.name) + ' · ' : '') + dateStr + ' · ' + esc(r.packName) + (r.isStandalone ? (r.merged ? '（单卷·已合并通用）' : '（单独成卷）') : '') + ' · ' + r.qcount + ' 题</div></div>' +
        '<div class="hist-del" data-del="' + idx + '">🗑</div>' +
        '</div>';
    }).join('');
    $all('.hist-item', box).forEach(function (node) {
      node.addEventListener('click', function (e) {
        if (e.target.getAttribute('data-del') != null) return;
        var idx = +node.getAttribute('data-idx');
        renderResult(list[idx], { shared: false });
      });
    });
    $all('.hist-del', box).forEach(function (node) {
      node.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = +node.getAttribute('data-del');
        if (!window.confirm('删除这条测评记录？')) return;
        var l = loadHistory(); l.splice(idx, 1);
        localStorage.setItem(K_HISTORY, JSON.stringify(l));
        renderHistory();
      });
    });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /* ============ 关于 ============ */
  function renderAbout() {
    // v0.8.4: 原为硬编码 '题库 v0.7', 与当前版本脱节。改为动态读取 meta。
    $('#aboutVersion').textContent = D.meta.framework + ' · 题库 ' + (D.meta.questionSetVersion || D.meta.framework);
    $('#aboutDimList').innerHTML = D.dimensions.map(function (d) {
      return '<li><div class="dim-name">' + esc(d.name) + '<span class="w">权重 ' + Math.round(d.weight * 100) + '%</span></div>' +
        '<div class="dim-tag">' + esc(d.tagline) + '</div>' +
        '<div class="dim-abil">能力项：' + esc(d.abilities.join(' / ')) + '</div></li>';
    }).join('');
    $('#aboutLevelList').innerHTML = D.levels.map(function (l) {
      return '<li><div class="lvl-chip lvl-' + l.id + '">' + l.id + '</div>' +
        '<div class="lvl-info"><b>' + esc(l.name) + '（' + l.score_range[0] + '-' + l.score_range[1] + '）</b>' +
        '<span>' + esc(l.subtitle) + '</span></div></li>';
    }).join('');
    var lic = D.meta.licenseNote;
    if (lic) { var el = document.getElementById('aboutLicense'); if (el) el.textContent = lic; }
  }

  /* ============ 进度持久化 ============ */
  function saveProgress() {
    var prog = {
      packId: state.packId, mode: state.mode,
      answers: state.answers, index: state.index,
      info: state.info,
      total: state.questions.length,
      answeredCount: Object.keys(state.answers).length,
      ts: Date.now()
    };
    localStorage.setItem(K_PROGRESS, JSON.stringify(prog));
  }
  function loadProgress() {
    var prog;
    try { prog = JSON.parse(localStorage.getItem(K_PROGRESS) || 'null'); } catch (e) { return null; }
    if (prog && migrateAnchorRecord(prog)) {
      try { localStorage.setItem(K_PROGRESS, JSON.stringify(prog)); } catch (e) {}
    }
    return prog;
  }
  function clearProgress() { localStorage.removeItem(K_PROGRESS); }

  /* ============ 雷达 SVG (结果页) ============ */
  function radarSVG(dimScores) {
    var dims = D.dimensions, n = dims.length, size = 320, cx = 160, cy = 160, R = 110;
    function ang(i) { return (-90 + i * 360 / n) * Math.PI / 180; }
    var rings = '';
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var pts = [];
      for (var i = 0; i < n; i++) { var a = ang(i); pts.push((cx + R * f * Math.cos(a)).toFixed(1) + ',' + (cy + R * f * Math.sin(a)).toFixed(1)); }
      rings += '<polygon points="' + pts.join(' ') + '" fill="none" stroke="#e6ebf2" stroke-width="1"/>';
    });
    var axes = '', labels = '';
    dims.forEach(function (d, i) {
      var a = ang(i);
      axes += '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + R * Math.cos(a)).toFixed(1) + '" y2="' + (cy + R * Math.sin(a)).toFixed(1) + '" stroke="#e6ebf2" stroke-width="1"/>';
      labels += '<text x="' + (cx + (R + 22) * Math.cos(a)).toFixed(1) + '" y="' + ((cy + (R + 22) * Math.sin(a)) + 4).toFixed(1) + '" text-anchor="middle" font-size="11" fill="#5a6678">' + esc(DIM_SHORT[d.id]) + '</text>';
    });
    var dpts = [];
    dims.forEach(function (d, i) {
      var v = dimScores[d.id] || 0, a = ang(i), r = R * v / 100;
      dpts.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1));
    });
    var dataPoly = '<polygon points="' + dpts.join(' ') + '" fill="rgba(31,94,255,0.22)" stroke="#1f5eff" stroke-width="2"/>';
    var verts = dpts.map(function (p) { var xy = p.split(','); return '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="3" fill="#1f5eff"/>'; }).join('');
    return '<svg viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">' + rings + axes + dataPoly + verts + labels + '</svg>';
  }

  /* ============ 分享链接解码 ============ */
  // v0.8.9 P1-4: 强制按 payload.answers 重算, 完全不信任 payload 里传过来的 total/levelId/dimScores
  //   旧分享链接可能仍带这些字段(向下兼容), 我们直接无视, 全部按 answers 重新跑 calcResult
  function tryLoadShared() {
    var h = location.hash || '';
    if (h.indexOf('#r=') !== 0) return false;
    try {
      var payload = JSON.parse(b64decodeUnicode(h.slice(3)));
      if (!payload || payload.t !== 'r') return false;
      if (!payload.answers || typeof payload.answers !== 'object') return false;
      // 旧版本链接可能带 v0.8.5 之前的分值锚点, 需迁移
      migrateAnchorRecord(payload);
      // 重算: 用与本地 calcResult 同口径 (app.js:80 / buildQuestions + packWeights)
      var pq = buildQuestions(payload.packId || 'none', payload.merged ? 'blended' : (payload.mode || 'blended'));
      var pw = (payload.mode === 'standalone' && !payload.merged) ? packWeights(payload.packId) : null;
      var pres = calcResult(pq, payload.answers, pw);
      var rec = {
        packId: payload.packId, mode: payload.mode, isStandalone: payload.isStandalone,
        packName: payload.packName,
        // ↓ 以下字段一律按重算结果, 不接收 payload 直传
        total: pres.total, levelId: pres.level.id, levelName: pres.level.name,
        dimScores: pres.dimScores, answers: payload.answers,
        qcount: pq.length, ts: payload.ts,
        merged: payload.merged || false,
        mergedFromPack: payload.mergedFromPack || '',
        standaloneTotal: payload.standaloneTotal,
        standaloneLevelId: payload.standaloneLevelId || '', standaloneLevelName: payload.standaloneLevelName || ''
      };
      renderResult(rec, { shared: true });
      return true;
    } catch (e) { return false; }
  }

  /* ============ 事件绑定 ============ */
  function bindEvents() {
    $('#btnBack').addEventListener('click', function () {
      var active = $('.view.is-active').id;
      if (active === 'quiz') {
        if (window.confirm('退出当前测评？进度已保存，可从首页继续。')) goHome();
      } else if (active === 'result') {
        if (state.shared) { location.hash = ''; goHome(); }
        else goHome();
      } else {
        goHome();
      }
    });
    $('#btnAbout').addEventListener('click', function () { renderAbout(); showView('about'); });

    $('#btnStart').addEventListener('click', gotoInfo);
    $('#btnInfoStart').addEventListener('click', startFromInfo);
    $('#btnResume').addEventListener('click', resumeProgress);
    $('#btnResumeDiscard').addEventListener('click', function () { clearProgress(); renderHome(); });

    $('#btnPrev').addEventListener('click', prevQuestion);
    $('#btnNext').addEventListener('click', nextQuestion);
    $('#btnExit').addEventListener('click', function () {
      if (window.confirm('退出当前测评？进度已保存，可从首页继续。')) goHome();
    });

    $('#linkHistory').addEventListener('click', function (e) { e.preventDefault(); renderHistory(); showView('history'); });
    $('#linkAbout').addEventListener('click', function (e) { e.preventDefault(); renderAbout(); showView('about'); });

    $('#btnCopyText').addEventListener('click', function () {
      if (!state.result) return;
      copyText(buildTextSummary(state.result)).then(function () { toast('文字结果已复制'); }).catch(function () { toast('复制失败，请手动选择'); });
    });
    $('#btnCopyLink').addEventListener('click', function () {
      if (!state.result) return;
      var url = buildShareURL(state.result);
      copyText(url).then(function () { toast('结果链接已复制'); }).catch(function () { toast('复制失败'); });
    });
    $('#btnPoster').addEventListener('click', function () { if (state.result) downloadPoster(state.result); });
    $('#btnRetake').addEventListener('click', function () { goHome(); });
    $('#btnResultHistory').addEventListener('click', function () { renderHistory(); showView('history'); });
    $('#btnResultHome').addEventListener('click', goHome);
    $('#linkTakeMine').addEventListener('click', function (e) { e.preventDefault(); location.hash = ''; goHome(); });

    $('#btnEmptyStart').addEventListener('click', goHome);
    $('#btnClearHistory').addEventListener('click', function () {
      if (!window.confirm('清空全部测评记录？此操作不可恢复。')) return;
      localStorage.removeItem(K_HISTORY); renderHistory();
    });

    // 模式切换
    $all('.mode-opt input').forEach(function (inp) {
      inp.addEventListener('change', function () { state.mode = inp.value; });
    });

    window.addEventListener('hashchange', function () {
      if ((location.hash || '').indexOf('#r=') === 0) tryLoadShared();
    });
  }

  /* ============ 启动 ============ */
  // 检测后台服务: 连接时首页文案说明结果会同步汇总; 纯静态打开(无服务端)时回退为"仅留本机"
  function detectServerMode() {
    try {
      if (typeof fetch !== 'function' || location.protocol === 'file:') {
        var el0 = document.getElementById('homePrivacy');
        if (el0) el0.textContent = '🔒 数据仅保存在本机浏览器，不上传任何服务器。';
        return;
      }
      fetch('api/ping').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!(d && d.ok)) {
          var el = document.getElementById('homePrivacy');
          if (el) el.textContent = '🔒 数据仅保存在本机浏览器，不上传任何服务器。';
        }
      }).catch(function () {
        var el = document.getElementById('homePrivacy');
        if (el) el.textContent = '🔒 数据仅保存在本机浏览器，不上传任何服务器。';
      });
    } catch (e) { /* 忽略 */ }
  }
  function init() {
    if (!D) { document.body.innerHTML = '<p style="padding:24px">数据加载失败：data.js 未找到。</p>'; return; }
    bindEvents();
    detectServerMode();
    loadHistory(); // 启动即完成 v0.8.1 锚点迁移 (如有旧记录, 换算并回写)
    if (!tryLoadShared()) {
      state.packId = 'none'; state.mode = 'blended';
      renderHome();
      showView('home');
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
