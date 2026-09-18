// tools/verify-web.js
// 校验 web 版: ① data.js 形态正确 ② 网站计分与 miniprogram calc.js 完全一致
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const MP = path.join(ROOT, 'miniprogram');

let fail = 0, pass = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + msg); } }

// —— 1. 加载 web/data.js ——
const code = fs.readFileSync(path.join(WEB, 'data.js'), 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const DATA = sandbox.window.APCA_DATA;

ok(!!DATA, 'APCA_DATA 已加载');
ok(DATA.dimensions.length === 6, '维度数 = 6, 实际 ' + (DATA.dimensions || []).length);
ok(DATA.levels.length === 4, '等级数 = 4, 实际 ' + (DATA.levels || []).length);
ok(JSON.stringify(DATA.scoreMap) === JSON.stringify({ A: 0, B: 33.3, C: 66.7, D: 100 }), 'scoreMap 正确');
ok(DATA.core.length === 32, '通用题 = 32 (v0.8.6 加 D3-6/D3-7), 实际 ' + DATA.core.length);
ok(DATA.packs.length === 3, '专项包 = 3, 实际 ' + DATA.packs.length);
DATA.packs.forEach(p => {
  ok(p.questions.length === 18, p.id + ' 专项题 = 18, 实际 ' + p.questions.length);
  const sum = Object.values(p.weights).reduce((a, b) => a + b, 0);
  ok(Math.abs(sum - 1) < 1e-6, p.id + ' weights 和 = 1, 实际 ' + sum);
});
ok(DATA.reports && DATA.reports.learningTips && DATA.reports.coreAdvice && DATA.reports.levelTips, 'reports.RAW 三件套齐全');

// —— 1.5 v0.8 选项乱序校验 ——
const { shuffleQuestion, permOf } = require(path.join(__dirname, 'lib', 'shuffle.js'));
const srcCore = require(path.join(MP, 'data', 'core.js'));
const srcPacks = require(path.join(MP, 'data', 'packs.js'));
const srcAll = srcCore.concat(...srcPacks.map(p => p.questions));
const srcById = {}; srcAll.forEach(q => { srcById[q.id] = q; });
const webAll = DATA.core.concat(...DATA.packs.map(p => p.questions));

// v0.8.4: 原为硬编码 'v0.8.3', 每次发版都得改脚本。改为从单点真值 build-web-data.js 读取。
const EXPECT_V = (fs.readFileSync(path.join(__dirname, 'build-web-data.js'), 'utf8')
  .match(/questionSetVersion:\s*'([^']+)'/) || [])[1];
ok(DATA.meta.questionSetVersion === EXPECT_V,
  'questionSetVersion = ' + EXPECT_V + ', 实际 ' + DATA.meta.questionSetVersion);

// 1) 每题 scores 是四档分值的合法排列
let permOk = 0, dist = { A: 0, B: 0, C: 0, D: 0 };
webAll.forEach(q => {
  const vals = ['A', 'B', 'C', 'D'].map(L => q.scores && q.scores[L]).sort((a, b) => a - b);
  if (JSON.stringify(vals) === JSON.stringify([0, 33.3, 66.7, 100])) permOk++;
  ['A', 'B', 'C', 'D'].forEach(L => { if (q.scores && q.scores[L] === 100) dist[L]++; });
});
ok(permOk === webAll.length, '每题 scores 均为 0/33.3/66.7/100 的排列, 实际 ' + permOk + '/' + webAll.length);

// 2) 乱序生效: 不再"总选 D 得高分" (D 持 100 分的题数应明显少于总题量)
ok(dist.D < webAll.length * 0.4, 'D 不再默认最高分 (D=100 题数 ' + dist.D + '/' + webAll.length + ')');
ok(['A', 'B', 'C', 'D'].every(L => dist[L] > 0), '四个字母均有机会持有最高分选项 ' + JSON.stringify(dist));

// 3) 内容等价: 每题选项文本多重集与源一致 (乱序只换位置不换内容)
let contentOk = 0;
webAll.forEach(q => {
  const s = srcById[q.id];
  const a = ['A', 'B', 'C', 'D'].map(L => q.options[L]).sort().join('||');
  const b = ['A', 'B', 'C', 'D'].map(L => s.options[L]).sort().join('||');
  if (a === b) contentOk++;
});
ok(contentOk === webAll.length, '每题选项文本与源数据多重集一致, 实际 ' + contentOk + '/' + webAll.length);

// 4) 乱序结果可复现: 用同一 shuffle 库重算, 选项/分值/解析应逐字节一致
let reproOk = 0;
webAll.forEach(q => {
  const expect = shuffleQuestion(srcById[q.id], DATA.scoreMap);
  if (JSON.stringify(expect.options) === JSON.stringify(q.options) &&
      JSON.stringify(expect.scores) === JSON.stringify(q.scores) &&
      expect.analysis === q.analysis) reproOk++;
});
ok(reproOk === webAll.length, '乱序结果确定性可复现 (选项+分值+解析重映射), 实际 ' + reproOk + '/' + webAll.length);

// 5) 源数据未被污染: 源题对象不带 scores 字段 (乱序仅发生在 web 导出层)
ok(srcAll.every(q => q.scores === undefined), '源数据不带 scores 字段 (乱序仅作用于 web 导出)');

// —— 1.6 v0.8.6 计分锚点一致性: 单一真值源 = tools/check-analysis-consistency.js ——
//   背景: v0.8.6 之前本节内联了一套残缺正则(只认"最强/最高级/最稳的起点", 不认"最优/最稳做法"),
//   导致 D3-6 / D3-7 的选项成熟度错位(解析说某选项最优、但 100 分给到了别的选项)未被拦住。
//   现改为直接调用独立脚本 —— 规则只有一份, 不再漂移。
try {
  const cp = require('child_process');
  const out = cp.execSync('"' + process.execPath + '" "' +
    path.join(__dirname, 'check-analysis-consistency.js') + '"', { encoding: 'utf8' });
  const mm = out.match(/硬矛盾:\s*(\d+)\s*题/);
  ok(!!mm && mm[1] === '0',
    '解析-分值一致性 (独立脚本 check-analysis-consistency.js) 硬矛盾 ' + (mm ? mm[1] : '?') + ' 题');
} catch (e) {
  const out = String((e.stdout || '') + (e.stderr || ''));
  const bad = out.split('\n').filter(function (l) { return l.indexOf('✗') >= 0; })
    .slice(0, 5).join(' | ');
  ok(false, '解析-分值一致性 (独立脚本) FAIL: ' + (bad || e.message));
}

// —— 1.6b 解析结论必须指向满分锚点 (v0.8.6 新增) ——
//   源数据不带 scores(见 §1.5), 满分锚点恒为 D; 解析若写"本题「最可能」是 X", X 必须是 D
let conclBad = 0;
srcAll.forEach(function (q) {
  const cm = (q.analysis || '').match(/最可能」是\s*([ABCD])/);
  if (cm && cm[1] !== 'D') {
    conclBad++;
    console.log('  ✗ ' + q.id + ' 解析结论指向 ' + cm[1] + ', 但满分锚点是 D');
  }
});
ok(conclBad === 0, '解析结论指向满分锚点 D, 异常 ' + conclBad + ' 题');

// —— 1.7 版本更新说明同步惯例: 系统更新日志.md 必须含当前 questionSetVersion 条目 ——
try {
  const log = fs.readFileSync(path.join(ROOT, '系统更新日志.md'), 'utf8');
  ok(log.indexOf('## [' + DATA.meta.questionSetVersion + ']') >= 0,
    '系统更新日志.md 含 ' + DATA.meta.questionSetVersion + ' 条目 (发版必须同步更新说明文档)');
  ok(log.indexOf('发版惯例') >= 0, '系统更新日志.md 含发版惯例说明');
} catch (e) {
  ok(false, '系统更新日志.md 不存在或不可读 (发版必须同步更新说明文档)');
}

// —— 1.10 更新日志 HTML 版同步: 必须存在 且 含当前版本条目 ——
const LOG_HTML = path.join(ROOT, '系统更新日志.html');
if (!fs.existsSync(LOG_HTML)) {
  ok(false, '系统更新日志.html 不存在 (发版须同步运行 node tools/build-update-html.js)');
} else {
  const html = fs.readFileSync(LOG_HTML, 'utf8');
  ok(html.indexOf(DATA.meta.questionSetVersion) >= 0,
    '系统更新日志.html 含 ' + DATA.meta.questionSetVersion + ' 条目 (HTML 版与 md 同源)');
  // HTML 应比 md 新 (或同时间)，否则视为产物过期
  const htmlMtime = fs.statSync(LOG_HTML).mtimeMs;
  const mdMtime = fs.statSync(path.join(ROOT, '系统更新日志.md')).mtimeMs;
  ok(htmlMtime >= mdMtime - 1000,
    '系统更新日志.html 不早于 .md (产物过期需重新运行 node tools/build-update-html.js)');
}

// —— 1.8 版本号单点真值: 构建脚本与构建产物必须同版本号 (防"半成品"发版) ——
const BUILD_SCRIPT = path.join(__dirname, 'build-web-data.js');
try {
  const bs = fs.readFileSync(BUILD_SCRIPT, 'utf8');
  const m = bs.match(/questionSetVersion:\s*'([^']+)'/);
  ok(m && m[1] === DATA.meta.questionSetVersion,
    'build-web-data.js 与 web/data.js 版本号一致 (脚本 ' + (m ? m[1] : '未找到') + ' / 产物 ' + DATA.meta.questionSetVersion + ')');
} catch (e) {
  ok(false, 'build-web-data.js 不可读, 无法校验版本号一致性');
}

