// 小程序逻辑冒烟测试: 用假的 wx 运行时驱动真实页面代码
const path = require('path');
const ROOT = path.join(__dirname, "..");

const store = {};
const calls = [];
const wx = {
  getStorageSync: k => (k in store ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: k => { delete store[k]; },
  setNavigationBarTitle: o => calls.push(['setTitle', o.title]),
  pageScrollTo: () => {},
  navigateTo: o => calls.push(['navigateTo', o.url]),
  redirectTo: o => calls.push(['redirectTo', o.url]),
  showToast: o => calls.push(['toast', o.title]),
  showModal: o => calls.push(['modal', o.title, o.content]),
  setClipboardData: o => calls.push(['clipboard', o.data.split('\n')[0]]),
  enableAlertBeforeUnload: () => calls.push(['guardOn']),
  disableAlertBeforeUnload: () => calls.push(['guardOff']),
  createCanvasContext: () => new Proxy({}, {
    get: (t, p) => (typeof p === 'string' && p !== 'then' ? () => {} : undefined)
  }),
  // --- 海报相关 (v0.5) ---
  getSystemInfoSync: () => ({ pixelRatio: 3, windowWidth: 375 }),
  getSetting: o => o.success({ authSetting: { 'scope.writePhotosAlbum': true } }),
  authorize: o => o.success({}),
  openSetting: o => o.success({ authSetting: { 'scope.writePhotosAlbum': true } }),
  showLoading: o => calls.push(['loading', o.title]),
  hideLoading: () => calls.push(['hideLoading']),
  saveImageToPhotosAlbum: o => { calls.push(['saveAlbum', o.filePath]); o.success({}); },
  canvasToTempFilePath: o => o.success({ tempFilePath: '/tmp/poster.png' }),
  createSelectorQuery: () => ({
    in: () => ({
      select: () => ({
        fields: () => ({
          exec: cb => cb([{ node: global.__stubCanvas, width: 750, height: 1080 }])
        })
      })
    })
  })
};
global.wx = wx;

const pages = {};
global.Page = function (cfg) { pages.__last = cfg; };
global.Component = function (cfg) { };

// 支持小程序 setData 的路径写法: reviewItems[0].open
function setByPath(obj, pathKey, value) {
  const parts = String(pathKey).replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) cur[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function inst(cfg) {
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data || {}));
  p.setData = function (patch, cb) {
    Object.keys(patch).forEach(k => setByPath(p.data, k, patch[k]));
    if (typeof cb === 'function') cb();
  };
  return p;
}

function load(rel) {
  delete require.cache[require.resolve(path.join(ROOT, rel))];
  require(path.join(ROOT, rel));
  return pages.__last;
}

function assert(cond, msg) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) process.exitCode = 1;
}

// ---------- 1. 首页 ----------
const IndexCfg = load('pages/index/index.js');
const idx = inst(IndexCfg);
idx.onLoad();
assert(idx.data.packs.length === 4, '首页加载 4 个题卷 (通用 + 3 专项模型)');
assert(idx.data.total === 30, '默认通用版 30 题, 实际 ' + idx.data.total);
idx.onPickPack({ detail: { id: 'bid' } });
assert(idx.data.total === 48, '选招投标包后 48 题 (30+18), 实际 ' + idx.data.total);
assert(idx.data.packTag.indexOf('招投标') >= 0, 'hero 联动显示题卷名: ' + idx.data.packTag);
idx.onPickPack({ detail: { id: 'none' } });

// ---------- 2. 答题页 ----------
const QuizCfg = load('pages/quiz/quiz.js');
const quiz = inst(QuizCfg);
quiz.onLoad({ packId: 'bid' });
assert(quiz.data.total === 48, '答题页组卷 48 题 (30+18), 实际 ' + quiz.data.total);
assert(quiz.data.packName === '招投标专项', '卷别名正确: ' + quiz.data.packName);
assert(quiz.data.cur && quiz.data.cur.id === 'D1-1', '首题为 D1-1');
assert(quiz.data.grid.length === 48, '题卡 48 格');

