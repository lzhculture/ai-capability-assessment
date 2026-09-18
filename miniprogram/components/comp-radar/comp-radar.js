// components/comp-radar/comp-radar.js
const DIMENSIONS = require('../../data/dimensions.js');

Component({
  properties: {
    scores: { type: Object, value: {} }, // {D1:83,D2:89,...}
    size: { type: Number, value: 320 }   // rpx
  },
  data: {
    canvasId: 'radar',
    dimLabels: DIMENSIONS.map(d => d.name),
    dimIds: DIMENSIONS.map(d => d.id)
  },
  lifetimes: {
    ready() {
      this.draw();
    }
  },
  observers: {
    'scores': function () {
      this.draw();
    }
  },
  methods: {
    draw() {
      const ctx = wx.createCanvasContext(this.data.canvasId, this);
      const W = this.data.size;
      const cx = W / 2, cy = W / 2;
      const R = W * 0.36;
      const labels = this.data.dimLabels;
      const ids = this.data.dimIds;
      const scores = this.data.scores;
      const N = labels.length;

      // 网格 (4 圈)
      ctx.setLineWidth(1);
      ctx.setStrokeStyle('#e6ebf5');
      for (let r = 1; r <= 4; r++) {
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const a = Math.PI * 2 * i / N - Math.PI / 2;
          const x = cx + Math.cos(a) * R * r / 4;
          const y = cy + Math.sin(a) * R * r / 4;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // 轴线
      ctx.setStrokeStyle('#e6ebf5');
      for (let i = 0; i < N; i++) {
        const a = Math.PI * 2 * i / N - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.stroke();
      }

      // 数据
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const a = Math.PI * 2 * i / N - Math.PI / 2;
        const s = (scores[ids[i]] || 0) / 100;
        const x = cx + Math.cos(a) * R * s;
        const y = cy + Math.sin(a) * R * s;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.setFillStyle('rgba(31, 92, 255, 0.18)');
      ctx.fill();
      ctx.setStrokeStyle('#1f5cff');
      ctx.setLineWidth(3);
      ctx.stroke();

      // 节点
      for (let i = 0; i < N; i++) {
        const a = Math.PI * 2 * i / N - Math.PI / 2;
        const s = (scores[ids[i]] || 0) / 100;
        const x = cx + Math.cos(a) * R * s;
        const y = cy + Math.sin(a) * R * s;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.setFillStyle('#1f5cff');
        ctx.fill();
      }

      // 标签
      ctx.setFillStyle('#1f2a44');
      ctx.setFontSize(22);
      ctx.setTextAlign('center');
      for (let i = 0; i < N; i++) {
        const a = Math.PI * 2 * i / N - Math.PI / 2;
        const x = cx + Math.cos(a) * (R + 28);
        const y = cy + Math.sin(a) * (R + 28);
        ctx.fillText(labels[i], x, y);
      }

      ctx.draw();
    }
  }
});