#!/usr/bin/env node
/* 检测"解析与分值矛盾" (v2 分句版):
 * 源数据选项按成熟度升序 (A=0 ... D=100, D=最高成熟度锚点)。
 * 将 analysis 按独立字母引用切段, 每段归属其开头字母:
 *  - D 段出现贬义词 => 矛盾
 *  - A/B/C 段出现最高级褒义词 => 矛盾
 *  - D 段缺失或整段无最高级评价 => 警示
 */
const path = require('path');
const MP = path.join(__dirname, '..', 'miniprogram', 'data');
const core = require(path.join(MP, 'core.js'));
const packs = require(path.join(MP, 'packs.js'));
const qs = core.concat(...packs.map(p => p.questions));

const NEG = /(不靠谱|不可持续|放任|套路驱动|单点改进|次优|弱|不取|不可取|风险高|堆上下文|堆输入|堆放|应付|朴素|危险)/;
const SUPER = /(最高级|最高|最强|最优|最稳|最好|最有体系|体系化最强|体系化最高|最有用)/;

let bad = 0, warn = 0;
for (const q of qs) {
  const a = (q.analysis || '').replace(/\s+/g, '');
  // 按字母引用切段: 找出所有 "X 是..." / "X 最优..." / "X 体现了..." 的位置
  // 预清洗 (分句前做, 避免截断误伤): "最高级是D"是对 D 的推崇;
  // "风险最高/最危险"等负面对象的"最高"不是推崇
  const a0 = a.replace(/最高级是\s*[ABCD]/g, '')
              .replace(/(风险|返工率|危险|损耗|成本)最高/g, '')
              .replace(/最(危险|朴素)/g, '');
  const marks = [];
  const re = /(?<![A-Za-z0-9])([ABCD])(?![A-Za-z0-9])/g;
  let m;
  while ((m = re.exec(a0)) !== null) marks.push({ L: m[1], i: m.index });
  const segs = [];
  for (let k = 0; k < marks.length; k++) {
    const end = k + 1 < marks.length ? marks[k + 1].i : a0.length;
    // 段取字母后 24 字, 覆盖到分号即可
    segs.push({ L: marks[k].L, text: a0.slice(marks[k].i, Math.min(end, marks[k].i + 24)) });
  }
  if (!segs.length) continue;
  const dSeg = segs.find(s => s.L === 'D');
  for (const s of segs) {
    if (s.L === 'D' && NEG.test(s.text)) {
      bad++; console.log('✗ ' + q.id + ' 贬低D: ' + s.text); break;
    }
    if (s.L !== 'D' && SUPER.test(s.text)) {
      bad++; console.log('✗ ' + q.id + ' 推崇' + s.L + '为最高: ' + s.text); break;
    }
  }
  if (!dSeg) { warn++; console.log('⚠ ' + q.id + ' 解析未单独评价 D'); }
  else if (!SUPER.test(dSeg.text)) { warn++; console.log('⚠ ' + q.id + ' D 段无最高级定性: ' + dSeg.text); }
}
console.log('\n硬矛盾: ' + bad + ' 题 | 软警示: ' + warn + ' 题 | 总题数: ' + qs.length);
process.exit(bad ? 1 : 0);