// 全选 D (满分)
for (let i = 0; i < quiz.data.total; i++) {
  quiz.onPick({ detail: { letter: 'D', score: 100 } });
  if (i < quiz.data.total - 1) {
    // 模拟自动跳下一题 (延时回调里做的 setData)
    quiz.setData({ idx: quiz.data.idx + 1 }, () => quiz.sync());
  }
}
assert(quiz.data.answeredCount === 48, '全部作答完成, 实际 ' + quiz.data.answeredCount);
assert(quiz.data.idx === 47, '停在最后一题, 实际 idx=' + quiz.data.idx);
assert(!!store['apca.progress.v1'], '断点进度已写入本机存储');

quiz.onSubmit();
const hist = store['apca.history.v1'];
assert(hist && hist.length === 1, '交卷后写入 1 条历史');
assert(hist[0].total === 100, '全选 D 得 100 分, 实际 ' + hist[0].total);
assert(hist[0].level.id === 'L4', '等级判定 L4, 实际 ' + hist[0].level.id);
assert(hist[0].packName === '招投标专项', '历史记录卷别正确');
assert(!store['apca.progress.v1'], '交卷后清除未完成进度');
const tsAllD = hist[0].ts;
console.log('      redirectTo =', calls.filter(c => c[0] === 'redirectTo').pop()[1]);

// ---------- 3. 结果页 ----------
const ResultCfg = load('pages/result/result.js');
const res = inst(ResultCfg);
res.onLoad({ ts: String(tsAllD) });
assert(res.data.rec && res.data.rec.total === 100, '结果页读回记录 100 分');
assert(res.data.dimList.length === 6, '维度明细 6 行');
assert(res.data.dimList[0].score === 100, '维度分正确');
assert(res.data.map.length === 6, '学习地图 6 天');
assert(res.data.advice.length === 3, '核心建议 3 条');
assert(res.data.advice[0].t.indexOf('反哺团队') >= 0, 'L4 建议内容匹配: ' + res.data.advice[0].t);
assert(res.data.summary.indexOf('L4') >= 0, '分享摘要含等级');

// ---------- 4. 第二次 (全选 A) + 断点续答 ----------
const quiz2 = inst(QuizCfg);
quiz2.onLoad({ packId: 'none' });
assert(quiz2.data.total === 30, '第二次通用卷 30 题');
for (let i = 0; i < 10; i++) {
  quiz2.onPick({ detail: { letter: 'A', score: 0 } });
  quiz2.setData({ idx: quiz2.data.idx + 1 }, () => quiz2.sync());
}
assert(quiz2.data.answeredCount === 10, '答到第 10 题');
quiz2.onUnload();
const q3 = inst(QuizCfg);
q3.onLoad({ packId: 'none', resume: '1' });
assert(q3.data.idx === 10, '断点续答恢复到第 11 题, 实际 idx=' + q3.data.idx);
assert(Object.keys(q3.data.answers).length === 10, '恢复 10 个答案');
// 剩余全选 A
for (let i = 10; i < q3.data.total; i++) {
  q3.onPick({ detail: { letter: 'A', score: 0 } });
  if (i < q3.data.total - 1) q3.setData({ idx: q3.data.idx + 1 }, () => q3.sync());
}
q3.onSubmit();
const h2 = store['apca.history.v1'][0];
assert(h2.total === 0, '全选 A 得 0 分, 实际 ' + h2.total);
assert(h2.level.id === 'L1', '等级判定 L1, 实际 ' + h2.level.id);