// —— 1.9 文档同步: README.md 版本速览表必须含当前版本号 ——
try {
  const rd = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  ok(rd.indexOf(DATA.meta.questionSetVersion) >= 0,
    'README.md 版本速览表含 ' + DATA.meta.questionSetVersion + ' (系统更新须同步文档)');
} catch (e) {
  ok(false, 'README.md 不存在或不可读 (系统更新须同步文档)');
}

// —— 1.11 v0.8.4 固定单字母策略回归: 期望分必须落在"无效策略"区间 ——
// 背景: v0.8 文档曾宣称"无脑选 D 预期约 35 分(L1)", 实测为 49.2 —— 对外宣称失实, v0.8.4 勘误。
// 断言: 任一固定字母期望分都不得逼近 L4(76+), 也不得过低, 且字母间无显著套利空间。
(function () {
  const allQ = DATA.core.concat(...DATA.packs.map(p => p.questions));
  const exp = {};
  ['A', 'B', 'C', 'D'].forEach(function (L) {
    let s = 0, n = 0;
    allQ.forEach(function (q) { if (q.scores && q.scores[L] != null) { s += q.scores[L]; n++; } });
    exp[L] = n ? +(s / n).toFixed(1) : 0;
  });
  const vals = ['A', 'B', 'C', 'D'].map(function (L) { return exp[L]; });
  const max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
  ok(max < 76, '固定单字母期望分最高 ' + max + ' < 76 (不可达到 L4): ' + JSON.stringify(exp));
  ok(min >= 40, '固定单字母期望分最低 ' + min + ' >= 40 (分布不过度集中): ' + JSON.stringify(exp));
  ok(max - min <= 20, '固定单字母期望分极差 ' + (max - min).toFixed(1) + ' <= 20 (字母间无套利空间): ' + JSON.stringify(exp));
  const dist = { A: 0, B: 0, C: 0, D: 0 };
  allQ.forEach(function (q) {
    ['A', 'B', 'C', 'D'].forEach(function (L) { if (q.scores[L] === 100) dist[L]++; });
  });
  ok(['A', 'B', 'C', 'D'].every(function (L) { return dist[L] > 0; }),
    '100 分选项覆盖全部四个字母: ' + JSON.stringify(dist));
  ok(Math.max.apply(null, ['A', 'B', 'C', 'D'].map(function (L) { return dist[L]; })) / allQ.length <= 0.4,
    '单一字母承载的 100 分题占比 <= 40%: ' + JSON.stringify(dist));
})();

