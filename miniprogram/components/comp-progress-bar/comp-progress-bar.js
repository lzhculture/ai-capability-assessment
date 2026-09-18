// components/comp-progress-bar/comp-progress-bar.js
// 注意: 小程序原生不支持 computed, 用 observers 派生 percent
Component({
  properties: {
    idx: { type: Number, value: 0 },
    total: { type: Number, value: 30 }
  },
  data: {
    percent: 0
  },
  observers: {
    'idx, total': function (idx, total) {
      const t = total || 1;
      this.setData({
        percent: Math.min(100, Math.round(((idx + 1) / t) * 100))
      });
    }
  }
});
