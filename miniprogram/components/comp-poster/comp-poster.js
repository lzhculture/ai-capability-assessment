// components/comp-poster/comp-poster.js
// 结果海报: Canvas 2D 绘制 → 临时文件 → 保存到相册
// 父组件通过 this.selectComponent('#poster').make() 触发
const POSTER = require('../../utils/poster.js');

const QR_PATH = '/assets/qrcode.png';

Component({
  properties: {
    // {levelId, levelName, levelSubtitle, total, dimScores, strongName, weakName, packName, totalQ, dateStr}
    rec: { type: Object, value: null }
  },

  data: {
    W: POSTER.W,
    H: POSTER.H,
    busy: false,
    privacyContent: '本工具为本地运行的 AI 能力自评小程序, 保存海报需要用到「相册」权限：\n' +
      '· 相册: 仅用于将你的测评结果海报保存到本机相册便于分享, 不会读取相册中其他内容;\n' +
      '· 存储: 测评结果与历史记录仅保存在手机本机微信缓存 (wx.setStorageSync), 不上传任何服务器;\n' +
      '· 我们不收集姓名、手机号、微信号等任何身份信息, 不做用户画像与行为埋点;\n' +
      '· 你可随时在「关于」页或清理微信缓存删除全部本机数据。\n' +
      '点击「同意并保存」即表示你已知悉并授权上述本地存储与相册保存行为。'
  },

  attached() {
    this._privacyDestroyed = false;
    this._privacyResolve = null;
    // 微信隐私合规: 相册保存属隐私接口, 未授权时系统会回调此处, 需弹窗让用户确认
    if (typeof wx.onNeedPrivacyAuthorize === 'function') {
      this._privacyHandler = (resolve) => {
        if (this._privacyDestroyed) {
          try { resolve({ event: 'disagree' }); } catch (e) {}
          return;
        }
        this._privacyResolve = resolve;
        const popup = this.selectComponent('#privacyPopup');
        if (popup) popup.open();
        else try { resolve({ event: 'agree' }); } catch (e) {}
      };
      wx.onNeedPrivacyAuthorize(this._privacyHandler);
    }
  },

  detached() {
    this._privacyDestroyed = true;
  },

  methods: {
    /** 对外入口: 生成并保存海报 */
    make() {
      if (this.data.busy) return;
      const rec = this.data.rec;
      if (!rec) {
        wx.showToast({ title: '暂无可分享的结果', icon: 'none' });
        return;
      }
      this.setData({ busy: true });
      this._ensureAlbum((ok) => {
        if (!ok) {
          this.setData({ busy: false });
          return;
        }
        this._render((filePath, err) => {
          this.setData({ busy: false });
          if (!filePath) {
            wx.showToast({ title: err || '海报生成失败', icon: 'none' });
            return;
          }
          this._saveToAlbum(filePath);
        });
      });
    },

    // ---- 相册授权 ----
    _ensureAlbum(done) {
      wx.getSetting({
        success: (res) => {
          const st = (res.authSetting || {})['scope.writePhotosAlbum'];
          if (st === true) return done(true);
          if (st === false) {
            // 之前拒绝过, 必须引导去设置页
            wx.showModal({
              title: '需要相册权限',
              content: '保存海报需要「保存到相册」权限, 请在设置中开启。',
              confirmText: '去设置',
              cancelText: '取消',
              success: (r) => {
                if (r.confirm) {
                  wx.openSetting({
                    success: (s) => done(!!(s.authSetting || {})['scope.writePhotosAlbum'])
                  });
                } else {
                  done(false);
                }
              },
              fail: () => done(false)
            });
            return;
          }
          wx.authorize({
            scope: 'scope.writePhotosAlbum',
            success: () => done(true),
            fail: () => {
              wx.showToast({ title: '未获得相册权限', icon: 'none' });
              done(false);
            }
          });
        },
        fail: () => done(true) // 取不到设置时先尝试保存, 由系统自行拦截
      });
    },

    // ---- 绘制 ----
    _render(callback) {
      const query = wx.createSelectorQuery().in(this);
      query
        .select('#posterCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) {
            callback(null, '当前版本不支持海报, 请升级微信');
            return;
          }
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            callback(null, '画布初始化失败');
            return;
          }

          let dpr = 2;
          try {
            dpr = wx.getSystemInfoSync().pixelRatio || 2;
          } catch (e) {
            /* 保持默认 */
          }
          dpr = Math.min(Math.max(dpr, 1), 3);

          canvas.width = POSTER.W * dpr;
          canvas.height = POSTER.H * dpr;
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, POSTER.W, POSTER.H);

          this._loadQr(canvas, (qrImage) => {
            try {
              POSTER.drawPoster(ctx, this.data.rec, { qrImage });
            } catch (e) {
              callback(null, '绘制出错');
              return;
            }
            wx.canvasToTempFilePath({
              canvas,
              x: 0,
              y: 0,
              width: POSTER.W,
              height: POSTER.H,
              destWidth: POSTER.W * dpr,
              destHeight: POSTER.H * dpr,
              fileType: 'png',
              quality: 1,
              success: (r) => callback(r.tempFilePath),
              fail: () => callback(null, '生成图片失败')
            });
          });
        });
    },

    // ---- 小程序码 (可选, 缺失则画占位块) ----
    _loadQr(canvas, done) {
      let settled = false;
      const finish = (img) => {
        if (settled) return;
        settled = true;
        done(img || null);
      };
      // 2 秒兜底: 图不存在或加载慢时直接走占位
      const timer = setTimeout(() => finish(null), 2000);

      try {
        if (!canvas || typeof canvas.createImage !== 'function') {
          clearTimeout(timer);
          return finish(null);
        }
        const img = canvas.createImage();
        img.onload = () => {
          clearTimeout(timer);
          finish(img);
        };
        img.onerror = () => {
          clearTimeout(timer);
          finish(null);
        };
        img.src = QR_PATH;
      } catch (e) {
        clearTimeout(timer);
        finish(null);
      }
    },

    _saveToAlbum(filePath) {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => {
          wx.showToast({ title: '已保存到相册', icon: 'success', duration: 1800 });
          this.triggerEvent('saved', { filePath });
        },
        fail: (err) => {
          const msg = String((err && err.errMsg) || '');
          if (msg.indexOf('cancel') >= 0) {
            wx.showToast({ title: '已取消保存', icon: 'none' });
          } else {
            wx.showToast({ title: '保存失败, 请重试', icon: 'none' });
          }
          this.triggerEvent('error', { err });
        }
      });
    },

    // ---- 隐私授权弹层回调 (系统触发相册保存时由 onNeedPrivacyAuthorize 唤起) ----
    onAgreePrivacy() {
      const resolve = this._privacyResolve;
      this._privacyResolve = null;
      if (resolve) {
        try { resolve({ event: 'agree' }); } catch (e) {}
      }
    },

    onCancelPrivacy() {
      const resolve = this._privacyResolve;
      this._privacyResolve = null;
      if (resolve) {
        try { resolve({ event: 'disagree' }); } catch (e) {}
      }
      wx.showToast({ title: '已取消保存', icon: 'none' });
    }
  }
});
