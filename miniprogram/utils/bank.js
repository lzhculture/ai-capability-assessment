// utils/bank.js
// 题库加载: 默认本地内置, v0.2 可改为 CDN
//
// 定位说明 (v0.6 起):
//   APCA 本身是「通用个人 AI 能力测评」, 6 维度 + 4 级, 30 道通用题, 是产品的主入口。
//   下方 industry 包是「专项测评模型」——每个都有自己的测试标准(维度权重)与题库,
//   既可「加测」(blended: 通用 30 题 + 专项 N 题, 一并发), 也可「单独成卷」(standalone: 只做专项 N 题)。
//   专项绝不是把整个产品定位成招投标/GEO 之类的专项测试。

const CORE = require('../data/core.js');
const PACKS = require('../data/packs.js');

/**
 * 按 packId 构建题目列表
 * @param {string} packId 'none' | 'bid' | 'mfg' | 'retail'
 * @param {string} mode   'blended'(默认, 通用+专项) | 'standalone'(只做专项)
 * @returns {Array}
 */
function buildQuestions(packId, mode) {
  if (packId && packId !== 'none') {
    const p = PACKS.find(x => x.id === packId);
    if (p) {
      if (mode === 'standalone') return p.questions.slice();
      return CORE.concat(p.questions);   // blended
    }
  }
  return CORE.slice();   // 纯通用版
}

/**
 * 专项包的「自己的测试标准」(维度权重); 通用版返回 null (由 calc 走等权)
 */
function packWeights(packId) {
  const p = PACKS.find(x => x.id === packId);
  return p && p.weights ? p.weights : null;
}

/**
 * 取包原始元信息 (不被 blend 文案污染)
 */
function packMeta(packId) {
  return PACKS.find(x => x.id === packId) || null;
}

/**
 * 题包元数据 (供首页展示)
 * 注意: extra = 特化包追加的题数; count = 本卷总题数
 */
function listPacks() {
  const base = CORE.length;
  return [
    {
      id: 'none',
      kind: 'general',
      name: '通用版',
      desc: '6 维度通用场景, 适合全员普查与横向对比 (产品主入口)',
      extra: 0,
      count: base,
      tag: '共 ' + base + ' 题'
    },
    ...PACKS.map(p => ({
      id: p.id,
      kind: 'specialized',
      name: p.name,
      desc: p.desc,
      extra: p.questions.length,
      count: base + p.questions.length,
      standaloneCount: p.questions.length,
      tag: '加 ' + p.questions.length + ' 题 · 共 ' + (base + p.questions.length) + ' 题',
      standaloneTag: '单独测 · ' + p.questions.length + ' 题'
    }))
  ];
}

function packName(packId) {
  const p = listPacks().find(x => x.id === packId);
  return p ? p.name : '通用版';
}

module.exports = { buildQuestions, packWeights, packMeta, listPacks, packName, CORE, PACKS };
