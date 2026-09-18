// tools/lib/shuffle.js
// v0.8 选项乱序库 (build-web-data.js 与 verify-web.js 共用, 保证口径一致)
//
// 背景: 固定 A=0/B=33.3/C=66.7/D=100 会让受测者发现"总选 D 得高分"的规律。
// 做法: 源数据 (miniprogram/data/) 仍按成熟度升序 A→D 撰写;
//       导出 web/data.js 时按题目 id 做确定性乱序:
//   1. 选项文本连同其分值一起换位置 (语义/计分不变, 只是展示位置变了);
//   2. 每题输出 scores 字段 {A,B,C,D} 标注该题各字母实际分值;
//   3. 解析文本中的独立 A/B/C/D 字母引用同步重映射 (安全前提: 全库解析
//      的字母均为"X 是…"式选项指代, 无 D4/L3/AI/B端 等会被误伤的形态,
//      已用上下文扫描确认; 题干/场景无字母引用)。
//   4. 乱序由 qid 种子决定, 重建 data.js 结果稳定 (localStorage 里存的是
//      分值而非字母, 历史记录/未完成进度天然兼容)。

const LETTERS = ['A', 'B', 'C', 'D'];

// FNV-1a 字符串哈希 → 32 位种子
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 确定性 PRNG
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 返回该题的乱序排列 p: p[展示位] = 源成熟度下标 (0..3, 对应源 A..D)
function permOf(qid) {
  const rnd = mulberry32(hashSeed(qid + ':apca-shuffle-v1'));
  const p = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  return p;
}

// 独立字母 token: 前后都不是 ASCII 字母/数字 (排除 AI、D4-D8、L3、3D 等)
const LETTER_TOKEN_RE = /(?<![A-Za-z0-9])([ABCD])(?![A-Za-z0-9])/g;

// 解析字母重映射: 源字母 (成熟度位) → 展示字母
function remapAnalysis(text, p) {
  if (!text) return text;
  const srcToDisplay = {};
  for (let pos = 0; pos < 4; pos++) srcToDisplay[LETTERS[p[pos]]] = LETTERS[pos];
  return text.replace(LETTER_TOKEN_RE, (m) => (m in srcToDisplay ? srcToDisplay[m] : m));
}

// 对一道题做乱序导出 (不修改原对象)
function shuffleQuestion(q, scoreMap) {
  const p = permOf(q.id);
  const options = {};
  const scores = {};
  LETTERS.forEach(function (posL, pos) {
    const srcL = LETTERS[p[pos]];
    options[posL] = q.options[srcL];
    scores[posL] = scoreMap[srcL];
  });
  return Object.assign({}, q, {
    options: options,
    scores: scores,
    analysis: remapAnalysis(q.analysis, p)
  });
}

module.exports = { LETTERS, hashSeed, mulberry32, permOf, remapAnalysis, shuffleQuestion };
