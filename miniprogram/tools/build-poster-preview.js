// 生成海报预览页: 把 utils/poster.js 的真实绘制代码跑在浏览器 Canvas 上
// 用法: node tools/build-poster-preview.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const posterSrc = fs.readFileSync(path.join(ROOT, 'utils/poster.js'), 'utf8');
const dimsSrc = fs.readFileSync(path.join(ROOT, 'data/dimensions.js'), 'utf8');
const levelsSrc = fs.readFileSync(path.join(ROOT, 'data/levels.js'), 'utf8');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>APCA 结果海报 · 预览</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px 60px;
    background: #f4f6fb;
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif;
    color: #1f2a44;
  }
  .wrap { max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .sub { color: #64748b; font-size: 14px; margin-bottom: 24px; line-height: 1.7; }
  .bar {
    display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
    background: #fff; border: 1px solid #e6ebf5; border-radius: 14px;
    padding: 14px 16px; margin-bottom: 20px;
  }
  .bar b { font-size: 13px; color: #64748b; margin-right: 2px; }
  .seg { display: flex; gap: 6px; }
  button {
    font: inherit; font-size: 13px; cursor: pointer;
    border: 1px solid #d8e0f0; background: #fff; color: #1f2a44;
    padding: 7px 14px; border-radius: 999px; transition: .15s;
  }
  button:hover { border-color: #1f5cff; color: #1f5cff; }
  button.on { background: #1f5cff; border-color: #1f5cff; color: #fff; }
  button.primary { background: #1f5cff; border-color: #1f5cff; color: #fff; }
  .stage { display: flex; gap: 32px; flex-wrap: wrap; align-items: flex-start; }
  .phone {
    flex: none; background: #fff; border: 1px solid #e6ebf5; border-radius: 18px;
    padding: 16px; box-shadow: 0 10px 30px rgba(20,40,90,.08);
  }
  canvas { display: block; width: 375px; height: 540px; border-radius: 10px; }
  .meta { margin-top: 12px; text-align: center; font-size: 12px; color: #94a3b8; }
  .side { flex: 1; min-width: 300px; }
  .card {
    background: #fff; border: 1px solid #e6ebf5; border-radius: 14px;
    padding: 18px 20px; margin-bottom: 16px;
  }
  .card h3 { margin: 0 0 12px; font-size: 15px; }
  .kv { display: flex; font-size: 13px; padding: 6px 0; border-bottom: 1px dashed #eef1f7; }
  .kv:last-child { border-bottom: 0; }
  .kv span:first-child { width: 92px; color: #94a3b8; flex: none; }
  .kv span:last-child { color: #1f2a44; font-weight: 600; }
  .note { font-size: 13px; line-height: 1.8; color: #64748b; }
  .note code {
    background: #f1f4fa; padding: 1px 6px; border-radius: 5px;
    font-size: 12px; color: #1f5cff;
  }
  /* ---- 结果页「逐题复盘」模块 1:1 预览 ---- */
  .mp-preview { max-width: 420px; }
  .rv-head {
    background: linear-gradient(135deg,#eef3ff,#f7f9ff); border: 1px solid #dbe4fb;
    border-radius: 14px; padding: 16px 18px; margin-bottom: 12px;
  }
  .rv-lead { font-size: 11px; font-weight: 700; color: #1f5cff; letter-spacing: 1px; }
  .rv-hl { margin-top: 6px; font-size: 14px; line-height: 1.7; font-weight: 600; }
  .rv-card { background: #fff; border: 1px solid #e6ebf5; border-radius: 14px; overflow: hidden; margin-bottom: 12px; }
  .rv-top { padding: 14px 16px; }
  .rv-q { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .rv-dim { font-size: 12px; font-weight: 700; color: #1f5cff; }
  .rv-id { font-size: 10px; color: #94a3b8; background: #f0f3fa; padding: 1px 6px; border-radius: 4px; }
  .rv-qt { font-size: 14px; line-height: 1.65; font-weight: 600; }
  .rv-pick { display: flex; gap: 8px; margin-top: 10px; padding: 10px 12px; background: #fafbfe; border-radius: 10px; align-items: flex-start; }
  .rv-badge {
    flex: none; width: 22px; height: 22px; line-height: 22px; text-align: center;
    border-radius: 6px; font-size: 12px; font-weight: 800; color: #fff; background: #94a3b8;
  }
  .rv-badge.pick-A { background: #d84a4a; }
  .rv-badge.pick-B { background: #e0872c; }
  .rv-badge.pick-C { background: #3b82f6; }
  .rv-badge.pick-D { background: #1f9255; }
  .rv-pick-txt { font-size: 12.5px; line-height: 1.6; color: #64748b; }
  .rv-more { margin-top: 10px; font-size: 12px; color: #1f5cff; text-align: right; }
  .rv-body { border-top: 1px solid #eef1f7; padding: 12px 16px 14px; background: #fbfcff; }
  .rv-blk { margin-bottom: 12px; }
  .rv-blk:last-child { margin-bottom: 0; }
  .rv-lb { font-size: 11px; font-weight: 700; color: #1f5cff; margin-bottom: 3px; }
  .rv-tx { font-size: 12.5px; line-height: 1.75; color: #64748b; }
  .rv-tx.best { color: #1f9255; font-weight: 600; }
  .foot { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 28px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>APCA 结果海报 · 本地预览</h1>
  <div class="sub">
    这里跑的就是小程序里 <code>utils/poster.js</code> 的原始代码，渲染在浏览器 Canvas 上，所见即所得。
    切到「有码」会用一张模拟小程序码演示真实版式；工程里没有 <code>qrcode.png</code> 时会自动降级成占位块。
  </div>

  <div class="bar">
    <b>等级</b>
    <div class="seg" id="segLevel"></div>
    <b style="margin-left:12px;">小程序码</b>
    <div class="seg">
      <button data-qr="1" class="on">有码</button>
      <button data-qr="0">无码（降级）</button>
    </div>
    <button class="primary" id="dl" style="margin-left:auto;">下载 PNG（2 倍图）</button>
  </div>

  <div class="stage">
    <div class="phone">
      <canvas id="cv" width="750" height="1080"></canvas>
      <div class="meta">750 × 1080 逻辑像素 · 显示已缩至 50%</div>
    </div>

    <div class="side">
      <div class="card">
        <h3>当前示例数据</h3>
        <div id="kv"></div>
      </div>

      <div class="card">
        <h3>海报里有什么</h3>
        <div class="note">
          等级大字 + 等级名 + 等级释义 → 综合得分 → 六维雷达 → 强项 / 待提升 → 卷别与题数 → 小程序码 + 引导语。<br>
          背景是深蓝渐变，卡片是白色圆角带阴影。尺寸 750×1080，正好是朋友圈与聊天的常见比例。
        </div>
      </div>

      <div class="card">
        <h3>上线前要做的两件事</h3>
        <div class="note">
          1. 把小程序码放成 <code>miniprogram/assets/qrcode.png</code>（公众平台 → 设置 → 基本设置 → 小程序码，下载 500px 以上）。<br>
          2. 小程序管理后台配置《用户隐私保护指引》，勾选「相册 / 添加到相册」，否则部分基础库会拦截保存。
        </div>
      </div>
    </div>
  </div>

  <div class="card mp-preview" style="margin-top:32px;">
    <h3>结果页新增模块：逐题复盘（样式 1:1 预览）</h3>
    <div class="note" style="margin-bottom:14px;">
      引用你实际答了哪几题、选了哪个选项，再给出该题的解析与更优解。这是规则实现，不调用大模型，零成本、零延迟、可离线。
    </div>
    <div class="rv-head">
      <div class="rv-lead">针对性回看</div>
      <div class="rv-hl" id="rvHeadline"></div>
    </div>
    <div id="rvList"></div>
  </div>

  <div class="foot">APCA v0.5 · 海报与逐题复盘预览 · 由 tools/build-poster-preview.js 生成</div>
</div>

<script id="src-dims" type="text/plain">${dimsSrc}</script>
<script id="src-levels" type="text/plain">${levelsSrc}</script>
<script id="src-poster" type="text/plain">${posterSrc}</script>
<script id="src-review" type="text/plain">${fs.readFileSync(path.join(ROOT, 'utils/review.js'), 'utf8')}</script>
<script id="src-core" type="text/plain">${fs.readFileSync(path.join(ROOT, 'data/core.js'), 'utf8')}</script>

<script>
// ---- 把小程序 CommonJS 模块搬进浏览器 ----
function loadModule(src, req) {
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', src)(mod, mod.exports, req);
  return mod.exports;
}
const SRC = id => document.getElementById(id).textContent;
const DIMS = loadModule(SRC('src-dims'), () => []);
const LEVELS = loadModule(SRC('src-levels'), () => ({}));
const CORE = loadModule(SRC('src-core'), () => ({}));
const REVIEW = loadModule(SRC('src-review'), p => (p.indexOf('dimensions') >= 0 ? DIMS : {}));
const POSTER = loadModule(SRC('src-poster'), p => (p.indexOf('dimensions') >= 0 ? DIMS : {}));

// ---- 示例数据 ----
const SAMPLES = {
  L1: { total: 18, dim: { D1: 22, D2: 15, D3: 26, D4: 12, D5: 18, D6: 8 } },
  L2: { total: 42, dim: { D1: 52, D2: 38, D3: 45, D4: 33, D5: 41, D6: 30 } },
  L3: { total: 68, dim: { D1: 83, D2: 67, D3: 72, D4: 58, D5: 61, D6: 50 } },
  L4: { total: 91, dim: { D1: 100, D2: 89, D3: 92, D4: 83, D5: 95, D6: 86 } }
};
// 注意: 等级 (L1-L4) 与行业场景无关, 等级只反映能力段位。
// 海报里的「卷别」应来自实际所选卷 (通用版 / 某专项), 这里示例统一用通用版, 避免把等级绑死到某个行业。
const PACKS = {
  L1: '通用版', L2: '通用版', L3: '通用版', L4: '通用版'
};
const QCOUNT = { L1: 30, L2: 30, L3: 30, L4: 30 };

let curLevel = 'L3';
let hasQr = true;
let qrImage = null;

// 生成一张模拟小程序码（视觉占位，不是真二维码）
function makeFakeQr(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
  const n = 25, cell = size / n;
  let seed = 20260902;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  g.fillStyle = '#111';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const inFinder = (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
      if (inFinder) continue;
      if (rnd() > 0.52) g.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  // 三个定位角
  g.fillStyle = '#111';
  [[0, 0], [n - 7, 0], [0, n - 7]].forEach(([fx, fy]) => {
    g.fillRect(fx * cell, fy * cell, 7 * cell, 7 * cell);
    g.fillStyle = '#fff'; g.fillRect((fx + 1) * cell, (fy + 1) * cell, 5 * cell, 5 * cell);
    g.fillStyle = '#111'; g.fillRect((fx + 2) * cell, (fy + 2) * cell, 3 * cell, 3 * cell);
  });
  return c;
}

function shortOf(dim) {
  const d = DIMS.find(x => x.id === dim);
  return d ? d.id + ' ' + d.name.replace(/能力$/, '') : dim;
}

function buildData(levelId) {
  const s = SAMPLES[levelId];
  const lv = LEVELS.levels.find(l => l.id === levelId);
  const sorted = DIMS.map(d => ({ id: d.id, name: d.name, score: s.dim[d.id] || 0 }))
    .sort((a, b) => b.score - a.score);
  return {
    levelId,
    levelName: lv.name,
    levelSubtitle: lv.subtitle,
    total: s.total,
    dimScores: s.dim,
    strongName: shortOf(sorted[0].id),
    weakName: shortOf(sorted[sorted.length - 1].id),
    packName: PACKS[levelId],
    totalQ: QCOUNT[levelId],
    dateStr: '2026-09-02 14:30'
  };
}

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  POSTER.drawPoster(ctx, buildData(curLevel), { qrImage: hasQr ? qrImage : null });
}

function renderKv(d) {
  document.getElementById('kv').innerHTML = [
    ['等级', d.levelId + ' ' + d.levelName],
    ['综合得分', d.total],
    ['强项', d.strongName],
    ['待提升', d.weakName],
    ['卷别', d.packName + ' · ' + d.totalQ + ' 题'],
    ['日期', d.dateStr]
  ].map(r => '<div class="kv"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>').join('');
}

// ---- 逐题复盘预览 ----
function renderReview() {
  // 用真实题库 + 一份"前 8 题选 A、其余选 D"的作答
  const trail = CORE.map((q, i) => ({ id: q.id, letter: i < 8 ? 'A' : 'D' }));
  const items = REVIEW.pickReviewItems(CORE, trail, 3);
  document.getElementById('rvHeadline').textContent = REVIEW.buildHeadline(items);
  document.getElementById('rvList').innerHTML = items.map((it, i) => {
    const open = i === 0 ? '' : ' style="display:none"';
    const arrow = i === 0 ? '收起解析 ▲' : '查看解析 ▼';
    return '<div class="rv-card">' +
      '<div class="rv-top">' +
        '<div class="rv-q"><span class="rv-dim">' + it.dimName + '</span><span class="rv-id">' + it.id + '</span></div>' +
        '<div class="rv-qt">' + it.question + '</div>' +
        '<div class="rv-pick"><span class="rv-badge pick-' + it.yourLetter + '">' + it.yourLetter + '</span>' +
          '<span class="rv-pick-txt">你的选择: ' + it.yourText + '</span></div>' +
        '<div class="rv-more">' + arrow + '</div>' +
      '</div>' +
      '<div class="rv-body"' + open + '>' +
        '<div class="rv-blk"><div class="rv-lb">这道题在测什么</div><div class="rv-tx">' + it.dimTagline + '</div></div>' +
        '<div class="rv-blk"><div class="rv-lb">选项差异</div><div class="rv-tx">' + it.analysis + '</div></div>' +
        '<div class="rv-blk"><div class="rv-lb">更优解 (D)</div><div class="rv-tx best">' + it.bestText + '</div></div>' +
        '<div class="rv-blk"><div class="rv-lb">下一步</div><div class="rv-tx">' + it.nextStep + '</div></div>' +
      '</div>' +
    '</div>';
  }).join('');
  // 小交互: 点卡片展开/收起
  document.querySelectorAll('#rvList .rv-card').forEach(card => {
    const top = card.querySelector('.rv-top');
    const body = card.querySelector('.rv-body');
    const more = card.querySelector('.rv-more');
    top.addEventListener('click', () => {
      const shown = body.style.display !== 'none';
      body.style.display = shown ? 'none' : '';
      more.textContent = shown ? '查看解析 ▼' : '收起解析 ▲';
    });
  });
}

// ---- 交互 ----
const segLevel = document.getElementById('segLevel');
Object.keys(SAMPLES).forEach(id => {
  const b = document.createElement('button');
  b.textContent = id;
  b.dataset.level = id;
  if (id === curLevel) b.className = 'on';
  b.onclick = () => {
    curLevel = id;
    segLevel.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.level === id));
    render();
  };
  segLevel.appendChild(b);
});
document.querySelectorAll('[data-qr]').forEach(b => {
  b.onclick = () => {
    hasQr = b.dataset.qr === '1';
    document.querySelectorAll('[data-qr]').forEach(x => x.classList.toggle('on', x === b));
    render();
  };
});
document.getElementById('dl').onclick = () => {
  const a = document.createElement('a');
  a.download = 'APCA海报_' + curLevel + (hasQr ? '_有码' : '_无码') + '.png';
  a.href = cv.toDataURL('image/png');
  a.click();
};

function render() {
  const d = buildData(curLevel);
  draw();
  renderKv(d);
}

qrImage = makeFakeQr(400);
render();
renderReview();
</script>
</body>
</html>
`;

const out = path.join(ROOT, 'tools/poster-preview.html');
fs.writeFileSync(out, html, 'utf8');
console.log('已生成:', out, (html.length / 1024).toFixed(1) + ' KB');
