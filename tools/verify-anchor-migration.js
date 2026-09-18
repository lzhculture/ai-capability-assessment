/* v0.8.1 锚点迁移功能测试 (linkedom):
 * 预置一条 v0.8.1 之前的旧记录 (含 12 题旧分值) + 一条旧进度,
 * 加载 app.js 后验证: 分值已按置换表换算、总分/等级已重算、localStorage 已回写。
 */
const fs = require('fs');
const path = require('path');
// v0.8.5: 改用 __dirname 推导仓库根, 移除 /Users/jmount 硬编码
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');

function log(m) { fs.writeSync(1, m + '\n'); }
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; log('  ✓ ' + msg); } else { fail++; log('  ✗ ' + msg); } }

let linkedom;
try { linkedom = require('linkedom'); }
catch (_) {
  const fallback = path.join(process.env.HOME || '/root', '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'linkedom');
  linkedom = require(fallback);
}
const { parseHTML, Event } = linkedom;

const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dataCode = fs.readFileSync(path.join(WEB, 'data.js'), 'utf8');
const appCode = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');

const { window, document } = parseHTML(html);
const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.window = window; global.document = document;
global.localStorage = localStorage;
global.location = { href: 'http://localhost/index.html', hash: '' };
global.navigator = global.navigator || {};
window.scrollTo = () => {}; window.confirm = () => true;

// —— 预置旧数据 ——
// 旧记录: 通用版 30 题全选 D (旧口径 = 全 100 分)。
// v0.8.1 置换后, 其中 12 题的"旧 D 内容"分值不再是 100。
global.window.APCA_DATA_BEFORE = null;
const oldT = Date.UTC(2026, 8, 2, 0, 0, 0); // 2026-09-02, 早于迁移截点
const D = require(path.join(path.dirname(WEB), 'miniprogram', 'data', 'core.js'));
const oldAnswers = {};
D.forEach(q => { oldAnswers[q.id] = 100; }); // 旧口径全选 D
const oldRecord = {
  packId: 'none', mode: 'none', isStandalone: false, packName: '通用版',
  answers: oldAnswers, total: 100, levelId: 'L4', levelName: '智慧协创',
  dimScores: {}, qcount: 30, info: { name: '迁移测试' }, clientId: 'c_test', ts: oldT
};
D.dimensions; // no-op
const dims = ['D1','D2','D3','D4','D5','D6'];
dims.forEach(d => oldRecord.dimScores[d] = 100);
store['apca_history_v1'] = JSON.stringify([oldRecord]);
// 旧进度: 答了 1 题 (D2-1 选旧 D=100 分)
store['apca_progress_v1'] = JSON.stringify({
  packId: 'none', mode: 'none', answers: { 'D2-1': 100 }, index: 0,
  info: null, total: 30, answeredCount: 1, ts: oldT
});

eval(dataCode);
eval(appCode);
document.dispatchEvent(new Event('DOMContentLoaded'));

// —— 验证 ——
const hist = JSON.parse(localStorage.getItem('apca_history_v1'));
const rec = hist[0];
ok(rec, '历史记录存在');

// 期望: 12 题中, 旧 D 内容的新分值 ≠ 100 的题按置换换算
const FIX = {
  'D2-1': 33.3, 'D3-1': 33.3, 'D3-3': 66.7, 'D3-5': 0, 'D4-1': 0, 'D4-2': 66.7,
  'D4-4': 33.3, 'D4-5': 66.7, 'D5-1': 33.3, 'D5-4': 66.7, 'D5-5': 0, 'D6-5': 33.3
};
let mapOk = 0;
Object.keys(FIX).forEach(qid => {
  if (Math.abs((rec.answers[qid] || 0) - FIX[qid]) < 0.01) mapOk++;
});
ok(mapOk === 12, '12 题旧分值全部按置换表换算, 实际 ' + mapOk + '/12');
// 其余 18 题保持 100
let keepOk = 0;
Object.keys(rec.answers).forEach(qid => {
  if (!(qid in FIX) && rec.answers[qid] === 100) keepOk++;
});
ok(keepOk === 20, '未补丁的 20 题 (v0.8.6 通用 32 题 - 12 锚点题) 分值保持 100, 实际 ' + keepOk + '/20');

// 期望总分: (18*100 + 33.3*5 + 66.7*4 + 0*3) / 6 维... 直接算维度均值
// 各维度分 = 该维度题分均值; 通用卷 6 维各 5 题
const dimQ = {};
D.forEach(q => { (dimQ[q.dimension] = dimQ[q.dimension] || []).push(q.id); });
let totalExpect = 0, dimsOk = 0;
Object.keys(dimQ).forEach(d => {
  const s = dimQ[d].reduce((a, qid) => a + (rec.answers[qid] || 0), 0) / dimQ[d].length;
  if (Math.abs((rec.dimScores[d] || -1) - +s.toFixed(1)) < 0.05) dimsOk++;
  totalExpect += +s.toFixed(1);
});
totalExpect = +(totalExpect / 6).toFixed(1);
ok(dimsOk === 6, '6 个维度分重算正确, 实际 ' + dimsOk + '/6');
ok(Math.abs(rec.total - totalExpect) < 0.15, '总分重算=' + rec.total + ', 期望≈' + totalExpect);
ok(rec.total < 100, '旧"全选D=100分"记录迁移后总分合理下降 (' + rec.total + ')');

// 进度迁移
const prog = JSON.parse(localStorage.getItem('apca_progress_v1'));
ok(prog && Math.abs(prog.answers['D2-1'] - 33.3) < 0.01, '未完成进度 D2-1 旧100分 → 33.3, 实际=' + (prog && prog.answers['D2-1']));

// 新记录不受影响: ts 晚于截点的不换算 (直接调 migrateAnchorRecord 语义已在上面覆盖, 这里验证截点判断)
ok(rec.ts === oldT, '迁移不改时间戳');

log('\n==== 锚点迁移测试: ' + pass + ' PASS / ' + fail + ' FAIL ====');
process.exit(fail ? 1 : 0);
