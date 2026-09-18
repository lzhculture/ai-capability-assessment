/* 合并出分逻辑仿真测试: 复刻 app.js 中 submit() 的合并块,
 * 验证「单独成卷 + 最近通用记录」等价于「blended 加测卷」。 */
'use strict';
global.window = {};
require('../web/data.js');
var D = global.window.APCA_DATA || global.APCA_DATA;

function buildQuestions(packId, mode) {
  if (packId && packId !== 'none') {
    var p = D.packs.find(function (x) { return x.id === packId; });
    if (p) return mode === 'standalone' ? p.questions.slice() : D.core.concat(p.questions);
  }
  return D.core.slice();
}
function levelOf(score) {
  var ls = D.levels;
  for (var i = ls.length - 1; i >= 0; i--) if (score >= ls[i].score_range[0]) return ls[i];
  return ls[0];
}
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
  Object.keys(dimScores).forEach(function (d) { dimScores[d] = +(dimScores[d] / dimCount[d]).toFixed(1); });
  var total;
  if (weights) {
    var ws = 0, sw = 0;
    Object.keys(dimScores).forEach(function (d) { var w = weights[d] || 0; ws += dimScores[d] * w; sw += w; });
    total = sw > 0 ? ws / sw : 0;
  } else {
    // v0.8.5: 与 app.js 同步 —— 按实际参与计分的维度数归一化, 而非固定 /6。
    var dn = Object.keys(dimScores).length;
    total = dn > 0 ? Object.keys(dimScores).reduce(function (a, d) { return a + dimScores[d]; }, 0) / dn : 0;
  }
  return { total: +total.toFixed(1), dimScores: dimScores, level: levelOf(total) };
}

var pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' => ' + detail : '')); }
}

// ---- 场景: 先做通用卷, 再单独成卷做招投标专项 ----
var coreQs = D.core;
var bidPack = D.packs.find(function (x) { return x.id === 'bid'; });
var blendedQs = buildQuestions('bid', 'blended');
var standaloneQs = buildQuestions('bid', 'standalone');

// 1. 假设用户对所有题都选 D(100 分)
var generalAnswers = {}; coreQs.forEach(function (q) { generalAnswers[q.id] = 100; });
var saAnswers = {}; standaloneQs.forEach(function (q) { saAnswers[q.id] = 100; });
var blendedAnswers = {}; blendedQs.forEach(function (q) { blendedAnswers[q.id] = 100; });

// 通用记录
var gRes = calcResult(coreQs, generalAnswers, null);
// 单独成卷原始得分 (standalone weights)
var saRes = calcResult(standaloneQs, saAnswers, bidPack.weights);
// 合并块 (与 app.js submit() 一致)
var mergedAnswers = {};
var coreIds = {}; coreQs.forEach(function (q) { coreIds[q.id] = 1; });
Object.keys(generalAnswers).forEach(function (qid) { if (coreIds[qid]) mergedAnswers[qid] = generalAnswers[qid]; });
Object.keys(saAnswers).forEach(function (qid) { mergedAnswers[qid] = saAnswers[qid]; });
var bq = buildQuestions('bid', 'blended');
var mRes = calcResult(bq, mergedAnswers, null);
// 直接 blended 参照
var bRes = calcResult(blendedQs, blendedAnswers, null);

check('全选D: 合并得分 = blended 参照 (' + mRes.total + ' vs ' + bRes.total + ')', mRes.total === bRes.total);
check('全选D: 合并等级 = L4', mRes.level.id === 'L4');
check('全选D: 合并题数 = 50 (32+18)', bq.length === 50);
check('全选D: 专项单独得分 = 100', saRes.total === 100);

// 2. 混合作答: 通用选 B(33.3), 专项选 C(66.7)
var gA2 = {}; coreQs.forEach(function (q) { gA2[q.id] = 33.3; });
var sA2 = {}; standaloneQs.forEach(function (q) { sA2[q.id] = 66.7; });
var mA2 = {};
Object.keys(gA2).forEach(function (qid) { if (coreIds[qid]) mA2[qid] = gA2[qid]; });
Object.keys(sA2).forEach(function (qid) { mA2[qid] = sA2[qid]; });
var mRes2 = calcResult(bq, mA2, null);
// 参照: 直接 blended 相同作答
var bA2 = {}; blendedQs.forEach(function (q) { bA2[q.id] = coreIds[q.id] ? 33.3 : 66.7; });
var bRes2 = calcResult(blendedQs, bA2, null);
check('混合作答: 合并得分 = blended 参照 (' + mRes2.total + ' vs ' + bRes2.total + ')', mRes2.total === bRes2.total);
check('混合作答: 六维均有分', Object.keys(mRes2.dimScores).length === 6);
check('混合作答: 合并等级 L2 (26-50)', mRes2.level.id === 'L2', '实际 ' + mRes2.level.id);

// 3. findGeneralRecord 口径: blended / 通用 / merged 记录均可作合并源
function isGeneralRec(r) { return r && (r.packId === 'none' || r.mode === 'blended' || r.merged); }
check('合并源判定: 通用版记录入选', isGeneralRec({ packId: 'none', mode: 'core' }));
check('合并源判定: blended 记录入选', isGeneralRec({ packId: 'bid', mode: 'blended' }));
check('合并源判定: merged 记录入选', isGeneralRec({ packId: 'bid', mode: 'standalone', merged: true }));
check('合并源判定: 纯单卷记录不入选', !isGeneralRec({ packId: 'bid', mode: 'standalone' }));

console.log('\n==== 合并逻辑仿真: ' + pass + ' PASS / ' + fail + ' FAIL ====');
process.exit(fail ? 1 : 0);
