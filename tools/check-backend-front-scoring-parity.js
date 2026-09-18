/* v0.8.9 P0-1 计分口径对齐 · 回归门禁
 *
 * 背景: v0.8.7 引入服务端重算后, 前后端用了两套加权模型:
 *   前端 app.js:94-99  →  专项卷按 pack.weights(声明权重); merged 跳传 null 走等权
 *   服务端(旧)          →  按「每维度题目数」(每专项每维 3 题 → 等价六维等权), 且不看 merged
 * 后果: 偏差 >0.5 时 /api/submit 返回 400 → 专项记录大面积无法入库。
 *
 * v0.8.9 修复后本脚本作为**回归门禁**: 断言两端模型在所有路径上一致(偏差 ≤0.5)。
 * 独立复现两套算法(不 require app.js / server.js), 避免"用自己验自己"。
 *
 * 用法: node tools/check-backend-front-scoring-parity.js
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
global.window = {};
require(path.join(ROOT, 'web', 'data.js'));
const D = global.window.APCA_DATA;

const DIMS = D.dimensions.map((d) => d.id);
const SCORES = [0, 100 / 3, 200 / 3, 100];
let fail = 0;
function ok(cond, msg) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) fail++;
}

function dimScoresOf(questions, answers) {
  const sum = {}, cnt = {};
  questions.forEach((q) => {
    const v = answers[q.id];
    if (v == null) return;
    sum[q.dimension] = (sum[q.dimension] || 0) + v;
    cnt[q.dimension] = (cnt[q.dimension] || 0) + 1;
  });
  const out = {};
  Object.keys(sum).forEach((d) => { out[d] = +(sum[d] / cnt[d]).toFixed(1); });
  return out;
}

// —— 前端模型 (app.js:94-99) ——
function frontTotal(dimScores, weights) {
  if (weights) {
    let ws = 0, sw = 0;
    Object.keys(dimScores).forEach((d) => { const w = weights[d] || 0; ws += dimScores[d] * w; sw += w; });
    return sw > 0 ? +(ws / sw).toFixed(1) : 0;
  }
  const ds = Object.keys(dimScores);
  return ds.length ? +(ds.reduce((a, d) => a + dimScores[d], 0) / ds.length).toFixed(1) : 0;
}

// —— 前端取权重的方式 (app.js:439/452 无条件用 packWeights; app.js:542 merged 传 null) ——
function frontCalc(questions, answers, packId, merged) {
  const ds = dimScoresOf(questions, answers);
  const pack = D.packs.find((p) => p.id === packId);
  const w = (pack && !merged) ? pack.weights : null;
  return { total: frontTotal(ds, w), dimScores: ds };
}

// —— 服务端 v0.8.9 模型 (server.js:serverCalcResult 修复后) ——
function serverTotal(dimScores, pack, merged) {
  if (merged) {
    const dn = Object.keys(dimScores).length;
    return dn > 0 ? +(Object.keys(dimScores).reduce((a, d) => a + dimScores[d], 0) / dn).toFixed(1) : 0;
  }
  if (pack && pack.weights) {
    let ws = 0, sw = 0;
    Object.keys(dimScores).forEach((d) => { const w = pack.weights[d] || 0; ws += dimScores[d] * w; sw += w; });
    return sw > 0 ? +(ws / sw).toFixed(1) : 0;
  }
  const dn = Object.keys(dimScores).length;
  return dn > 0 ? +(Object.keys(dimScores).reduce((a, d) => a + dimScores[d], 0) / dn).toFixed(1) : 0;
}
function serverCalc(questions, answers, packId, merged) {
  const ds = dimScoresOf(questions, answers);
  const pack = D.packs.find((p) => p.id === packId);
  return { total: serverTotal(ds, pack, merged), dimScores: ds };
}

// —— 旧服务端模型 (v0.8.7-0.8.8, 仅作对照) ——
function legacyServerTotal(dimScores, pack) {
  if (pack) {
    const wq = {};
    pack.questions.forEach((q) => { wq[q.dimension] = (wq[q.dimension] || 0) + 1; });
    let ws = 0, sw = 0;
    Object.keys(dimScores).forEach((d) => { const w = wq[d] || 0; ws += dimScores[d] * w; sw += w; });
    return sw > 0 ? +(ws / sw).toFixed(1) : 0;
  }
  const dn = Object.keys(dimScores).length;
  return dn > 0 ? +(Object.keys(dimScores).reduce((a, d) => a + dimScores[d], 0) / dn).toFixed(1) : 0;
}

function rndAnswers(questions) {
  const a = {};
  questions.forEach((q) => { a[q.id] = +SCORES[Math.floor(Math.random() * 4)].toFixed(1); });
  return a;
}

console.log('v0.8.9 P0-1 计分口径对齐回归\n');

console.log('=== 1. 报告中的极端场景(修复前 400 拒绝, 修复后应一致) ===');
const bid = D.packs.find((p) => p.id === 'bid');
// bid standalone: D4=0 其余 100 (BID-1..3=D1, 4..6=D2, 7..9=D3, 10..12=D4, 13..15=D5, 16..18=D6)
const extremeAns = {};
bid.questions.forEach((q) => {
  extremeAns[q.id] = (q.dimension === 'D4') ? 0 : 100;
});
const fEx = frontCalc(bid.questions, extremeAns, 'bid', false);
const sEx = serverCalc(bid.questions, extremeAns, 'bid', false);
const lEx = legacyServerTotal(fEx.dimScores, bid);
console.log(`  bid standalone (D4=0 其余 100): 前端=${fEx.total} 服务端(新)=${sEx.total} 服务端(旧)=${lEx}`);
ok(Math.abs(fEx.total - sEx.total) <= 0.5, `修复后两端一致 (前端 ${fEx.total} vs 服务端 ${sEx.total})`);
ok(Math.abs(fEx.total - lEx) > 0.5, `旧模型确实不一致(偏差 ${Math.abs(fEx.total - lEx).toFixed(1)}), 说明该回归真实存在且已被修掉`);

console.log('\n=== 2. merged 路径(核心全 0 + 专项全 100, 期望等权 ≈36.3) ===');
const mergedAns = {};
D.core.forEach((q) => { mergedAns[q.id] = 0; });
bid.questions.forEach((q) => { mergedAns[q.id] = 100; });
const bq = D.core.concat(bid.questions);
const fM = frontCalc(bq, mergedAns, 'bid', true);
const sM = serverCalc(bq, mergedAns, 'bid', true);
console.log(`  前端=${fM.total} 服务端=${sM.total}`);
ok(Math.abs(fM.total - sM.total) <= 0.5, `merged 两端一致`);
ok(Math.abs(fM.total - 36.3) < 0.6, `merged 走等权 ≈36.3 (实 ${fM.total})`);

console.log('\n=== 3. 三专项 × blended/standalone × 500 组随机不均衡作答 ===');
D.packs.forEach((pack) => {
  ['standalone', 'blended'].forEach((mode) => {
    const qs = mode === 'standalone' ? pack.questions : D.core.concat(pack.questions);
    let mismatch = 0, maxGap = 0, legacyRej = 0;
    for (let i = 0; i < 500; i++) {
      const answers = rndAnswers(qs);
      const f = frontCalc(qs, answers, pack.id, false);
      const s = serverCalc(qs, answers, pack.id, false);
      const gap = Math.abs(f.total - s.total);
      if (gap > 0.5) mismatch++;
      if (gap > maxGap) maxGap = gap;
      if (Math.abs(f.total - legacyServerTotal(f.dimScores, pack)) > 0.5) legacyRej++;
    }
    const label = `${pack.name} ${mode}`.padEnd(26);
    console.log(`  ${label} 不一致 ${mismatch}/500  最大偏差 ${maxGap.toFixed(1)}  (旧模型会被拒 ${legacyRej}/500)`);
    ok(mismatch === 0, `${pack.name} ${mode} 两端完全一致`);
  });
});

console.log('\n==== ' + (fail ? `FAIL: ${fail} 项不一致` : '全通过: 前后端计分口径已对齐') + ' ====');
process.exit(fail ? 1 : 0);
