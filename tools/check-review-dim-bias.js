/* v0.8.9 P2-3 独立验证: 复盘默认折叠的「关联能力点」维度偏置
 *
 * 背景: 旧实现 (v0.8.6-v0.8.8) 用 profile.globalWeakAbilities = 全卷能力点升序取前 3,
 *       由于 D1 题多 (5 题) 且能力点多, 最弱能力点约 74.7% 落在 D1 → 复盘默认只展开 D1 的题。
 * 本脚本独立复现两套算法的选取逻辑 (不 require app.js, 直接按公式重算),
 * 对随机作答统计「最弱 3 个能力点落在 D1 的比例」, 验证 v0.8.9 修复效果。
 *
 * 用法: node tools/check-review-dim-bias.js
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
global.window = {};
require(path.join(ROOT, 'web', 'data.js'));
const D = global.window.APCA_DATA;

const DIMS = D.dimensions.map((d) => d.id);
const SCORES = [0, 100 / 3, 200 / 3, 100];

// —— 复现 analyzeProfile 的能力点聚合 (app.js:184-211) ——
function buildProfile(questions, answers) {
  const dimQ = {};
  questions.forEach((q) => { dimQ[q.dimension] = (dimQ[q.dimension] || 0) + 1; });
  const abilityScores = {};
  Object.keys(answers).forEach((qid) => {
    const q = questions.find((x) => x.id === qid);
    if (!q) return;
    const s = answers[qid];
    if (s == null) return;
    const abls = q.abilities || [];
    if (!abls.length) return;
    const perAbl = s / abls.length;
    abls.forEach((a) => {
      if (!abilityScores[q.dimension]) abilityScores[q.dimension] = {};
      abilityScores[q.dimension][a] = (abilityScores[q.dimension][a] || 0) + perAbl;
    });
  });
  Object.keys(abilityScores).forEach((dim) => {
    const qN = dimQ[dim] || 1;
    Object.keys(abilityScores[dim]).forEach((a) => {
      abilityScores[dim][a] = +((abilityScores[dim][a] / 100) * 100 / qN).toFixed(1);
    });
  });
  return abilityScores;
}

// —— 旧算法: globalWeakAbilities (全卷能力点升序前 3) ——
function oldPick(abilityScores) {
  const all = [];
  Object.keys(abilityScores).forEach((d) => {
    Object.keys(abilityScores[d]).forEach((a) => all.push({ dim: d, k: a, s: abilityScores[d][a] }));
  });
  all.sort((a, b) => a.s - b.s);
  return all.slice(0, 3);
}

// —— 新算法: pickWeakAbilitiesByDim (维度分升序, 每维取最弱能力点, 取 3 个维度) ——
function newPick(abilityScores, dimScores) {
  const sortedDims = DIMS.slice().sort((a, b) => (dimScores[a] || 0) - (dimScores[b] || 0));
  const out = [];
  for (let i = 0; i < sortedDims.length && out.length < 3; i++) {
    const dim = sortedDims[i];
    const abl = abilityScores[dim] || {};
    const ranked = Object.keys(abl).map((k) => ({ k, s: abl[k] })).sort((a, b) => a.s - b.s);
    if (ranked.length) out.push({ dim, k: ranked[0].k, s: ranked[0].s });
  }
  return out;
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

const RUNS = 500;
let oldD1 = 0, newD1 = 0, oldSlots = 0, newSlots = 0;
for (let i = 0; i < RUNS; i++) {
  const answers = {};
  D.core.forEach((q) => { answers[q.id] = +SCORES[Math.floor(Math.random() * 4)].toFixed(1); });
  const abilityScores = buildProfile(D.core, answers);
  const dimScores = dimScoresOf(D.core, answers);
  oldPick(abilityScores).forEach((x) => { oldSlots++; if (x.dim === 'D1') oldD1++; });
  newPick(abilityScores, dimScores).forEach((x) => { newSlots++; if (x.dim === 'D1') newD1++; });
}

console.log('v0.8.9 P2-3 复盘维度偏置独立验证（' + RUNS + ' 组随机通用卷作答）');
console.log('  旧算法 globalWeakAbilities : 落在 D1 的能力点 ' + oldD1 + '/' + oldSlots +
  ' = ' + (oldD1 / oldSlots * 100).toFixed(1) + '%  ← 报告实测约 74.7%');
console.log('  新算法 pickWeakAbilitiesByDim: 落在 D1 的能力点 ' + newD1 + '/' + newSlots +
  ' = ' + (newD1 / newSlots * 100).toFixed(1) + '%');
const improved = oldD1 / oldSlots > newD1 / newSlots;
console.log(improved ? '  ✓ 新算法显著降低 D1 偏置' : '  ✗ 新算法未见改善');
process.exit(improved ? 0 : 1);
