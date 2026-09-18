// pages/result/result.js
// 结果页: 等级卡 + 雷达图 + 维度条 + 逐题复盘 + 学习地图 + 建议 + 海报分享
const STORAGE = require('../../utils/storage.js');
const CALC = require('../../utils/calc.js');
const SHARE = require('../../utils/share.js');
const DATE = require('../../utils/date.js');
const BANK = require('../../utils/bank.js');
const REVIEW = require('../../utils/review.js');
const DIMS = require('../../data/dimensions.js');

Page({
  data: {
    rec: null,
    dimList: [],
    radarScores: {},
    map: [],
    advice: [],
    tip: '',
    summary: '',
    strongText: '',
    weakText: '',
    // 逐题复盘
    reviewItems: [],
    reviewHeadline: '',
    hasReview: false,
    // 海报
    posterRec: null
  },

  onLoad(options) {
    const ts = options.ts ? +options.ts : 0;
    const rec = ts ? STORAGE.getHistoryItem(ts) : null;
    if (!rec) {
      this.setData({ rec: null });
      return;
    }
    this.render(rec);
  },

  render(rec) {
    const ds = rec.dimScores || {};
    const dimList = DIMS.map(d => {
      const s = ds[d.id] || 0;
      const lvl = CALC.levelOf(s);
      return {
        id: d.id,
        name: d.name,
        short: d.id + ' ' + String(d.name).replace(/能力$/, ''),
        tagline: d.tagline,
        score: s,
        lvlId: lvl.id,
        width: Math.max(2, Math.round(s)) + '%'
      };
    }).sort((a, b) => b.score - a.score);

    const strong = dimList[0];
    const weak = dimList[dimList.length - 1];
    const view = {
      ...rec,
      dateStr: DATE.ymdhm(rec.ts),
      packName: rec.packName || '通用版'
    };

    // ---- 逐题复盘: 用本次实际作答还原卷面, 挑最值得讲的题 ----
    let reviewItems = [];
    let reviewHeadline = '';
    if (Array.isArray(rec.answers) && rec.answers.length) {
      const qs = BANK.buildQuestions(rec.packId);
      reviewItems = REVIEW.pickReviewItems(qs, rec.answers, 4).map(it => ({
        ...it,
        open: false
      }));
      reviewHeadline = REVIEW.buildHeadline(reviewItems);
    }

    // ---- 海报数据 ----
    const posterRec = {
      levelId: rec.level ? rec.level.id : '',
      levelName: rec.level ? rec.level.name : '',
      levelSubtitle: rec.level ? rec.level.subtitle : '',
      total: rec.total,
      dimScores: ds,
      strongName: strong ? strong.short : '-',
      weakName: weak ? weak.short : '-',
      packName: view.packName,
      totalQ: rec.totalQ || 0,
      dateStr: view.dateStr
    };

    this.setData({
      rec: view,
      dimList,
      radarScores: ds,
      map: CALC.buildLearningMap(ds),
      advice: CALC.buildAdvice(rec.level),
      tip: CALC.buildTip(rec.level),
      strongText: strong ? strong.name : '-',
      weakText: weak ? weak.name : '-',
      reviewItems,
      reviewHeadline,
      hasReview: reviewItems.length > 0,
      posterRec,
      summary: SHARE.buildSummary({
        level: rec.level,
        total: rec.total,
        dimScores: ds
      })
    });

    wx.setNavigationBarTitle({
      title: rec.level ? rec.level.id + ' · ' + rec.level.name : '测评结果'
    });
  },

  retest() {
    wx.redirectTo({ url: '/pages/index/index' });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  copySummary() {
    wx.setClipboardData({
      data: this.data.summary,
      success: () => wx.showToast({ title: '结果摘要已复制', icon: 'none' })
    });
  },

  // ---- 逐题复盘 ----
  toggleReview(e) {
    const i = +e.currentTarget.dataset.i;
    const cur = !!(this.data.reviewItems[i] && this.data.reviewItems[i].open);
    this.setData({ ['reviewItems[' + i + '].open']: !cur });
  },

  // ---- 海报分享 ----
  makePoster() {
    const poster = this.selectComponent('#poster');
    if (!poster) {
      wx.showToast({ title: '海报组件未就绪', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '生成海报中', mask: true });
    poster.make();
    setTimeout(() => wx.hideLoading(), 4000); // 兜底, 避免 loading 卡住
  },

  onPosterSaved() {
    wx.hideLoading();
  },

  onPosterError() {
    wx.hideLoading();
  },

  onShareAppMessage() {
    return {
      title: this.data.summary.split('\n')[0] || '我的 AI 能力测评结果',
      path: '/pages/index/index'
    };
  },

  onShareTimeline() {
    const rec = this.data.rec;
    return {
      title: rec
        ? '我的 AI 能力段位: ' + (rec.level ? rec.level.id + ' ' + rec.level.name : '') + ' · ' + rec.total + ' 分'
        : 'AI 能力诊断评估',
      query: ''
    };
  }
});