// —— 1.12 v0.8.4 学习地图必须输出 30 天 (原实现每维只取 1 天 → 仅 6 天) ——
(function () {
  const tips = DATA.reports.learningTips;
  const dims = DATA.dimensions.map(function (d) { return d.id; });
  const total = dims.reduce(function (a, d) { return a + ((tips[d] || []).length); }, 0);
  ok(total === 30, 'learningTips 总条数 = 30 (6 维 × 5), 实为 ' + total);
  ok(dims.every(function (d) { return (tips[d] || []).length === 5; }), '每个维度恰好 5 条 tips');
  const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  const fn = appSrc.match(/function buildLearningMap[\s\S]*?\n  \}/);
  ok(!!fn, 'app.js 含 buildLearningMap');
  if (fn) {
    ok(/tips\.length/.test(fn[0]) || /actions|acts\.length/.test(fn[0]),
       'buildLearningMap 按 tips.length 或 actions 池铺天 (v0.8.6 起 actions 优先)');
    ok(!/idx\s*%\s*5/.test(fn[0]), 'buildLearningMap 不再用 idx % 5 取下标 (原第 6 维错位回 tips[0])');
  }
  ok(/30 天提升路线/.test(appSrc), '结果页标题仍为"30 天提升路线" (与输出天数一致)');
})();

