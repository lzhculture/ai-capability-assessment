// utils/calc.js
// 评分/等级/排序 等纯函数

const LEVELS = require('../data/levels.js').levels;
const SCORE_MAP = require('../data/levels.js').scoreMap;
const REPORTS = require('../data/reports.js');

/**
 * 计算结果
 * @param {Array} questions - 题目数组 (来自 core + pack)
 * @param {Object} answers   - {qid: score} 0/33.3/66.7/100
 * @param {Object|null} weights - 维度权重 {D1..D6}; 传 null 走等权 (通用/blended 默认)
 * @returns { total, dimScores:{D1..D6}, answered, level }
 */
function calcResult(questions, answers, weights) {
  const dimScores = {};
  const dimCount = {};
  Object.keys(answers).forEach(qid => {
    const q = questions.find(x => x.id === qid);
    if (!q) return;
    const s = answers[qid];
    if (s == null) return;
    dimScores[q.dimension] = (dimScores[q.dimension] || 0) + s;
    dimCount[q.dimension] = (dimCount[q.dimension] || 0) + 1;
  });
  Object.keys(dimScores).forEach(d => {
    dimScores[d] = +(dimScores[d] / dimCount[d]).toFixed(1);
  });
  let total;
  if (weights) {
    // 专项单独成卷: 用该专项自己的测试标准 (维度权重)
    let ws = 0, sw = 0;
    Object.keys(dimScores).forEach(d => {
      const w = weights[d] || 0;
      ws += dimScores[d] * w;
      sw += w;
    });
    total = sw > 0 ? ws / sw : 0;
  } else {
    // 通用 / blended: 六维等权。
    // v0.8.5: 原固定 /6, 有维度未作答时会低估总分; 改为按实际参与计分的维度数归一化。
    const dn = Object.keys(dimScores).length;
    total = dn > 0 ? Object.values(dimScores).reduce((a, b) => a + b, 0) / dn : 0;
  }
  // v0.8.7 P0-2.1: 完整性校验防缺答刷满分
  let answered = 0;
  Object.keys(answers).forEach((k) => { if (answers[k] != null) answered++; });
  const completeness = questions.length > 0 ? +(answered / questions.length).toFixed(3) : 0;
  let level = levelOf(total);
  if (completeness < 0.5) level = { id: null, name: '未答完 · 不出等级', score_range: [0, 100] };
  return {
    total: +total.toFixed(1),
    dimScores,
    answered,
    completeness,
    level
  };
}

/**
 * 根据总分查等级
 */
function levelOf(score) {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (score >= LEVELS[i].score_range[0]) return LEVELS[i];
  }
  return LEVELS[0];
}

/**
 * 强项/弱项前 N 个维度 id
 */
function rankDims(dimScores, top = 1) {
  return Object.keys(dimScores)
    .map(d => ({ id: d, score: dimScores[d] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, top)
    .map(x => x.id);
}

function weakDims(dimScores, top = 2) {
  return Object.keys(dimScores)
    .map(d => ({ id: d, score: dimScores[d] }))
    .sort((a, b) => a.score - b.score)
    .slice(0, top)
    .map(x => x.id);
}

/**
 * 30 天学习地图
 */
function buildLearningMap(dimScores) {
  return REPORTS.learningMap(dimScores);
}

/**
 * 核心建议 (按等级)
 */
function buildAdvice(level) {
  return REPORTS.coreAdvice(level);
}

/**
 * 等级提示
 */
function buildTip(level) {
  return REPORTS.levelTip(level);
}

module.exports = {
  SCORE_MAP,
  calcResult,
  levelOf,
  rankDims,
  weakDims,
  buildLearningMap,
  buildAdvice,
  buildTip
};