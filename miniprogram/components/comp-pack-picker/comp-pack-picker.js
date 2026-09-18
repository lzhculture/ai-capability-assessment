// components/comp-pack-picker/comp-pack-picker.js
Component({
  properties: {
    packs: { type: Array, value: [] },        // [{id,name,desc,count}]
    selected: { type: String, value: 'none' }
  },
  methods: {
    onPick(e) {
      const id = e.currentTarget.dataset.id;
      this.triggerEvent('change', { id });
    }
  }
});