// ---------- 5. 历史页 ----------
const HistoryCfg = load('pages/history/history.js');
const his = inst(HistoryCfg);
his.onShow();
assert(his.data.list.length === 2, '历史 2 条, 实际 ' + his.data.list.length);
assert(his.data.list[0].deltaText === '-100', '最新一条相对上次 -100, 实际 ' + his.data.list[0].deltaText);
assert(his.data.list[1].deltaText === '首次', '最早一条显示「首次」, 实际 ' + his.data.list[1].deltaText);
assert(his.data.trend.length === 2, '趋势 2 根柱');
assert(his.data.compare && his.data.compare.rows.length === 6, '维度对比 6 行');
assert(his.data.compare.rows[0].delta === -100, '对比差值 -100');

// ---------- 6. 关于页 ----------
const AboutCfg = load('pages/about/about.js');
const abt = inst(AboutCfg);
abt.onShow();
assert(abt.data.dims.length === 6, '关于页 6 维度');
assert(abt.data.levels.length === 4, '关于页 4 等级');
assert(abt.data.types.length === 4, '关于页 4 题型');
assert(abt.data.historyCount === 2, '关于页显示 2 条历史');

// ---------- 7. 组件纯函数 ----------
const CALC = require(path.join(ROOT, 'utils/calc.js'));
const BANK = require(path.join(ROOT, 'utils/bank.js'));
assert(CALC.levelOf(25).id === 'L1', '25 分 → L1');
assert(CALC.levelOf(26).id === 'L2', '26 分 → L2');
assert(CALC.levelOf(51).id === 'L3', '51 分 → L3');
assert(CALC.levelOf(76).id === 'L4', '76 分 → L4');
assert(BANK.buildQuestions('retail').length === 48, '连锁零售包加测 48 题, 实际 ' + BANK.buildQuestions('retail').length);
assert(BANK.buildQuestions('retail', 'standalone').length === 18, '连锁零售单独成卷 18 题, 实际 ' + BANK.buildQuestions('retail', 'standalone').length);
assert(BANK.packName('mfg').length > 0, '制造业包名: ' + BANK.packName('mfg'));
const DATE = require(path.join(ROOT, 'utils/date.js'));
assert(/^\d{4}-\d{2}-\d{2}$/.test(DATE.ymd(Date.now())), '日期格式正确: ' + DATE.ymd(Date.now()));
assert(DATE.ago(Date.now() - 3600 * 1000) === '1 小时前', '相对时间: ' + DATE.ago(Date.now() - 3600 * 1000));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async function runShareTests() {

// ---------- 8. 逐题复盘 (本地规则版个性化解读) ----------
const REVIEW = require(path.join(ROOT, 'utils/review.js'));
const CORE = require(path.join(ROOT, 'data/core.js'));

// 造一份"全选 D 但漏掉 3 题选 A"的作答, 验证复盘会优先挑出选 A 的题
const trailA = CORE.slice(0, 10).map((q, i) => ({ id: q.id, letter: i < 3 ? 'A' : 'D' }));
const rv = REVIEW.pickReviewItems(CORE, trailA, 4);
assert(rv.length === 4, '取满 4 条 (3 个 A + 1 个 D), 实际 ' + rv.length);
assert(rv[0].yourLetter === 'A' && rv[2].yourLetter === 'A', '低分题排前面');
assert(rv[3].yourLetter === 'D', '第 4 条才是高分题, 实际 ' + rv[3].yourLetter);
assert(rv[0].yourLetter === 'A', '最低分题排最前, 实际 ' + rv[0].yourLetter);
assert(rv[0].yourScore === 0, 'A 档记 0 分, 实际 ' + rv[0].yourScore);
assert(!!rv[0].analysis && !!rv[0].nextStep, '复盘项带解析与下一步');
assert(!!rv[0].dimName && !!rv[0].dimTagline, '复盘项带维度名: ' + rv[0].dimName);
assert(!!rv[0].bestText, '复盘项带更优解 D 选项');
assert(REVIEW.buildHeadline(rv).indexOf(rv[0].id) >= 0, '总评点名最弱题号');

// 全选 D 的高手: 复盘应该仍有内容, 但都是 100 分题
const trailD = CORE.map(q => ({ id: q.id, letter: 'D' }));
const rvD = REVIEW.pickReviewItems(CORE, trailD, 4);
assert(rvD.length === 4 && rvD[0].yourScore === 100, '满分用户也有复盘项 (100 分档)');
assert(REVIEW.pickReviewItems(CORE, [], 4).length === 0, '无作答时不产生复盘');

// ---------- 9. 结果页接入复盘 ----------
const ResultCfg2 = load('pages/result/result.js');
const rs2 = inst(ResultCfg2);
const newestTs = store['apca.history.v1'][0].ts;
rs2.onLoad({ ts: newestTs });
assert(rs2.data.hasReview === true, '结果页识别到可复盘作答');
assert(rs2.data.reviewItems.length > 0, '复盘项渲染数: ' + rs2.data.reviewItems.length);
assert(!!rs2.data.reviewHeadline, '复盘总评非空');
assert(rs2.data.posterRec && rs2.data.posterRec.totalQ > 0, '海报数据已就绪, 题数 ' + (rs2.data.posterRec || {}).totalQ);
assert(rs2.data.posterRec.strongName.indexOf('D') === 0, '海报强项带维度号: ' + rs2.data.posterRec.strongName);
rs2.toggleReview({ currentTarget: { dataset: { i: 0 } } });
assert(rs2.data.reviewItems[0].open === true, '点击展开解析');
rs2.toggleReview({ currentTarget: { dataset: { i: 0 } } });
assert(rs2.data.reviewItems[0].open === false, '再次点击收起');

// ---------- 10. 海报绘制 ----------
const POSTER = require(path.join(ROOT, 'utils/poster.js'));

function stubCtx() {
  const log = { texts: [], images: 0, strokeRects: 0, gradients: 0, arcs: 0 };
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'left',
    globalAlpha: 1, shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
    fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    arc() { log.arcs++; }, arcTo() {}, closePath() {}, fill() {}, stroke() {},
    save() {}, restore() {}, scale() {},
    strokeRect() { log.strokeRects++; },
    fillText(t) { log.texts.push(String(t)); },
    drawImage() { log.images++; },
    measureText(t) { return { width: String(t).length * 14 }; },
    createLinearGradient() { log.gradients++; return { addColorStop() {} }; }
  };
  return { ctx, log };
}