// —— 1.13 v0.8.4 产物/ 快照与真源一致 (补上原门禁盲区: 校验通篇不覆盖 产物/) ——
(function () {
  const f02 = path.join(ROOT, '产物', '02-题库.json');
  const f04 = path.join(ROOT, '产物', '04-行业特化题包.json');
  if (!fs.existsSync(f02) || !fs.existsSync(f04)) {
    ok(false, '产物/02-题库.json 与 04-行业特化题包.json 必须存在 (跑 node tools/build-archive-snapshots.js)');
    return;
  }
  const V = DATA.meta.questionSetVersion;
  let d02, d04;
  try {
    d02 = JSON.parse(fs.readFileSync(f02, 'utf8'));
    d04 = JSON.parse(fs.readFileSync(f04, 'utf8'));
  } catch (e) {
    ok(false, '产物快照 JSON 解析失败: ' + e.message);
    return;
  }
  const verOf = function (d) { return (d.source && d.source.version) || ''; };
  ok(verOf(d02) === V, '02-题库.json 版本标注 = ' + V + ' (快照过期需重跑 build-archive-snapshots.js), 实为 ' + verOf(d02));
  ok(verOf(d04) === V, '04-行业特化题包.json 版本标注 = ' + V + ', 实为 ' + verOf(d04));

  ok(d02.questions.length === srcCore.length,
    '02 题量与真源一致 (' + d02.questions.length + '/' + srcCore.length + ')');
  let diff = 0;
  srcCore.forEach(function (q) {
    const s = d02.questions.filter(function (x) { return x.id === q.id; })[0];
    if (!s) { diff++; return; }
    if (JSON.stringify(s.options) !== JSON.stringify(q.options)) diff++;
    else if (s.analysis !== q.analysis) diff++;
  });
  ok(diff === 0, '02 快照与真源逐题一致 (选项+解析), 差异 ' + diff + ' 题');

  ok(d04.packs.length === srcPacks.length,
    '04 包数与真源一致 (' + d04.packs.length + '/' + srcPacks.length + ')');
  let pdiff = 0;
  srcPacks.forEach(function (p) {
    const sp = d04.packs.filter(function (x) { return x.id === p.id; })[0];
    if (!sp) { pdiff++; return; }
    if (sp.questions.length !== p.questions.length) { pdiff++; return; }
    p.questions.forEach(function (q) {
      const s = sp.questions.filter(function (x) { return x.id === q.id; })[0];
      if (!s) { pdiff++; return; }
      if (JSON.stringify(s.options) !== JSON.stringify(q.options)) pdiff++;
      else if (s.analysis !== q.analysis) pdiff++;
    });
  });
  ok(pdiff === 0, '04 快照与真源逐题一致 (选项+解析), 差异 ' + pdiff + ' 题');
})();

