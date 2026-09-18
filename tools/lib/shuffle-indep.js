// tools/lib/shuffle-indep.js
// v0.8.5 · 乱序结果的**独立**交叉校验器 (刻意不引用 tools/lib/shuffle.js)
//
// 背景 (第三份审查报告 T-2): 构建 (build-web-data.js) 与校验 (verify-web.js)
// 共用同一个 shuffle.js, 校验只是"用同一份实现重算一遍再比对"——
// 这只能证明"构建确实跑了乱序", 无法发现乱序实现本身的 bug
// (例如分值没跟着选项走、某一档分值丢失/重复)。
//
// 本模块用**完全不同的路径**独立推导每题各展示字母应有的分值:
//   源数据 A→D 即成熟度升序 → 源字母分值固定为 {A:0, B:33.3, C:66.7, D:100}(此处硬编码,
//   不从 levels.js / data.js 读取, 避免错误被传递);
//   对导出后的题, 取展示位 L 的**选项文本**, 回源题里查该文本属于哪个源字母,
//   则该展示位应有的分值 = 该源字母的固定分值。
//
// 该方法不依赖任何乱序算法, 因此能真正抓出"选项与分值错位"。
// 前提: 每题四个选项文本互不相同 (已由 verify 断言守护, 全库实测 0 例重复)。

// 源数据成熟度升序对应的固定分值 —— 硬编码, 作为独立基准
var SRC_SCORE = { A: 0, B: 33.3, C: 66.7, D: 100 };
var LETTERS = ['A', 'B', 'C', 'D'];

function norm(s) { return String(s == null ? '' : s).trim(); }

/**
 * 用文本反查法, 独立推导出导出题各展示字母应有的分值。
 * @param {Object} srcQ  真源题 (miniprogram/data/), 含 options {A,B,C,D}
 * @param {Object} outQ  导出题 (web/data.js), 含 options {A,B,C,D}
 * @returns {{ok: boolean, expect: Object, reason: string}}
 */
function expectedScores(srcQ, outQ) {
  if (!srcQ || !outQ) return { ok: false, expect: null, reason: '题目缺失' };

  // 1) 源侧: 文本 → 源字母 (要求唯一, 否则无法反查)
  var textToSrc = {}, dup = [];
  LETTERS.forEach(function (L) {
    var t = norm(srcQ.options && srcQ.options[L]);
    if (t in textToSrc) dup.push(t);
    textToSrc[t] = L;
  });
  if (dup.length) return { ok: false, expect: null, reason: '源题选项文本重复, 无法反查' };

  // 2) 导出侧: 逐个展示位用文本回查源字母 → 取固定分值
  var expect = {}, miss = [];
  LETTERS.forEach(function (L) {
    var t = norm(outQ.options && outQ.options[L]);
    var srcL = textToSrc[t];
    if (!srcL) { miss.push(L); return; }
    expect[L] = SRC_SCORE[srcL];
  });
  if (miss.length) return { ok: false, expect: null, reason: '导出选项文本在源题中找不到: ' + miss.join(',') };

  return { ok: true, expect: expect, reason: '' };
}

/**
 * 独立统计: 满分(100)选项落在各展示字母的题数分布。
 * 不读 data.js 的 scoreMap, 全靠文本反查推导。
 */
function distribution(pairs) {
  var dist = { A: 0, B: 0, C: 0, D: 0 };
  pairs.forEach(function (pr) {
    var r = expectedScores(pr.src, pr.out);
    if (!r.ok) return;
    LETTERS.forEach(function (L) { if (r.expect[L] === 100) dist[L]++; });
  });
  return dist;
}

module.exports = { SRC_SCORE: SRC_SCORE, LETTERS: LETTERS, expectedScores: expectedScores, distribution: distribution };
