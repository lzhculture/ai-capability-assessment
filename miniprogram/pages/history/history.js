// pages/history/history.js
// 成长记录: 列表 + 总分趋势 + 维度对比最近两次
const STORAGE = require('../../utils/storage.js');
const DATE = require('../../utils/date.js');
const DIMS = require('../../data/dimensions.js');

Page({
  data: {
    list: [],
    trend: [],
    compare: null,
    hasMore: false
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const raw = STORAGE.loadHistory();
    const list = raw.map((h, i) => {
      const prev = raw[i + 1]; // 更早的一次
      const delta = prev ? +(h.total - prev.total).toFixed(1) : null;
      return {
        ...h,
        levelId: h.level ? h.level.id : '-',
        levelName: h.level ? h.level.name : '-',
        packName: h.packName || '通用版',
        qcount: (h.answered || 0) + '/' + (h.totalQ || 30),
        dateStr: DATE.ymdhm(h.ts),
        agoStr: DATE.ago(h.ts),
        delta,
        deltaText: delta == null ? '首次' : (delta > 0 ? '+' + delta : String(delta)),
        deltaCls: delta == null ? '' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
        up: delta != null && delta > 0,
        down: delta != null && delta < 0
      };
    });

    // 趋势: 反转成时间正序, 高度按分值比例
    const trend = raw
      .slice(0, 12)
      .map(h => ({
        ts: h.ts,
        total: h.total,
        levelId: h.level ? h.level.id : '-',
        dateShort: DATE.ymd(h.ts).slice(5),
        h: Math.max(8, Math.round(h.total)) + '%'
      }))
      .reverse();

    // 最近两次维度对比
    let compare = null;
    if (raw.length >= 2) {
      const cur = raw[0];
      const prev = raw[1];
      compare = {
        curDate: DATE.ymd(cur.ts),
        prevDate: DATE.ymd(prev.ts),
        rows: DIMS.map(d => {
          const a = (cur.dimScores || {})[d.id] || 0;
          const b = (prev.dimScores || {})[d.id] || 0;
          const d2 = +(a - b).toFixed(1);
          return {
            id: d.id,
            name: d.name,
            cur: a,
            prev: b,
            delta: d2,
            deltaText: d2 > 0 ? '+' + d2 : String(d2),
            cls: d2 > 0 ? 'up' : d2 < 0 ? 'down' : 'flat'
          };
        })
      };
    }

    this.setData({ list, trend, compare, hasMore: list.length > 0 });
  },

  open(e) {
    const ts = e.currentTarget.dataset.ts;
    wx.navigateTo({ url: '/pages/result/result?ts=' + ts });
  },

  clearAll() {
    if (!this.data.list.length) return;
    wx.showModal({
      title: '清空成长记录',
      content: '将删除本机保存的全部 ' + this.data.list.length + ' 条测评记录, 不可恢复。',
      confirmColor: '#e5484d',
      success: r => {
        if (r.confirm) {
          STORAGE.clearHistory();
          this.refresh();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  },

  goQuiz() {
    wx.navigateTo({ url: '/pages/index/index' });
  },

  onShareAppMessage() {
    return { title: '我的 AI 能力成长记录', path: '/pages/index/index' };
  }
});