const posterData = {
  levelId: 'L3', levelName: '流程模式', levelSubtitle: '为复杂任务设计流程, 主动管控风险与质量',
  total: 68, dimScores: { D1: 83, D2: 67, D3: 72, D4: 58, D5: 61, D6: 50 },
  strongName: 'D1 AI 沟通', weakName: 'D6 经验复用',
  packName: '招投标专项', totalQ: 36, dateStr: '2026-09-02 14:30'
};

const s1 = stubCtx();
let drewOk = true;
try { POSTER.drawPoster(s1.ctx, posterData, { qrImage: null }); } catch (e) { drewOk = false; console.log('      绘制异常:', e.message); }
assert(drewOk, '海报绘制不抛异常 (无小程序码)');
assert(s1.log.texts.indexOf('L3') >= 0, '海报含等级 L3');
assert(s1.log.texts.indexOf('流程模式') >= 0, '海报含等级名');
assert(s1.log.texts.indexOf('68') >= 0, '海报含总分 68');
assert(s1.log.texts.some(t => t.indexOf('D1') >= 0), '海报含强项维度');
assert(s1.log.texts.some(t => t.indexOf('D6') >= 0), '海报含待提升维度');
assert(s1.log.texts.some(t => t.indexOf('招投标') >= 0), '海报含卷别');
assert(s1.log.texts.some(t => t.indexOf('36 题') >= 0), '海报含题数');
assert(s1.log.texts.indexOf('小程序码') >= 0, '缺小程序码时画占位块');
assert(s1.log.images === 0, '无图时未调用 drawImage');