// —— 1.14 v0.8.5 乱序结果独立交叉校验 (不复用 tools/lib/shuffle.js) ——
// 原校验 (§1.5) 与构建共用同一 shuffle.js, 属"用自己验自己", 抓不出乱序实现本身的
// 错误 (如分值没跟着选项走)。这里用**文本反查法**独立推导每题各展示字母应有分值。
(function () {
  const indep = require(path.join(__dirname, 'lib', 'shuffle-indep.js'));
  // 真源题 → 导出题 配对
  const pairs = [];
  const outCore = DATA.core || [];
  srcCore.forEach(function (q) {
    const o = outCore.filter(function (x) { return x.id === q.id; })[0];
    if (o) pairs.push({ src: q, out: o, tag: 'core/' + q.id });
  });
  (srcPacks || []).forEach(function (p) {
    const op = (DATA.packs || []).filter(function (x) { return x.id === p.id; })[0];
    if (!op) return;
    p.questions.forEach(function (q) {
      const o = (op.questions || []).filter(function (x) { return x.id === q.id; })[0];
      if (o) pairs.push({ src: q, out: o, tag: p.id + '/' + q.id });
    });
  });
  ok(pairs.length === 86, '真源与导出可配对题数 = 86 (v0.8.6 加 D3-6/D3-7), 实际 ' + pairs.length);

  // ① 每题四选项文本必须互异 (否则文本反查法失效)
  let dupText = 0;
  pairs.forEach(function (pr) {
    const t = ['A', 'B', 'C', 'D'].map(L => String(pr.out.options[L]).trim());
    if (new Set(t).size !== 4) dupText++;
  });
  ok(dupText === 0, '每题四选项文本互异 (保证可反查), 重复题数 ' + dupText);

  // ② 独立推导的分值必须与导出的 q.scores 完全一致
  const bad = [];
  pairs.forEach(function (pr) {
    const r = indep.expectedScores(pr.src, pr.out);
    if (!r.ok) { bad.push(pr.tag + '[反查失败:' + r.reason + ']'); return; }
    ['A', 'B', 'C', 'D'].forEach(function (L) {
      if (Math.abs((pr.out.scores || {})[L] - r.expect[L]) > 0.01) {
        bad.push(pr.tag + '@' + L + '(导出' + pr.out.scores[L] + '≠应为' + r.expect[L] + ')');
      }
    });
  });
  ok(bad.length === 0, '独立推导分值 == 导出 scores (选项与分值未错位), 不符 ' + bad.length + ' 处' +
    (bad.length ? ': ' + bad.slice(0, 5).join('; ') : ''));

  // ③ 每题必须恰好含一档 0/33.3/66.7/100 (抓"分值丢失/重复")
  let badSet = 0;
  pairs.forEach(function (pr) {
    const s = ['A', 'B', 'C', 'D'].map(L => +(pr.out.scores || {})[L]);
    const want = [0, 33.3, 66.7, 100];
    if (want.some(v => s.filter(x => Math.abs(x - v) < 0.01).length !== 1)) badSet++;
  });
  ok(badSet === 0, '每题四档分值各出现一次, 异常题数 ' + badSet);

  // ④ 满分项分布回归锁定 (确定性函数, 与 §1.11 同源)
  const dist = indep.distribution(pairs);
  const want = { A: 19, B: 25, C: 20, D: 22 };
  ok(JSON.stringify(dist) === JSON.stringify(want),
    '满分项字母分布 = ' + JSON.stringify(want) + ' (86 题), 实为 ' + JSON.stringify(dist));
})();

