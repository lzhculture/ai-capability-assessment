// utils/date.js
// 轻量日期格式化

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 2026-09-02 */
function ymd(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** 2026-09-02 14:30 */
function ymdhm(ts) {
  const d = new Date(ts);
  return ymd(ts) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** 相对时间: 刚刚 / 3 分钟前 / 2 小时前 / 3 天前 / 2026-09-02 */
function ago(ts) {
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 7 * 24 * 3600000) return Math.floor(diff / 86400000) + ' 天前';
  return ymd(ts);
}

module.exports = { ymd, ymdhm, ago, pad };