const s2 = stubCtx();
POSTER.drawPoster(s2.ctx, posterData, { qrImage: { fake: true } });
assert(s2.log.images === 1, '有小程序码时调用 drawImage');
assert(s2.log.texts.indexOf('小程序码') < 0, '有图时不画占位文字');
assert(s2.log.gradients >= 1, '绘制了渐变背景');
assert(s2.log.arcs >= 6, '雷达图节点已绘制, arc 调用 ' + s2.log.arcs);

// 缺字段不应崩
const s3 = stubCtx();
let safeOk = true;
try { POSTER.drawPoster(s3.ctx, {}, {}); } catch (e) { safeOk = false; console.log('      空数据异常:', e.message); }
assert(safeOk, '空数据绘制不崩');

// 折行
const wrap = POSTER.wrapText(s1.ctx, '为复杂任务设计流程, 主动管控风险与质量', 400, 2);
assert(wrap.length >= 1 && wrap.length <= 2, '折行数在限制内: ' + wrap.length);
assert(POSTER.wrapText(s1.ctx, '', 400, 2).length === 0, '空文本折行返回空');

// ---------- 11. 海报组件 ----------
function stubCanvasNode() {
  return {
    width: 0, height: 0,
    getContext: () => stubCtx().ctx,
    createImage() { const img = {}; setTimeout(() => img.onerror && img.onerror(), 0); return img; }
  };
}
global.__stubCanvas = stubCanvasNode();

const comps = {};
global.Component = function (cfg) { comps.__last = cfg; };
load('components/comp-poster/comp-poster.js');
const PosterCfg = comps.__last;
const poster = {
  data: JSON.parse(JSON.stringify(PosterCfg.data || {})),
  setData(patch, cb) { Object.keys(patch).forEach(k => { this.data[k] = patch[k]; }); if (cb) cb(); },
  triggerEvent(name, detail) { calls.push(['evt:' + name, JSON.stringify(detail).slice(0, 40)]); }
};
Object.assign(poster, PosterCfg.methods);
poster.data.rec = posterData;

calls.length = 0;
poster.make();
await sleep(80); // 小程序码加载是异步的 (含 2s 兜底, 正常走 onerror)
assert(calls.some(c => c[0] === 'saveAlbum'), '组件跑通保存到相册: ' + JSON.stringify(calls.map(c => c[0])));
assert(calls.some(c => c[0] === 'evt:saved'), '保存成功触发 saved 事件');
assert(poster.data.busy === false, '结束后 busy 复位');

// 无 rec 时不应崩
calls.length = 0;
poster.data.rec = null;
poster.make();
await sleep(20);
assert(calls.some(c => c[0] === 'toast'), '无结果时给提示: ' + JSON.stringify(calls.map(c => c[0])));

// 结果页按钮能拿到组件
rs2.selectComponent = () => poster;
rs2.data.posterRec = posterData;
poster.data.rec = posterData;
calls.length = 0;
rs2.makePoster();
await sleep(80);
assert(calls.some(c => c[0] === 'loading'), '点生成海报先 loading');
assert(calls.some(c => c[0] === 'saveAlbum'), '结果页按钮驱动组件出图');

console.log('\n完成, 退出码 =', process.exitCode || 0);

// ---------- 12. 通用 vs 专项: 单独成卷 + 自己的测试标准 (v0.6) ----------
// 通用版是主入口, 专项是可选加测模块; 专项可单独成卷且自带维度权重
assert(BANK.packName('none') === '通用版', '通用版是默认卷别');
const pk = BANK.listPacks();
assert(pk[0].kind === 'general' && pk[0].id === 'none', '题卷列表第一个是通用版 (主入口)');
assert(pk.filter(x => x.kind === 'specialized').length === 3, '3 个专项模型, 实际 ' + pk.filter(x => x.kind === 'specialized').length);

