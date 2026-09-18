// utils/poster.js
// 海报绘制: 纯绘制函数, 不依赖 wx API (便于在 Node 里用桩 ctx 跑测试)
// 画布基准尺寸 W=750 H=1080 (逻辑像素), 调用方按 dpr 做 scale

const DIMS = require('../data/dimensions.js');

const W = 750;
const H = 1080;

const C = {
  bgTop: '#1f3a8a',
  bgBottom: '#2f6bff',
  card: '#ffffff',
  ink: '#1f2a44',
  ink2: '#64748b',
  ink3: '#94a3b8',
  brand: '#1f5cff',
  brandSoft: 'rgba(31, 92, 255, 0.18)',
  line: '#e6ebf5',
  warn: '#f59e0b',
  white: '#ffffff',
  white70: 'rgba(255,255,255,0.72)',
  white40: 'rgba(255,255,255,0.40)'
};

// ---- 基础绘制工具 ----

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ctx.measureText 在部分桩实现里可能缺失, 做兜底
function measure(ctx, text) {
  if (!ctx.measureText) return { width: String(text).length * 14 };
  try {
    const m = ctx.measureText(text);
    return m && typeof m.width === 'number' ? m : { width: String(text).length * 14 };
  } catch (e) {
    return { width: String(text).length * 14 };
  }
}

// 按最大宽度折行, 返回行数组
function wrapText(ctx, text, maxWidth, maxLines) {
  const src = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!src) return [];
  const lines = [];
  let cur = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = cur + ch;
    if (measure(ctx, next).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
      if (maxLines && lines.length === maxLines - 1) {
        // 最后一行: 把剩余内容塞进去并按需省略
        let tail = src.slice(i);
        if (measure(ctx, tail).width > maxWidth) {
          while (tail.length > 1 && measure(ctx, tail + '…').width > maxWidth) {
            tail = tail.slice(0, -1);
          }
          tail = tail + '…';
        }
        lines.push(tail);
        return lines;
      }
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function font(ctx, size, weight) {
  ctx.font = (weight ? weight + ' ' : '') + size + 'px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif';
}

// ---- 局部图形 ----

function drawRadar(ctx, cx, cy, R, scores, labels, ids) {
  const N = ids.length;

  // 网格 4 圈
  ctx.lineWidth = 1;
  ctx.strokeStyle = C.line;
  for (let r = 1; r <= 4; r++) {
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const a = (Math.PI * 2 * i) / N - Math.PI / 2;
      const x = cx + Math.cos(a) * (R * r) / 4;
      const y = cy + Math.sin(a) * (R * r) / 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // 轴线
  for (let i = 0; i < N; i++) {
    const a = (Math.PI * 2 * i) / N - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.stroke();
  }

  // 数据面
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const a = (Math.PI * 2 * i) / N - Math.PI / 2;
    const s = (scores[ids[i]] || 0) / 100;
    const x = cx + Math.cos(a) * R * s;
    const y = cy + Math.sin(a) * R * s;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = C.brandSoft;
  ctx.fill();
  ctx.strokeStyle = C.brand;
  ctx.lineWidth = 3;
  ctx.stroke();

  // 节点
  for (let i = 0; i < N; i++) {
    const a = (Math.PI * 2 * i) / N - Math.PI / 2;
    const s = (scores[ids[i]] || 0) / 100;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R * s, cy + Math.sin(a) * R * s, 5, 0, Math.PI * 2);
    ctx.fillStyle = C.brand;
    ctx.fill();
  }

  // 标签 (短名: 去掉"能力"二字)
  font(ctx, 20);
  ctx.fillStyle = C.ink2;
  ctx.textAlign = 'center';
  for (let i = 0; i < N; i++) {
    const a = (Math.PI * 2 * i) / N - Math.PI / 2;
    const lx = cx + Math.cos(a) * (R + 26);
    const ly = cy + Math.sin(a) * (R + 26);
    const name = String(labels[i] || '').replace(/能力$/, '');
    ctx.textAlign = Math.abs(Math.cos(a)) < 0.25 ? 'center' : (Math.cos(a) > 0 ? 'left' : 'right');
    ctx.fillText(name, lx, ly + 7);
  }
}

// 小程序码区域: 有图则画, 无图则画占位块
function drawQrArea(ctx, x, y, size, qrImage) {
  if (qrImage) {
    try {
      ctx.drawImage(qrImage, x, y, size, size);
      return true;
    } catch (e) {
      /* 落到占位 */
    }
  }
  ctx.save();
  roundRect(ctx, x, y, size, size, 12);
  ctx.fillStyle = C.white;
  ctx.fill();
  ctx.strokeStyle = C.white40;
  ctx.lineWidth = 2;
  ctx.stroke();
  // 占位: 三定位角 + 中心提示
  const pad = size * 0.1;
  const cs = size * 0.18;
  const corners = [
    [x + pad, y + pad],
    [x + size - pad - cs, y + pad],
    [x + pad, y + size - pad - cs]
  ];
  corners.forEach((c) => {
    ctx.strokeStyle = 'rgba(31, 92, 255, 0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(c[0], c[1], cs, cs);
  });
  font(ctx, 20, 'bold');
  ctx.fillStyle = 'rgba(31, 92, 255, 0.55)';
  ctx.textAlign = 'center';
  ctx.fillText('小程序码', x + size / 2, y + size / 2 + 7);
  ctx.restore();
  return false;
}

// ---- 主绘制 ----

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} data  {
 *   levelId, levelName, levelSubtitle, total,
 *   dimScores: {D1:..}, strongName, weakName,
 *   packName, totalQ, dateStr
 * }
 * @param {Object} opts { qrImage }  qrImage 为已加载的小程序码 Image 对象, 可缺省
 */
