// components/comp-level-card/comp-level-card.js
Component({
  properties: {
    level: { type: Object, value: null },  // {id, name, subtitle, ...}
    total: { type: Number, value: 0 },
    answered: { type: Number, value: 0 },
    totalQ: { type: Number, value: 30 },
    packName: { type: String, value: '通用版' },
    tip: { type: String, value: '' }
  }
});