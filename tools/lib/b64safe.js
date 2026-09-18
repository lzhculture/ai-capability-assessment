/* ===== APCA 通用小工具 · Base64 安全编码（Node 侧）=====
 * 用途: 给测试/构建脚本做 Base64 编码, 替代 `btoa(String.fromCharCode.apply(null, bytes))`。
 *       后者在 V8 上超过 ~65535 个参数即抛 RangeError("Maximum call stack size exceeded")。
 *
 * 算法: 按 0x8000 (32768) 字节分块 apply, 留足安全裕度。相同算法见 web/app.js 浏览器端实现。
 * 注: 浏览器端 app.js 已自带 0x8000 分块实现, 这里仅给 Node 工具链用。
 */
'use strict';

var CHUNK = 0x8000;

function b64encodeUnicode(str) {
  var bytes = new TextEncoder().encode(String(str == null ? '' : str));
  var chunks = [];
  for (var i = 0; i < bytes.length; i += CHUNK) {
    var slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    chunks.push(String.fromCharCode.apply(null, slice));
  }
  return btoa(chunks.join(''));
}

module.exports = { b64encodeUnicode: b64encodeUnicode };