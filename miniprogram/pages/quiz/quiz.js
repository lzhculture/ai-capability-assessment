// pages/quiz/quiz.js
// 答题页: 单题作答 + 自动跳下一题 + 断点续答 + 题卡跳转
const BANK = require('../../utils/bank.js');
const CALC = require('../../utils/calc.js');
const STORAGE = require('../../utils/storage.js');
const DIMS = require('../../data/dimensions.js');
const QT = require('../../data/question-types.js');

const AUTO_NEXT_DELAY = 260;

// 分值 → 选项字母 (兼容旧版本存档: 只存了分值没存字母)
const LETTER_BY_SCORE = { 0: 'A', 33.3: 'B', 66.7: 'C', 100: 'D' };

Page({
  data: {
    packId: 'none',
    mode: 'blended',
    packName: '通用版',
    weights: null,
    questions: [],
    total: 0,
    idx: 0,
    answers: {},   // { 题号: 分值 }  供计分用
    letters: {},   // { 题号: 选项字母 } 供结果页逐题复盘用
    cur: null,
    dimName: '',
    typeName: '',
    answeredCount: 0,
    grid: [],
    showCard: false,
    isLast: false
  },

  onLoad(options) {
    const packId = options.packId || 'none';
    const mode = options.mode === 'standalone' ? 'standalone' : 'blended';
    const questions = BANK.buildQuestions(packId, mode);
    // 专项单独成卷时, 卷名就是专项名 (如「招投标专项」); 加测/通用则用通用命名
    const meta = BANK.packMeta(packId);
    const packName = mode === 'standalone' && meta
      ? meta.name
      : BANK.packName(packId);
    const weights = mode === 'standalone' ? BANK.packWeights(packId) : null;

    let answers = {};
    let letters = {};
    let idx = 0;
    if (options.resume === '1') {
      const p = STORAGE.loadCurrentProgress();
      if (p && p.packId === packId && p.mode === mode && p.answers) {
        answers = p.answers || {};
        letters = p.letters || {};
        idx = Math.min(p.idx || 0, questions.length - 1);
      }
    }

    this.setData(
      { packId, mode, packName, weights, questions, total: questions.length, answers, letters, idx },
      () => this.sync()
    );

    wx.setNavigationBarTitle({ title: '测评中 · ' + packName });
  },

  onUnload() {
    this.saveProgress();
    if (this._timer) clearTimeout(this._timer);
  },

  onHide() {
    this.saveProgress();
  },

  // ---- 内部 ----
  sync() {
    const { questions, idx, answers } = this.data;
    const q = questions[idx];
    if (!q) return;
    const dim = DIMS.find(d => d.id === q.dimension) || { name: q.dimension };
    const type = QT[q.type] || { name: q.type };

    this.setData({
      cur: q,
      dimName: dim.name,
      typeName: type.name,
      answeredCount: Object.keys(answers).length,
      isLast: idx === questions.length - 1,
      grid: questions.map((item, i) => ({
        i,
        n: i + 1,
        done: answers[item.id] != null,
        on: i === idx
      }))
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 120 });
  },

  saveProgress() {
    const { answers, letters, idx, packId, packName, mode, questions } = this.data;
    if (!questions.length) return;
    const n = Object.keys(answers).length;
    if (n === 0) {
      STORAGE.clearCurrentProgress();
      return;
    }
    STORAGE.saveCurrentProgress({
      packId,
      mode,
      packName,
      idx,
      answers,
      letters,
      totalQ: questions.length
    });
  },

  guardUnload() {
    const n = Object.keys(this.data.answers).length;
    if (n > 0 && typeof wx.enableAlertBeforeUnload === 'function') {
      wx.enableAlertBeforeUnload({
        message: '退出后本次作答会自动保存在本机, 下次可从首页「继续上次」接着答。'
      });
    }
  },

  setAnswer(qid, score, letter) {
    const answers = { ...this.data.answers, [qid]: score };
    const letters = { ...this.data.letters };
    if (letter) letters[qid] = letter;
    this.setData({ answers, letters }, () => {
      this.saveProgress();
      this.sync();
      this.guardUnload();
    });
  },

  // ---- 交互 ----
  onPick(e) {
    const q = this.data.cur;
    if (!q) return;
    this.setAnswer(q.id, e.detail.score, e.detail.letter);

    if (this.data.idx < this.data.total - 1) {
      this._timer = setTimeout(() => {
        const next = this.data.idx + 1;
        this.setData({ idx: next }, () => this.sync());
      }, AUTO_NEXT_DELAY);
    }
  },

  prev() {
    if (this.data.idx <= 0) return;
    this.setData({ idx: this.data.idx - 1 }, () => this.sync());
  },

  next() {
    if (this.data.idx >= this.data.total - 1) return;
    this.setData({ idx: this.data.idx + 1 }, () => this.sync());
  },

  toggleCard() {
    this.setData({ showCard: !this.data.showCard });
  },

  jump(e) {
    const i = +e.currentTarget.dataset.i;
    this.setData({ idx: i, showCard: false }, () => this.sync());
  },

  noop() {},

  onSubmit() {
    this.submit(false);
  },

  submit(skipCheck) {
    const { questions, answers, packId, packName } = this.data;
    const n = Object.keys(answers).length;
    if (!n) {
      wx.showToast({ title: '至少答一题', icon: 'none' });
      return;
    }
    const doSubmit = () => {
      const r = CALC.calcResult(questions, answers, this.data.weights || null);
      const ts = Date.now();
      // 只存作答痕迹 (题号 + 选项字母), 用于结果页逐题复盘; 不存题干, 体积可忽略
      // letters 缺失时 (如旧版本存档) 由分值反查, 保证复盘不会空
      const letters = this.data.letters || {};
      const answerTrail = Object.keys(answers).map(id => ({
        id,
        letter: letters[id] || LETTER_BY_SCORE[Math.round((answers[id] || 0) * 10) / 10] || null
      })).filter(x => x.letter);
      STORAGE.appendHistory({
        ts,
        total: r.total,
        dimScores: r.dimScores,
        answered: r.answered,
        totalQ: questions.length,
        packId,
        mode: this.data.mode,
        packName,
        isStandalone: this.data.mode === 'standalone',
        level: r.level,
        answers: answerTrail
      });
      STORAGE.clearCurrentProgress();
      if (typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload();
      wx.redirectTo({ url: '/pages/result/result?ts=' + ts });
    };

    if (n < questions.length && !skipCheck) {
      wx.showModal({
        title: '还有 ' + (questions.length - n) + ' 题未答',
        content: '未答的题目不会计入成绩。建议补齐后再交卷, 也可以先看当前结果。',
        confirmText: '直接出结果',
        cancelText: '继续答题',
        success: res => {
          if (res.confirm) doSubmit();
          else {
            const first = questions.findIndex(q => answers[q.id] == null);
            if (first >= 0) this.setData({ idx: first, showCard: true }, () => this.sync());
          }
        }
      });
      return;
    }
    doSubmit();
  },

  onShareAppMessage() {
    return {
      title: 'AI 使用能力诊断评估 · ' + this.data.packName,
      path: '/pages/index/index'
    };
  }
});