// 单独成卷: 只取专项题, 不带通用 30 题
const qsBidOnly = BANK.buildQuestions('bid', 'standalone');
assert(qsBidOnly.length === 18, '招投标专项单独成卷 = 18 题 (不含通用 30), 实际 ' + qsBidOnly.length);
assert(qsBidOnly.every(q => q.id.indexOf('BID-') === 0), '专项卷只含 BID 题');
const qsBidBlend = BANK.buildQuestions('bid', 'blended');
assert(qsBidBlend.length === 48, '加测模式 = 通用 30 + 专项 18 = 48 题');
const qsNone = BANK.buildQuestions('none');
assert(qsNone.length === 30, '纯通用版 = 30 题');

// 专项自带测试标准 (维度权重), 通用版返回 null (走等权)
const wBid = BANK.packWeights('bid');
assert(wBid && Math.abs(Object.values(wBid).reduce((a, b) => a + b, 0) - 1) < 1e-9, '招投标专项权重和为 1: ' + JSON.stringify(wBid));
assert(BANK.packWeights('none') === null, '通用版无专属权重 (用等权)');

// 加权计分: 同样的维度分, 不同权重得到不同总分
// 招投标专项权重 (v0.7): D1=.15 D2=.18 D3=.18 D4=.22 D5=.17 D6=.10
// 构造"高权重维度得 0、低权重维度得 100"的作答, 加权应明显低于等权
const ansForW = {};
['D1-1','D2-1','D3-1','D4-1','D5-1','D6-1'].forEach(id => { ansForW[id] = 0; });
ansForW['D1-1'] = 100; ansForW['D5-1'] = 100; ansForW['D6-1'] = 100;  // 只让低权重维度(D1/D5/D6)得满
// 等权: (100+0+0+0+100+100)/6 = 50
// 加权: 100*(.15+.17+.10) = 42  (弱项 D2/D3/D4 占 .58 权重但得 0)
const totalEqual = CALC.calcResult(qsNone, ansForW).total;          // 等权 → 50
const totalW = CALC.calcResult(qsNone, ansForW, wBid).total;        // 加权 → 42
assert(Math.abs(totalEqual - 50) < 1e-6, '等权总分 = 50, 实际 ' + totalEqual);
assert(Math.abs(totalW - 42) < 1e-6, '招投标专项权重计分 = 42, 实际 ' + totalW);
assert(totalW < totalEqual, '弱项高权重把总分拉低: 等权 ' + totalEqual + ' > 加权 ' + totalW);

// 专项单独成卷: 答题页 mode=standalone
const quizS = inst(QuizCfg);
quizS.onLoad({ packId: 'bid', mode: 'standalone' });
assert(quizS.data.total === 18, '专项独立入口组卷 = 18 题, 实际 ' + quizS.data.total);
assert(quizS.data.packName === '招投标专项', '卷别名=专项名: ' + quizS.data.packName);
assert(quizS.data.mode === 'standalone', 'mode 透传');
assert(quizS.data.weights && quizS.data.weights.D4 === 0.22, '专项自带权重已注入: ' + JSON.stringify(quizS.data.weights));

// 交卷: 历史记录带 isStandalone / mode
for (let i = 0; i < quizS.data.total; i++) {
  quizS.onPick({ detail: { letter: 'D', score: 100 } });
  if (i < quizS.data.total - 1) quizS.setData({ idx: quizS.data.idx + 1 }, () => quizS.sync());
}
quizS.onSubmit();
const hS = store['apca.history.v1'][0];
assert(hS.isStandalone === true && hS.mode === 'standalone', '历史记录标记专项单独成卷');
assert(hS.total === 100 && hS.packName === '招投标专项', '专项卷满分 100, 卷别正确');

// 等级与行业无关: 用通用分测, 等级只反映段位, 不被卷别绑架
assert(CALC.levelOf(68).id === 'L3', '68 分无论通用/专项都是 L3');


})();