function drawPoster(ctx, data, opts) {
  opts = opts || {};
  const d = data || {};
  const scores = d.dimScores || {};
  const labels = DIMS.map((x) => x.name);
  const ids = DIMS.map((x) => x.id);

  // 背景渐变
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, C.bgTop);
  g.addColorStop(1, C.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 顶部装饰光斑
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.arc(W - 60, 40, 200, 0, Math.PI * 2);
  ctx.fillStyle = C.white;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(30, H - 120, 150, 0, Math.PI * 2);
  ctx.fillStyle = C.white;
  ctx.fill();
  ctx.restore();

  // 标题
  ctx.textAlign = 'left';
  font(ctx, 26);
  ctx.fillStyle = C.white70;
  ctx.fillText('APCA · 个人 AI 能力测评', 56, 86);

  // 等级大卡
  font(ctx, 96, 'bold');
  ctx.fillStyle = C.white;
  ctx.fillText(String(d.levelId || '-'), 56, 200);

  font(ctx, 44, 'bold');
  ctx.fillText(String(d.levelName || ''), 56 + measure(ctx, String(d.levelId || '')).width * 2.0, 194);

  font(ctx, 24);
  ctx.fillStyle = C.white70;
  const subLines = wrapText(ctx, d.levelSubtitle, W - 112, 2);
  subLines.forEach((line, i) => ctx.fillText(line, 56, 244 + i * 34));

  // 主卡片
  const cardX = 40;
  const cardY = 320;
  const cardW = W - 80;
  const cardH = 600;
  ctx.save();
  ctx.shadowColor = 'rgba(15, 30, 80, 0.28)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  roundRect(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.restore();

  // 总分
  ctx.textAlign = 'center';
  font(ctx, 112, 'bold');
  ctx.fillStyle = C.brand;
  ctx.fillText(String(d.total == null ? '-' : d.total), W / 2, cardY + 132);

  font(ctx, 24);
  ctx.fillStyle = C.ink3;
  ctx.fillText('综合得分 / 100', W / 2, cardY + 170);

  // 分隔线
  ctx.beginPath();
  ctx.moveTo(cardX + 40, cardY + 200);
  ctx.lineTo(cardX + cardW - 40, cardY + 200);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 雷达
  drawRadar(ctx, W / 2, cardY + 388, 138, scores, labels, ids);

  // 强项 / 待提升
  ctx.textAlign = 'left';
  const rowY = cardY + 468;
  font(ctx, 22);
  ctx.fillStyle = C.ink3;
  ctx.fillText('强项', cardX + 48, rowY);
  font(ctx, 26, 'bold');
  ctx.fillStyle = C.ink;
  ctx.fillText(String(d.strongName || '-'), cardX + 110, rowY);

  ctx.textAlign = 'right';
  font(ctx, 22);
  ctx.fillStyle = C.ink3;
  ctx.fillText('待提升', cardX + cardW - 48, rowY);
  font(ctx, 26, 'bold');
  ctx.fillStyle = C.warn;
  ctx.fillText(String(d.weakName || '-'), cardX + cardW - 110, rowY);

  // 卡片底部: 卷别 + 日期
  ctx.textAlign = 'center';
  font(ctx, 22);
  ctx.fillStyle = C.ink3;
  ctx.fillText(
    String(d.packName || '通用版') + ' · ' + String(d.totalQ || 0) + ' 题 · ' + String(d.dateStr || ''),
    W / 2,
    cardY + cardH - 40
  );

  // 底部: 小程序码 + 引导语
  const qrSize = 128;
  const qrX = 56;
  const qrY = H - 190;
  drawQrArea(ctx, qrX, qrY, qrSize, opts.qrImage);

  ctx.textAlign = 'left';
  font(ctx, 30, 'bold');
  ctx.fillStyle = C.white;
  ctx.fillText('扫码测一测你的 AI 段位', qrX + qrSize + 32, qrY + 56);
  font(ctx, 22);
  ctx.fillStyle = C.white70;
  ctx.fillText('6 维度 · 4 等级 · 约 8 分钟', qrX + qrSize + 32, qrY + 94);
}

module.exports = {
  W,
  H,
  drawPoster,
  drawRadar,
  roundRect,
  wrapText,
  measure
};
