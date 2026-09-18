// app.js
App({
  globalData: {
    version: '0.7.0',
    frameworkRef: 'APCA v0.7'
  },

  onLaunch() {
    // 首次启动检查 (仅本地)
    console.log('[APCA] v' + this.globalData.version + ' 启动');
    const STORAGE = require('./utils/storage.js');
    if (!STORAGE.hasOnboarded()) {
      // 跳到首页, 首页里会显示隐私说明
    }
  }
});