// utils/review.js
// 逐题复盘: 基于用户实际作答, 挑出最值得讲的题做针对性解析
// 纯本地规则实现, 不需要服务端 / 不需要大模型

const SCORE_MAP = { A: 0, B: 33.3, C: 66.7, D: 100 };
const DIMS = require('../data/dimensions.js');

const DIM_NAME = {};
const DIM_TAGLINE = {};
DIMS.forEach((d) => {
  DIM_NAME[d.id] = d.name;
  DIM_TAGLINE[d.id] = d.tagline;
});

// 选项对应的"下一步该往哪走"提示
const NEXT_STEP = {
  A: '先建立「先想清楚再让 AI 动手」的习惯: 任何任务开工前, 先写一句话定义这次要交付什么、给谁用。',
  B: '你已经会用既有材料打底, 下一步是把「凭经验选」变成「按标准选」——把判断依据写成可复用的检查项。',
  C: '你已经形成了流程意识, 下一步是把它外化成资产: 写成模板/清单/Prompt 库, 让同事直接拿去用。',
  D: '这一项已达系统级。可考虑把你的做法整理成教学材料, 在团队内做一次分享。'
};

function scoreOf(letter) {
  return SCORE_MAP[letter] == null ? 0 : SCORE_MAP[letter];
}

/**
 * 挑出需要复盘的题
 * @param {Array} questions 完整卷面题目
 * @param {Array} answers   [{id, letter, score}] 或 {id: letter} 形式
 * @param {Number} limit    返回条数, 默认 4
 * @returns {Array} [{id, dimension, dimName, dimTagline, scene, question, yourLetter, yourText, yourScore, bestText, analysis, nextStep}]
 */
function pickReviewItems(questions, answers, limit) {
  limit = limit || 4;
  if (!Array.isArray(questions) || !Array.isArray(answers)) return [];

  // 统一 answers 为 map: id -> letter
  const map = {};
  answers.forEach((a) => {
    if (!a) return;
    if (typeof a === 'string') map[a] = null;
    else if (a.letter) map[a.id] = a.letter;
    else if (a.answer) map[a.id] = a.answer;
  });

  const items = [];
  questions.forEach((q) => {
    const letter = map[q.id];
    if (!letter || !q.options || !q.options[letter]) return;
    const score = scoreOf(letter);
    items.push({
      id: q.id,
      dimension: q.dimension,
      dimName: DIM_NAME[q.dimension] || q.dimension,
      dimTagline: DIM_TAGLINE[q.dimension] || '',
      scene: q.scene || '',
      question: q.question || '',
      yourLetter: letter,
      yourText: q.options[letter] || '',
      yourScore: Math.round(score),
      bestText: q.options.D || '',
      analysis: q.analysis || '',
      nextStep: NEXT_STEP[letter] || ''
    });
  });

  // 低分优先; 同分按维度内题序稳定排序
  items.sort((a, b) => {
    if (a.yourScore !== b.yourScore) return a.yourScore - b.yourScore;
    return String(a.id).localeCompare(String(b.id));
  });

  return items.slice(0, limit);
}

/**
 * 一句话总评: 点名最弱的一道题
 */
function buildHeadline(items) {
  if (!items || !items.length) return '';
  const it = items[0];
  return '最该回看的是「' + it.dimName + '」里的 ' + it.id + ' —— 你选了 ' + it.yourLetter + ', 这一档说明 ' + it.dimTagline + ' 还没形成稳定做法。';
}

module.exports = {
  pickReviewItems,
  buildHeadline,
  NEXT_STEP,
  scoreOf
};
