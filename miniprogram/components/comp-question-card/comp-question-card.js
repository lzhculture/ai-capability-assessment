// components/comp-question-card/comp-question-card.js
const SCORE_MAP = require('../../utils/calc.js').SCORE_MAP;

Component({
  properties: {
    q: { type: Object, value: null },
    ans: { type: Number, value: null },
    dimName: { type: String, value: '' },
    typeName: { type: String, value: '' },
    showAnalysis: { type: Boolean, value: false }
  },
  data: {
    letters: ['A', 'B', 'C', 'D'],
    scoreMap: SCORE_MAP
  },
  methods: {
    onPick(e) {
      const letter = e.currentTarget.dataset.letter;
      const score = SCORE_MAP[letter];
      this.triggerEvent('pick', { letter, score });
    }
  }
});