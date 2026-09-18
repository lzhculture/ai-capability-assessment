// tools/check-option-balance.js
// 扫描全题库 (core + packs) 的四个选项文字长度, 找出"长答案诱导"失衡题:
//   - ratio = maxLen / medianLen (最长选项是中位选项长度的几倍)
//   - longestIsD: 最长选项是否为 D (D=满分, 最长+满分双重诱导)
// 用法: node tools/check-option-balance.js [--ratio 2.0]
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const core = require(path.join(ROOT, 'miniprogram/data/core.js'));
const packs = require(path.join(ROOT, 'miniprogram/data/packs.js'));

const THRESH = parseFloat((process.argv.includes('--ratio') ? process.argv[process.argv.indexOf('--ratio') + 1] : '1.8') || '1.8');

const questions = [];
core.forEach(q => questions.push({ src: 'core', q }));
packs.forEach(p => (p.questions || []).forEach(q => questions.push({ src: p.id, q })));

const rows = [];
let totalQ = 0, flagged = 0, flaggedD = 0;
for (const { src, q } of questions) {
  totalQ++;
  const lens = ['A', 'B', 'C', 'D'].map(k => (q.options[k] || '').replace(/\s/g, '').length);
  const sorted = [...lens].sort((a, b) => a - b);
  const median = (sorted[1] + sorted[2]) / 2;
  const maxLen = sorted[3];
  const maxIdx = lens.indexOf(maxLen);
  const ratio = median > 0 ? maxLen / median : 0;
  // 均衡分: 最长选项超出其他三项均值的比例
  const others = lens.filter((_, i) => i !== maxIdx);
  const othersAvg = others.reduce((a, b) => a + b, 0) / 3;
  const excessPct = othersAvg > 0 ? Math.round((maxLen / othersAvg - 1) * 100) : 0;
  const flag = ratio >= THRESH;
  if (flag) { flagged++; if (maxIdx === 3) flaggedD++; }
  rows.push({ src, id: q.id, lens, ratio: +ratio.toFixed(2), maxIdx, excessPct, flag });
}

rows.filter(r => r.flag).forEach(r => {
  console.log(
    `[${r.src}] ${r.id}  A:${r.lens[0]} B:${r.lens[1]} C:${r.lens[2]} D:${r.lens[3]}` +
    `  最长=${'ABCD'[r.maxIdx]}  比中位${r.ratio}x  超均值${r.excessPct}%`
  );
});
const bySrc = {};
rows.forEach(r => { bySrc[r.src] = bySrc[r.src] || { total: 0, flag: 0 }; bySrc[r.src].total++; if (r.flag) bySrc[r.src].flag++; });
console.log('\n===== 汇总 =====');
Object.entries(bySrc).forEach(([k, v]) => console.log(`${k}: ${v.flag}/${v.total} 失衡 (阈值 ratio>=${THRESH})`));
console.log(`总计: ${flagged}/${totalQ} 失衡, 其中最长项为 D 的: ${flaggedD}`);
