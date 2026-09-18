// pages/index/index.js
const BANK = require('../../utils/bank.js');
const STORAGE = require('../../utils/storage.js');
const DATE = require('../../utils/date.js');

Page({
  data: {
    packs: [],
    selected: 'none',
    total: 30,
    packTag: '',
    minutes: '11-14 分钟',
    pending: null,
    history: [],
    showTip: false,
    showPrivacy: false,
    privacyContent: '欢迎使用「个人AI能力评测」。本工具为本地运行的 AI 能力自评小程序：\n' +
      '· 存储: 你的测评结果与历史记录仅保存在手机本机微信缓存 (wx.setStorageSync), 不上传任何服务器;\n' +
      '· 相册: 生成结果海报时, 可选保存到本机相册, 不会读取相册其他内容;\n' +
      '· 我们不收集姓名、手机号、微信号等任何身份信息, 不做用户画像与行为埋点。\n' +
      '点击「同意并开始」即表示你已知悉上述数据使用方式, 详细条款见「关于」页。'
  },

  onLoad() {
    this.refresh();
  },

  onShow() {
    this.refresh();
    if (!STORAGE.hasOnboarded()) {
      this.setData({ showPrivacy: true });
    }
  },

  onAgreePrivacy() {
    STORAGE.setOnboarded();
    this.setData({ showPrivacy: false });
  },

  onViewPrivacy() {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  refresh() {
    const packs = BANK.listPacks();
    const selected = this.data.selected;
    const p = packs.find(x => x.id === selected);
    const total = p ? p.count : 30;
    const packTag = p && selected !== 'none'
      ? ' · 已选「' + p.name + '」+' + p.extra + ' 题'
      : '';
    const minutes = Math.ceil(total * 0.35) + '-' + Math.ceil(total * 0.45) + ' 分钟';

    // 未完成进度
    const raw = STORAGE.loadCurrentProgress();
    let pending = null;
    if (raw && raw.answers && Object.keys(raw.answers).length > 0) {
      pending = {
        ...raw,
        answered: Object.keys(raw.answers).length,
        totalQ: raw.totalQ || 30,
        packName: raw.packName || '通用版',
        dateStr: DATE.ago(raw.ts)
      };
    }

    // 历史记录
    const history = STORAGE.loadHistory().map(h => ({
      ...h,
      levelId: h.level ? h.level.id : '-',
      levelName: h.level ? h.level.name : '-',
      packName: h.packName || '通用版',
      qcount: (h.answered || 0) + '/' + (h.totalQ || 30),
      dateStr: DATE.ymdhm(h.ts),
      agoStr: DATE.ago(h.ts)
    }));

    this.setData({ packs, total, packTag, minutes, pending, history });
  },

  onPickPack(e) {
    const id = e.detail.id;
    const packs = this.data.packs;
    const p = packs.find(x => x.id === id);
    const total = p ? p.count : 30;
    this.setData({
      selected: id,
      selectedName: p ? p.name : '通用版',
      total,
      packTag: p && id !== 'none' ? ' · 已选「' + p.name + '」+' + p.extra + ' 题' : '',
      minutes: Math.ceil(total * 0.35) + '-' + Math.ceil(total * 0.45) + ' 分钟'
    });
  },

  // 主入口: 通用版 (+ 可选加测, blended)
  startQuiz() {
    wx.navigateTo({ url: '/pages/quiz/quiz?packId=' + this.data.selected });
  },

  // 专项单独成卷入口 (单独的入口)
  startStandalone() {
    if (this.data.selected === 'none') return;
    wx.navigateTo({ url: '/pages/quiz/quiz?packId=' + this.data.selected + '&mode=standalone' });
  },

  resumeQuiz() {
    const p = this.data.pending;
    if (!p) return this.startQuiz();
    const mode = p.mode === 'standalone' ? '&mode=standalone' : '';
    wx.navigateTo({
      url: '/pages/quiz/quiz?packId=' + (p.packId || this.data.selected) + '&resume=1' + mode
    });
  },

  restartQuiz() {
    STORAGE.clearCurrentProgress();
    this.refresh();
    this.startQuiz();
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  openHistoryItem(e) {
    const ts = e.currentTarget.dataset.ts;
    wx.navigateTo({ url: '/pages/result/result?ts=' + ts });
  },

  clearHistory() {
    wx.showModal({
      title: '清空历史',
      content: '确定要清空全部历史记录吗? 此操作不可恢复。',
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

  goAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  clearPending() {
    wx.showModal({
      title: '重新开始',
      content: '上次未完成的作答将被丢弃, 确定重新开始吗?',
      success: r => {
        if (r.confirm) {
          STORAGE.clearCurrentProgress();
          this.refresh();
        }
      }
    });
  },

  onShareAppMessage() {
    return {
      title: 'AI 使用能力诊断评估 · 6 维度 4 等级',
      path: '/pages/index/index'
    };
  }
});
