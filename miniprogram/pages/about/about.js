// pages/about/about.js
// 方法论 / 隐私说明 / 数据管理
const STORAGE = require('../../utils/storage.js');
const BANK = require('../../utils/bank.js');
const DIMS = require('../../data/dimensions.js');
const LEVELS = require('../../data/levels.js').levels;
const QT = require('../../data/question-types.js');

Page({
  data: {
    dims: [],
    levels: [],
    types: [],
    packs: [],
    coreCount: 0,
    historyCount: 0
  },

  onShow() {
    const types = Object.keys(QT).map(k => ({
      key: k,
      name: QT[k].name,
      weight: Math.round(QT[k].weight * 100) + '%',
      desc: QT[k].desc
    }));
    this.setData({
      dims: DIMS,
      levels: LEVELS,
      types,
      packs: BANK.listPacks(),
      coreCount: BANK.CORE.length,
      historyCount: STORAGE.loadHistory().length
    });
  },

  clearAll() {
    wx.showModal({
      title: '清空本机数据',
      content: '将删除未完成的作答与全部历史记录, 不可恢复。',
      confirmColor: '#e5484d',
      success: r => {
        if (r.confirm) {
          STORAGE.clearHistory();
          STORAGE.clearCurrentProgress();
          this.setData({ historyCount: 0 });
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  }
});
