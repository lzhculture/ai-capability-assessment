// utils/share.js
// 分享摘要生成

function buildSummary(r) {
  const strong = r.dimScores
    ? Object.entries(r.dimScores).sort((a, b) => b[1] - a[1])[0][0]
    : '';
  const weak = r.dimScores
    ? Object.entries(r.dimScores).sort((a, b) => a[1] - b[1])[0][0]
    : '';
  return [
    '我的 AI 能力等级: ' + r.level.id + ' · ' + r.level.name + ' (' + r.total + ' 分)',
    '强项 ' + strong + ', 待提升 ' + weak,
    '@AI 能力诊断评估'
  ].join('\n');
}

module.exports = { buildSummary };