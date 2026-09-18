// tools/build-web-data.js
// 从 miniprogram 源数据导出 web/data.js (window.APCA_DATA),
// 保证网站版与小程序版题库/计分完全一致 (避免手抄 84 题出错)。
//
// 用法: node tools/build-web-data.js
// 输出: web/data.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');                 // ai-capability-assessment/
const DATA = path.join(ROOT, 'miniprogram', 'data');
const OUT = path.join(ROOT, 'web', 'data.js');

const dimensions = require(path.join(DATA, 'dimensions.js'));
const levelsMod = require(path.join(DATA, 'levels.js'));
const questionTypes = require(path.join(DATA, 'question-types.js'));
const core = require(path.join(DATA, 'core.js'));
const packs = require(path.join(DATA, 'packs.js'));
const reports = require(path.join(DATA, 'reports.js'));
const { shuffleQuestion } = require(path.join(__dirname, 'lib', 'shuffle.js'));

const LEVELS = levelsMod.levels;
const SCORE_MAP = levelsMod.scoreMap;

// v0.8: 每题选项乱序导出 (防"总选 D 得高分"), 详见 tools/lib/shuffle.js 注释。
// v0.8.1: 修正 12 道通用题计分锚点错位 (解析公认最优行为置换到 D=100 位), 见 tools/patch-anchor-fix-20260904.py。
// 源数据保持成熟度升序不变, 仅 web 导出做乱序 + 每题 scores 分值映射 + 解析字母重映射。
const shuffleQs = (qs) => qs.map(q => shuffleQuestion(q, SCORE_MAP));
const coreShuffled = shuffleQs(core);
const packsShuffled = packs.map(p => Object.assign({}, p, { questions: shuffleQs(p.questions) }));

// 基础校验: 专项 weights 和为 1
packs.forEach(p => {
  const sum = Object.values(p.weights || {}).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(`专项 ${p.id} 的 weights 和为 ${sum}, 应为 1`);
  }
});

const APCA_DATA = {
  meta: {
    name: '个人AI办公能力测评',
    framework: 'APCA v0.8.11',
    questionSetVersion: 'v0.8.11',
    author: 'jmount',
    license: 'personal-free-use',
    // v0.8.7 P0-3.3: licenseNote 与 authorizedDomain 移出硬编码,
    // 由 tools/build-license.py 根据部署目标 (--server=site-a|site-b) 注入。
    licenseNote: '见同目录 LICENSE 与本系统「关于」页（占位，由 tools/build-license.py 注入）',
    authorizedDomain: '',
    generatedAt: new Date().toISOString(),
    description: '通用个人 AI 办公能力测评 (6 维度 + 4 级), 含招投标/制造业/连锁零售 3 个专项模型。支持后台服务端汇总。'
  },
  dimensions,                 // 6 维度定义 + 权重
  levels: LEVELS,             // L1-L4 + score_range
  scoreMap: SCORE_MAP,        // 四档分值 0/33.3/66.7/100 (每题各字母的实际分值见 q.scores)
  questionTypes,              // 4 题型
  core: coreShuffled,         // 30 道通用题 (选项已乱序)
  packs: packsShuffled.map(p => ({    // 专项模型 (自带权重 + 题库, 选项已乱序)
    id: p.id,
    kind: p.kind,
    name: p.name,
    desc: p.desc,
    weights: p.weights,
    questions: p.questions
  })),
  reports: reports.RAW        // {learningTips, coreAdvice, levelTips}
};

// JSON.stringify 默认转义非 ASCII 为 \uXXXX, 浏览器可正常解析, 真值无损
const banner =
`// 自动生成, 请勿手改。来源: miniprogram 源数据 ${APCA_DATA.meta.questionSetVersion} (tools/build-web-data.js)
// 生成时间: ${APCA_DATA.meta.generatedAt}
// 题库: 通用 ${core.length} 题 + 专项 ${packs.map(p => p.id + ':' + p.questions.length).join(' / ')}
// v0.8: 每题选项乱序呈现, 各字母实际分值见每题 scores 字段; 解析字母已同步重映射
window.APCA_DATA = `;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, banner + JSON.stringify(APCA_DATA, null, 2) + ';\n', 'utf8');

// 自检输出
const totalQ = core.length + packs.reduce((a, p) => a + p.questions.length, 0);
// 乱序分布自检: 100 分选项落在各字母的题数 (期望大致均匀)
const allShuffled = coreShuffled.concat(...packsShuffled.map(p => p.questions));
const dist = { A: 0, B: 0, C: 0, D: 0 };
allShuffled.forEach(q => {
  ['A', 'B', 'C', 'D'].forEach(L => { if (q.scores[L] === 100) dist[L]++; });
});
const identity = allShuffled.filter(q => q.scores.A === 0 && q.scores.D === 100).length;
console.log('✓ web/data.js 已生成:', OUT);
console.log('  维度:', dimensions.length, '| 通用题:', core.length, '| 专项包:', packs.length, '| 总题量:', totalQ);
console.log('  等级:', LEVELS.map(l => l.id + '(' + l.score_range[0] + '-' + l.score_range[1] + ')').join(' '));
console.log('  乱序分布 (100分选项所在字母 → 题数):', JSON.stringify(dist), '| 恒等排列题数:', identity);
console.log('  文件大小:', (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB');
