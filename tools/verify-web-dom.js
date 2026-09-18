/* linkedom 功能测试: 真实驱动 web/app.js 的关键路径
 * 不依赖 jsdom(本环境会挂起), 用纯 JS 的 linkedom 做 DOM 仿真。
 * v0.8.5: 改用 __dirname 推导仓库根, 移除 /Users/jmount 硬编码 (换机器即失败)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const b64safe = require('./lib/b64safe');

function log(m) { fs.writeSync(1, m + '\n'); }
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; log('  ✓ ' + msg); } else { fail++; log('  ✗ ' + msg); } }

try {
  // 解析 linkedom: 优先用本机标准 node_modules, 失败则回退到受控环境(WorkBuddy managed node workspace)
  let linkedom;
  try { linkedom = require('linkedom'); }
  catch (_) {
    const fallback = path.join(process.env.HOME || '/root', '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'linkedom');
    linkedom = require(fallback);
  }
  const { parseHTML, Event } = linkedom;

  log('A 读取文件');
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dataCode = fs.readFileSync(path.join(WEB, 'data.js'), 'utf8');
  const appCode = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');

  log('B 构建 DOM');
  const { window, document } = parseHTML(html);

  // ---- 全局桩 ----
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const location = { href: 'http://localhost/index.html', hash: '' };
  window.scrollTo = () => {};
  window.confirm = () => true;
  window.alert = () => {};   // v0.8.2 必填校验会调用 alert, linkedom 未实现需 stub
  document.execCommand = () => true;

  // 给 #posterCanvas 补 getContext (海报路径兜底, 测试尽量不触发)
  // linkedom 不改变元素原型, 这里在需要时按需替换

  // 暴露为 Node 全局, 让 app.js 内的裸标识符可解析
  global.window = window;
  global.document = document;
  global.localStorage = localStorage;
  global.location = location;
  global.navigator = global.navigator || {};

  log('C eval data.js');
  eval(dataCode);
  ok(window.APCA_DATA && window.APCA_DATA.dimensions.length === 6, 'data.js 注入 window.APCA_DATA (6 维)');

  log('D eval app.js + 触发 DOMContentLoaded');
  eval(appCode);
  document.dispatchEvent(new Event('DOMContentLoaded'));

  // ---------- 首页 ----------
  log('E 首页');
  ok(document.querySelector('#view-home').hidden === false, '首页可见');
  ok(document.querySelector('#view-quiz').hidden === true, '答题页隐藏');
  const packs = document.querySelectorAll('#packList .pack');
  ok(packs.length === 4, '卷别渲染 4 项 (通用 + 3 专项), 实际=' + packs.length);
  // 与 web/data.js 的 framework 同源 (避免硬编码版本号导致每次发版改两处)
ok(new RegExp(window.APCA_DATA.meta.framework.replace(/\./g, '\\.')).test(document.querySelector('#heroVersion').textContent),
   'hero 版本号渲染 (' + window.APCA_DATA.meta.framework + ')');
  ok(document.querySelector('#modeCard').hidden === true, '通用版下专项测法卡片隐藏');

  // ---------- 测评人信息页 ----------
  log('F 测评人信息页 -> 答题');
  const startBtn = document.querySelector('#btnStart');
  startBtn.dispatchEvent(new Event('click'));
  ok(document.querySelector('#view-info').hidden === false, '点开始进入测评人信息页');
  ok(document.querySelector('#view-quiz').hidden === true, '信息页阶段答题页仍隐藏');
  // v0.8.2 必填校验: 姓名/公司/岗位任一为空时点「开始答题」应被拦截, 仍停留在信息页
  document.querySelector('#infoName').value = '';
  document.querySelector('#infoCompany').value = '';
  document.querySelector('#infoPosition').value = '';
  document.querySelector('#btnInfoStart').dispatchEvent(new Event('click'));
  ok(document.querySelector('#view-quiz').hidden === true && document.querySelector('#view-info').hidden === false,
    '必填项全空时开始被拦截, 停留在信息页 (v0.8.2)');
  document.querySelector('#infoName').value = '测试张三';
  document.querySelector('#btnInfoStart').dispatchEvent(new Event('click'));
  ok(document.querySelector('#view-quiz').hidden === true,
    '仅填姓名仍被拦截 (公司/岗位同为必填, v0.8.2)');
  document.querySelector('#infoCompany').value = '示例科技有限公司';
  document.querySelector('#btnInfoStart').dispatchEvent(new Event('click'));
  ok(document.querySelector('#view-quiz').hidden === true,
    '缺岗位仍被拦截 (三项须齐全, v0.8.2)');

  document.querySelector('#infoName').value = '测试张三';
  document.querySelector('#infoCompany').value = '示例科技有限公司';
  document.querySelector('#infoPosition').value = '产品经理';
  document.querySelector('#infoBatch').value = '2026内训第一批';
  document.querySelector('#infoNotes').value = '自动化测试备注';
  document.querySelector('#btnInfoStart').dispatchEvent(new Event('click'));
  ok(document.querySelector('#view-quiz').hidden === false, '信息提交后进入答题页');
  let opts = document.querySelectorAll('#quizCard .opt');
  ok(opts.length === 4, '第1题有 4 个选项');
  ok(/第 1 \/ 32 题/.test(document.querySelector('#quizCounter').textContent), '计数器=第1/32题 (v0.8.6 通用 32 题)');

  // 逐题选该题的最高分选项 (v0.8 起选项乱序, 最高分不再固定是 D), 用下一题推进, 末题提交
  // 由计数器解析当前题号 → 从 APCA_DATA 查该题 scores 里 100 分所在的字母
  function bestLetterOfCurrent(packQuestions) {
    const m = /第 (\d+) \/ \d+ 题/.exec(document.querySelector('#quizCounter').textContent);
    const q = packQuestions[Number(m[1]) - 1];
    let best = 'A';
    ['A', 'B', 'C', 'D'].forEach((L) => { if (q.scores[L] > q.scores[best]) best = L; });
    return best;
  }
  log('G 逐题作答并推进');
  let answered = 0, guard = 0;
  while (guard++ < 200) {
    const curOpts = document.querySelectorAll('#quizCard .opt');
    if (!curOpts.length) break;
    const bestL = bestLetterOfCurrent(window.APCA_DATA.core);
    let bestOpt = null;
    curOpts.forEach((o) => { if (o.getAttribute('data-letter') === bestL) bestOpt = o; });
    if (!bestOpt) { fail++; log('  ✗ 未找到最高分选项 ' + bestL); break; }
    bestOpt.dispatchEvent(new Event('click'));
    answered++;
    const nextBtn = document.querySelector('#btnNext');
    const isLast = /提交测评/.test(nextBtn.textContent);
    nextBtn.dispatchEvent(new Event('click'));
    if (isLast) break;
  }
  ok(answered === 32, '通用 32 题全部作答 (v0.8.6 加 D3-6/D3-7), 实际=' + answered);
  ok(document.querySelector('#view-result').hidden === false, '提交后进入结果页');
  // v0.8 乱序生效: 通用卷里 D 不再全部是最高分选项
  ok(window.APCA_DATA.core.filter((q) => q.scores.D === 100).length < 30,
    'v0.8 乱序生效: 通用卷 D=100 的题数 < 30, 实际=' + window.APCA_DATA.core.filter((q) => q.scores.D === 100).length);

  // ---------- 结果页 ----------
  log('H 结果页');
  const totalTxt = document.querySelector('#resultBody .level-score .num');
  ok(totalTxt && totalTxt.textContent.trim() === '100', '每题选最高分选项 => 总分 100, 实际=' + (totalTxt && totalTxt.textContent.trim()));
  ok(document.querySelector('#resultBody svg') !== null, '六维雷达 SVG 已渲染');
  ok(document.querySelectorAll('#resultBody .dim-row').length === 6, '维度明细 6 行');
  ok(document.querySelectorAll('#resultBody .advice-item').length === 3, '核心建议 3 条');
  // v0.8.4: 原断言写死 6 天 (与"30 天提升路线"标题矛盾)。改为按 tips 总数动态校验。
  const expectDays = window.APCA_DATA.dimensions.reduce(
    (a, d) => a + ((window.APCA_DATA.reports.learningTips[d.id] || []).length), 0);
  ok(document.querySelectorAll('#resultBody .map-item').length >= expectDays - 4,
    '学习地图天数 (' + expectDays + ' 个模板 / 弱项优先 ≥ ' + (expectDays - 4) + ' 个), 实际=' +
    document.querySelectorAll('#resultBody .map-item').length);
  ok(document.querySelectorAll('#resultBody .review-item').length === 32, '逐题复盘 32 条 (v0.8.6 通用 32 题, 含折叠隐藏)');
  ok(document.querySelector('#sharedBanner').hidden === true, '非分享结果: sharedBanner 隐藏');
  // 分级代号显式展示 (全选D => L4)
  const lvlBadge = document.querySelector('#resultBody .lvl-badge');
  ok(lvlBadge && lvlBadge.textContent.trim() === 'L4', '结果卡显式标注分级 L-code= L4, 实际=' + (lvlBadge && lvlBadge.textContent.trim()));
  // 核心建议徽标含 L-code (第一个 badge 是雷达的"6 维度", 故查全部)
  const badges = Array.prototype.slice.call(document.querySelectorAll('#resultBody .block-h .badge'));
  ok(badges.some(function (b) { return /基于本次作答.*个体化/.test(b.textContent); }), '核心建议徽标含「基于本次作答 · 个体化」 (v0.8.6 个体化解读)');
  // 计分规则说明 + D 不再是"推荐"
  ok(document.querySelector('#resultBody .review-note') !== null, '逐题复盘含计分规则说明');
  const firstReview = document.querySelector('#resultBody .review-item');
  ok(/最高成熟度/.test(firstReview.textContent) && !/（推荐）/.test(firstReview.textContent), 'D 标注为「最高成熟度」且不再写「推荐」');
  ok(/你的选择/.test(firstReview.textContent), '逐题复盘标注「你的选择」');
  // v0.8.9 P2-3: 复盘默认折叠的题应跨多个维度, 不再全押 D1
  const dimNames = window.APCA_DATA.dimensions.map(function (d) { return d.name; });
  const shownItems = Array.prototype.slice.call(document.querySelectorAll('#resultBody .review-item[data-relevant="1"]'));
  const shownDims = {};
  shownItems.forEach(function (el) {
    const meta = el.querySelector('.review-meta');
    const t = meta ? meta.textContent : '';
    dimNames.forEach(function (n) { if (t.indexOf(n) === 0) shownDims[n] = 1; });
  });
  ok(shownItems.length > 0 && Object.keys(shownDims).length >= 2,
    'P2-3 复盘默认折叠覆盖多维度(不偏 D1), 展示 ' + shownItems.length + ' 题 / 覆盖 ' + Object.keys(shownDims).length + ' 个维度');
  // 测评人信息随记录落库并在结果页展示
  const rec0 = JSON.parse(store.apca_history_v1)[0];
  ok(rec0.info && rec0.info.name === '测试张三', '记录含测评人姓名, 实际=' + (rec0.info && rec0.info.name));
  ok(rec0.info && rec0.info.batch === '2026内训第一批', '记录含测评批次, 实际=' + (rec0.info && rec0.info.batch));
  ok(rec0.clientId && /^c_/.test(rec0.clientId), '记录含本机 clientId, 实际=' + rec0.clientId);
  const personEl = document.querySelector('#resultBody .level-person');
  ok(personEl !== null && /测试张三/.test(personEl.textContent), '结果页展示测评人信息');

  // ---------- 历史 ----------
  log('I 历史记录');
  const histLink = document.querySelector('#linkHistory');
  histLink.dispatchEvent(new Event('click'));
  ok(document.querySelector('#view-history').hidden === false, '进入历史页');
  ok(document.querySelectorAll('#historyList .hist-item').length === 1, '历史有 1 条记录');
  ok(JSON.parse(store.apca_history_v1).length === 1, 'localStorage 落库 1 条');

  document.querySelector('#historyList .hist-item').dispatchEvent(new Event('click'));
  ok(document.querySelector('#view-result').hidden === false, '点击历史项回到结果页');

  // ---------- 专项 standalone 流程 ----------
  log('J 专项 standalone 流程');
  document.querySelector('#btnResultHome').dispatchEvent(new Event('click'));
  ok(document.querySelector('#view-home').hidden === false, '回到首页');
  let bidPack = null;
  document.querySelectorAll('#packList .pack').forEach((p) => { if (p.getAttribute('data-pack') === 'bid') bidPack = p; });
  bidPack.dispatchEvent(new Event('click'));
  ok(document.querySelector('#modeCard').hidden === false, '选专项后测法卡片显示');
  let standaloneRadio = null;
  document.querySelectorAll('.mode-opt input').forEach((i) => { if (i.value === 'standalone') standaloneRadio = i; });
  standaloneRadio.checked = true;
  standaloneRadio.dispatchEvent(new Event('change'));
  document.querySelector('#btnStart').dispatchEvent(new Event('click'));
  ok(document.querySelector('#view-info').hidden === false, '专项流程同样先经信息页');
  document.querySelector('#infoName').value = '李四';
  document.querySelector('#infoCompany').value = '示例科技有限公司';
  document.querySelector('#infoPosition').value = '投标专员';
  document.querySelector('#infoBatch').value = '2026内训第一批';
  document.querySelector('#btnInfoStart').dispatchEvent(new Event('click'));
  ok(/第 1 \/ 18 题/.test(document.querySelector('#quizCounter').textContent), 'standalone 计数器=第1/18题, 实际=' + document.querySelector('#quizCounter').textContent.trim());
  // v0.8.10 P2-4 验证用: 走「无合并」路径, 让复盘只跑 18 题专项, 触发兜底降级文案
  //   (若不清掉历史, findGeneralRecord 会自动合并通用 32 题 + 18 题专项, qs=50 题, 兜底不触发)
  delete store.apca_history_v1;
  localStorage.removeItem('apca_history_v1');
  const bidQs = window.APCA_DATA.packs.filter((p) => p.id === 'bid')[0].questions;
  let a2 = 0, g2 = 0;
  while (g2++ < 100) {
    const co = document.querySelectorAll('#quizCard .opt');
    if (!co.length) break;
    const bestL2 = bestLetterOfCurrent(bidQs);
    let d = null; co.forEach((o) => { if (o.getAttribute('data-letter') === bestL2) d = o; });
    d.dispatchEvent(new Event('click')); a2++;
    const nb = document.querySelector('#btnNext');
    const last = /提交测评/.test(nb.textContent);
    nb.dispatchEvent(new Event('click'));
    if (last) break;
  }
  ok(a2 === 18, 'standalone 18 题作答, 实际=' + a2);
  ok(document.querySelector('#view-result').hidden === false, '专项提交进入结果页');
  // v0.8.10 P2-4 验证用: 上面清掉了历史避免合并, 所以落库只有 1 条 (J 段专项)
  ok(JSON.parse(store.apca_history_v1).length === 1, 'J 段无合并, 落库 1 条专项记录 (历史=' + JSON.parse(store.apca_history_v1).length + ')');

  // v0.8.10 P2-4 降级文案: 专项卷 18 题作答后, 复盘默认折叠全开,
  //   且应显示「本次为专项卷作答」+ 「能力点级解读需配合通用 N 题作答开启」的引导, 而非原「画像信息缺失」不明不白。
  const reviewBox2 = document.querySelector('#resultBody .review-list');
  ok(reviewBox2 && reviewBox2.getAttribute('data-showall') === '1', '专项卷复盘默认全展开 (兜底生效)');
  const reviewBodyHtml = document.querySelector('#resultBody').innerHTML;
  ok(/本次为专项卷作答/.test(reviewBodyHtml) && /能力点级解读需配合通用 \d+ 题作答开启/.test(reviewBodyHtml),
    'P2-4 专项卷降级文案正确(明确引导 + 不暴露内部缺失)');

  // ---------- 分享链接解码 ----------
  log('K 分享链接解码(含 v0.8.9 P1-4 防伪造)');
  const coreQs = window.APCA_DATA.core;
  // 通用卷全选满分 → 重算应 = 100 / L4
  const realAnswers = {};
  coreQs.forEach((q) => { realAnswers[q.id] = 100; });
  const payload = {
    t: 'r', v: 1, packId: 'none', mode: 'blended', isStandalone: false,
    packName: '通用版', answers: realAnswers, ts: Date.now()
  };
  const b64 = b64safe.b64encodeUnicode(JSON.stringify(payload));
  location.hash = '#r=' + b64;
  window.dispatchEvent(new Event('hashchange'));
  ok(document.querySelector('#view-result').hidden === false, '分享链接进入结果页');
  ok(document.querySelector('#sharedBanner').hidden === false, '分享横幅显示');
  ok(/100/.test(document.querySelector('#resultBody .level-score .num').textContent),
    'P1-4 分享按 answers 重算: 全 100 分作答 → 显示 100');

  // v0.8.9 P1-4 防伪造: payload 声称 total=100/L4, 但 answers 全是 0 分 → 必须重算成 0 分低等级
  const forgedAnswers = {};
  coreQs.forEach((q) => { forgedAnswers[q.id] = 0; });
  const forged = {
    t: 'r', v: 1, packId: 'none', mode: 'blended', isStandalone: false,
    packName: '通用版',
    total: 100, levelId: 'L4', levelName: '系统模式',   // ← 伪造字段, 应被忽略
    dimScores: { D1: 100, D2: 100, D3: 100, D4: 100, D5: 100, D6: 100 },
    answers: forgedAnswers, qcount: 32, ts: Date.now()
  };
  location.hash = '#r=' + b64safe.b64encodeUnicode(JSON.stringify(forged));
  window.dispatchEvent(new Event('hashchange'));
  const forgedShown = document.querySelector('#resultBody .level-score .num').textContent;
  ok(!/100/.test(forgedShown),
    'P1-4 防伪造: payload 谎报 total=100/L4 但作答全 0 → 重算后不再显示 100 (实际=' + forgedShown.trim() + ')');

  log('');
  log('==== 结果: ' + pass + ' PASS / ' + fail + ' FAIL ====');
  process.exit(fail ? 1 : 0);
} catch (e) {
  log('THROW: ' + e.message);
  log(e.stack);
  process.exit(2);
}
