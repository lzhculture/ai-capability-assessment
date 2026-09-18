#!/usr/bin/env node
/**
 * v0.8.4: 重导 产物/ 下的题库快照, 使其与 miniprogram/data 真源保持一致。
 *
 * 背景: 产物/02-题库.json 与 产物/04-行业特化题包.json 长期停留在早期版本
 *   (02 与真源有 19/30 题选项不同; 04 还写着 4 包 21 题 geo/gov, 真源实为
 *    bid/mfg/retail 3 包 54 题), 且原校验门禁不覆盖 产物/ 目录 —— 属于文档治理盲区。
 * 本脚本从真源重新生成这两份快照, 并由 verify-web.js §1.13 做一致性门禁。
 *
 * 用法: node tools/build-archive-snapshots.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'miniprogram', 'data');
const ARCH = path.join(ROOT, '产物');

const core = require(path.join(DATA, 'core.js'));
const packs = require(path.join(DATA, 'packs.js'));
const levelsMod = require(path.join(DATA, 'levels.js'));

// 版本号单点真值: tools/build-web-data.js 的 questionSetVersion
const buildSrc = fs.readFileSync(path.join(__dirname, 'build-web-data.js'), 'utf8');
const vm = buildSrc.match(/questionSetVersion:\s*'([^']+)'/);
if (!vm) { console.error('✗ 无法从 build-web-data.js 读取 questionSetVersion'); process.exit(1); }
const VERSION = vm[1];

const SCORING_MAP = levelsMod.scoreMap; // {A:0, B:33.3, C:66.7, D:100}

/* ---------- 02-题库.json ---------- */
const typeCount = {};
core.forEach(q => { typeCount[q.type] = (typeCount[q.type] || 0) + 1; });
const doc02 = {
  $schema_version: '0.1.0',
  framework_ref: 'APCA ' + VERSION + ' (与 miniprogram/data/core.js 真源同步)',
  source: { file: 'miniprogram/data/core.js', version: VERSION, note: '由 tools/build-archive-snapshots.js 自动重导, 请勿手改' },
  totals: Object.assign({ count: core.length }, typeCount),
  scoring_map: SCORING_MAP,
  questions: core
};

/* ---------- 04-行业特化题包.json ---------- */
const byPack = {};
packs.forEach(p => { byPack[p.id] = p.questions.length; });
const doc04 = {
  $schema_version: '0.1.0',
  framework_ref: 'APCA ' + VERSION + ' (与 miniprogram/data/packs.js 真源同步)',
  source: { file: 'miniprogram/data/packs.js', version: VERSION, note: '由 tools/build-archive-snapshots.js 自动重导, 请勿手改' },
  totals: { packs: packs.length, questions: packs.reduce((a, p) => a + p.questions.length, 0), by_pack: byPack },
  scoring_map: SCORING_MAP,
  packs: packs.map(p => ({
    id: p.id,
    kind: p.kind,
    name: p.name,
    desc: p.desc,
    weights: p.weights,
    questions: p.questions
  }))
};

if (!fs.existsSync(ARCH)) fs.mkdirSync(ARCH, { recursive: true });
fs.writeFileSync(path.join(ARCH, '02-题库.json'), JSON.stringify(doc02, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(ARCH, '04-行业特化题包.json'), JSON.stringify(doc04, null, 2) + '\n', 'utf8');

console.log('✓ 产物快照已重导 (版本 ' + VERSION + ')');
console.log('  02-题库.json       : ' + core.length + ' 题 ' + JSON.stringify(typeCount));
console.log('  04-行业特化题包.json: ' + doc04.totals.packs + ' 包 / ' + doc04.totals.questions + ' 题 ' + JSON.stringify(byPack));