// —— 2. 端口网站端 buildQuestions / calcResult (与 app.js 一致) ——
function webBuildQuestions(packId, mode) {
  if (packId && packId !== 'none') {
    const p = DATA.packs.find(x => x.id === packId);
    if (p) return mode === 'standalone' ? p.questions.slice() : DATA.core.concat(p.questions);
  }
  return DATA.core.slice();
}
function webPackWeights(packId) {
  const p = DATA.packs.find(x => x.id === packId);
  return (p && p.weights) ? p.weights : null;
}
function webCalc(questions, answers, weights) {
  const dimScores = {}, dimCount = {};
  Object.keys(answers).forEach(qid => {
    const q = questions.find(x => x.id === qid); if (!q) return;
    const s = answers[qid]; if (s == null) return;
    dimScores[q.dimension] = (dimScores[q.dimension] || 0) + s;
    dimCount[q.dimension] = (dimCount[q.dimension] || 0) + 1;
  });
  Object.keys(dimScores).forEach(d => { dimScores[d] = +(dimScores[d] / dimCount[d]).toFixed(1); });
  let total;
  if (weights) {
    let ws = 0, sw = 0;
    Object.keys(dimScores).forEach(d => { const w = weights[d] || 0; ws += dimScores[d] * w; sw += w; });
    total = sw > 0 ? ws / sw : 0;
  } else {
    // v0.8.5: 与 app.js 同步 —— 按实际参与计分的维度数归一化, 而非固定 /6。
    const dn = Object.keys(dimScores).length;
    total = dn > 0 ? Object.keys(dimScores).reduce((a, d) => a + dimScores[d], 0) / dn : 0;
  }
  return { total: +total.toFixed(1), dimScores };
}

// —— 1.15 v0.8.5 blended 分母按实际作答维度归一化回归 ——
// 旧实现固定 /6, 有维度未作答时 (如中途 confirm 提交) 会系统性低估总分。
// 锁定: 只答 N 维且全满分 → 总分应仍为 100 (不被未作答维度稀释)。
(function () {
  const all = DATA.core.concat(DATA.packs.flatMap(p => p.questions || []));
  const byDim = {};
  all.forEach(q => { if (!byDim[q.dimension]) byDim[q.dimension] = q; });
  const dims = Object.keys(byDim);
  ok(dims.length === 6, '六个维度都能取到代表题, 实际 ' + dims.length);
  // 每题取该题满分字母
  const pickBy = (q, target) => { let L = 'A', best = 999;
    ['A','B','C','D'].forEach(k => { if (Math.abs((q.scores[k]||0) - target) < best) { best = Math.abs((q.scores[k]||0) - target); L = k; } });
    return L; };
  // 场景 1: 只答 3 维且全满分 → 总分应为 100
  const ans3 = {};
  dims.slice(0, 3).forEach(d => { const q = byDim[d]; ans3[q.id] = q.scores[pickBy(q, 100)]; });
  const r3 = webCalc(all, ans3, null);
  ok(Math.abs(r3.total - 100) < 0.2,
    'blended 只答 3 维且全满分 → 总分 100 (原 /6 会算成 50), 实为 ' + r3.total);
  // 场景 2: 六维全答满分 → 仍为 100
  const ans6 = {};
  dims.forEach(d => { const q = byDim[d]; ans6[q.id] = q.scores[pickBy(q, 100)]; });
  const r6 = webCalc(all, ans6, null);
  ok(Math.abs(r6.total - 100) < 0.2,
    'blended 六维全满分 → 总分 100, 实为 ' + r6.total);
  // 场景 3: 六维全部 0 分 → 0
  const ans0 = {};
  dims.forEach(d => { const q = byDim[d]; ans0[q.id] = q.scores[pickBy(q, 0)]; });
  const r0 = webCalc(all, ans0, null);
  ok(Math.abs(r0.total) < 0.2,
    'blended 六维全 0 分 → 总分 0, 实为 ' + r0.total);
})();

// —— 3. 加载 miniprogram calc / bank (真代码) ——
const mpCalc = require(path.join(MP, 'utils/calc.js'));
const mpBank = require(path.join(MP, 'utils/bank.js'));

const SCORES = [0, 33.3, 66.7, 100];
function rndAnswers(qs, missRate) {
  const a = {};
  qs.forEach(q => { if (Math.random() > missRate) a[q.id] = SCORES[Math.floor(Math.random() * 4)]; });
  return a;
}
const scenarios = [
  { packId: 'none', mode: 'blended' },
  { packId: 'bid', mode: 'blended' },
  { packId: 'bid', mode: 'standalone' },
  { packId: 'mfg', mode: 'blended' },
  { packId: 'mfg', mode: 'standalone' },
  { packId: 'retail', mode: 'blended' },
  { packId: 'retail', mode: 'standalone' }
];

