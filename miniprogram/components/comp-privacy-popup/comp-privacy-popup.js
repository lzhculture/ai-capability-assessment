// components/comp-privacy-popup/comp-privacy-popup.js
// 通用隐私授权弹层（底部抽屉式）
// 父组件通过 selectComponent('#x').open() 唤起；用户「同意」触发 bind:agree，「暂不使用」触发 bind:cancel
Component({
  properties: {
    title: { type: String, value: '隐私保护指引' },
    contractName: { type: String, value: '' },
    content: { type: String, value: '' },
    agreeText: { type: String, value: '同意并继续' },
    cancelText: { type: String, value: '暂不使用' },
    showCancel: { type: Boolean, value: false }
  },

  data: {
    visible: false
  },

  methods: {
    open() {
      this.setData({ visible: true });
    },
    close() {
      this.setData({ visible: false });
    },
    onAgree() {
      this.triggerEvent('agree');
    },
    onCancel() {
      this.triggerEvent('cancel');
    },
    // 阻止点击内容区关闭弹层
    noop() {}
  }
});