scenarios.forEach(sc => {
  // 题序一致
  const webQs = webBuildQuestions(sc.packId, sc.mode);
  const mpQs = mpBank.buildQuestions(sc.packId, sc.mode);
  ok(webQs.map(q => q.id).join(',') === mpQs.map(q => q.id).join(','),
    sc.packId + '/' + sc.mode + ' 题序一致');
  ok(webQs.length === mpQs.length, sc.packId + '/' + sc.mode + ' 题量一致(' + webQs.length + ')');

  // 多组随机答案比对总分/维度分
  for (let t = 0; t < 40; t++) {
    const ans = rndAnswers(webQs, 0.1);
    const w = webPackWeights(sc.packId);
    const webR = webCalc(webQs, ans, w);
    const mpR = mpCalc.calcResult(mpQs, ans, w);
    const dimEq = JSON.stringify(webR.dimScores) === JSON.stringify(mpR.dimScores);
    const totEq = Math.abs(webR.total - mpR.total) < 0.05;
    if (!dimEq || !totEq) {
      fail++; console.log('  ✗ ' + sc.packId + '/' + sc.mode + ' 第' + t + '组不一致 total=' + webR.total + ' vs ' + mpR.total + ' dimEq=' + dimEq);
    } else pass++;
  }
});

// —— 4. 边界: 满分/零分 等级 ——
ok(mpCalc.levelOf(82).id === 'L4', '82 分 => L4');
ok(mpCalc.levelOf(20).id === 'L1', '20 分 => L1');
ok(mpCalc.levelOf(100).id === 'L4', '100 分 => L4');

// —— 5. v0.8.7 P0 回归: calcResult 增加 completeness + 低完整度不出综合等级 ——
{
  // 模拟只答 1 题 (completeness < 0.5)
  const qs = mpBank.buildQuestions('general', 'blended');
  const answers = {};
  answers[qs[0].id] = 100; // 拿满分 100
  const r = mpCalc.calcResult(qs, answers, null);
  ok(r.completeness < 0.5, '缺答 completeness < 0.5, 实际 ' + r.completeness);
  ok(r.level.id === null, '缺答不出综合等级 level.id=null, 实际 ' + r.level.id);
  // 模拟答满 32 题
  const fullAnswers = {};
  qs.forEach(q => { fullAnswers[q.id] = 100; });
  const r2 = mpCalc.calcResult(qs, fullAnswers, null);
  ok(r2.completeness >= 0.95, '答满 completeness >= 0.95, 实际 ' + r2.completeness);
  ok(r2.level.id === 'L4', '答满全选 D 出 L4, 实际 ' + r2.level.id);
}

// —— 6. v0.8.7 P0-2.3 回归: buildLearningMap 输出固定 30 天 (6×5) ——
{
  const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  // 静态文本检测: 'Day ' + (i + 1) 在 app.js 源码里
  ok(appSrc.indexOf("'Day ' + (i + 1)") >= 0, 'buildLearningMap 输出固定 Day N 标签 (一次性 forEach 加标)');
  // 6 维 × 5 条 = 30: 源码中有 while (pool.length < 5) ... push 补偿循环
  ok(appSrc.indexOf('while (pool.length < 5)') >= 0, 'buildLearningMap 含 <5 补足逻辑 (保证恰 5 条/维)');
}

// —— 7. v0.8.7 P0-2.2 回归: buildAdviceForRecord 不再走 globalWeakAbilities ——
{
  const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  var fnBody = null;
  var m = appSrc.match(/function buildAdviceForRecord\(record\)\s*\{[\s\S]*?\n  \}/);
  if (m) fnBody = m[0];
  ok(!!fnBody, 'buildAdviceForRecord 函数定义存在');
  if (fnBody) {
    ok(fnBody.indexOf('globalWeakAbilities') < 0, 'buildAdviceForRecord 不再使用 globalWeakAbilities (P0-2.2)');
    ok(fnBody.indexOf('dimScores[a]') >= 0 || fnBody.indexOf('dimScores[') >= 0,
      'buildAdviceForRecord 按 dimScores 升序选最弱维度');
  }
}

console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
