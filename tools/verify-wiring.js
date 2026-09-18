/* 静态接线校验 (不依赖 DOM 库)
 * 目的: 捕捉 DOM 功能测试最该防的头号 bug —— JS 里引用了 html 中不存在的元素 id。
 * 做法: 抽取 js 中所有 $('#id') / querySelector('#id') 字面量选择器,
 *       与 html 中实际定义的 id 集合做差集。
 * 背景: 本环境 jsdom / linkedom 的模块加载均会挂起, 无法跑真实 DOM 测试,
 *       故以此静态校验作为可靠替代(verify-web-dom.js 保留, 在正常 Node 环境可跑)。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

// 抽取 html 中定义的 id
function idsInHtml(file) {
  const html = fs.readFileSync(file, 'utf8');
  const set = new Set();
  const re = /\sid\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) set.add(m[1]);
  return set;
}

// 抽取 js 中引用的 id
// 仅认"纯 id 字面量": 括号内以 # 开头、引号后立即闭合, 形如 $('#toast')
// 这样可排除 $('#view-' + name) 这类动态拼接(由下方 VIEWS 单独校验)
function idsInJs(file) {
  const js = fs.readFileSync(file, 'utf8');
  const set = new Set();
  const re = /(?:\$|querySelector|querySelectorAll|getElementById)\(\s*'#([A-Za-z0-9_-]+)'\s*\)/g;
  let m;
  while ((m = re.exec(js)) !== null) set.add(m[1]);
  return set;
}

console.log('== 静态接线校验 ==');

// ---------- app.js <-> index.html ----------
const htmlIds = idsInHtml(path.join(WEB, 'index.html'));
const appIds = idsInJs(path.join(WEB, 'app.js'));
// 白名单: 这些 id 由 renderResult()/renderHome() 等动态注入, 不在 index.html 静态声明中
// 例如 v0.8.6: 复盘折叠切换按钮 #btnReviewToggle 由 renderResult 内部字符串注入
const DYNAMIC_INJECTED = new Set(['btnReviewToggle']);
const missing = [...appIds].filter((id) => !htmlIds.has(id) && !DYNAMIC_INJECTED.has(id));
ok(missing.length === 0,
  'app.js 引用的 ' + appIds.size + ' 个元素 id 全部存在于 index.html (动态注入 ' + DYNAMIC_INJECTED.size + ' 个白名单)' +
  (missing.length ? ' —— 缺失: ' + missing.join(', ') : ''));

// 视图容器(由 $('#view-' + name) 动态拼接, 需单独校验)
const VIEWS = ['home', 'info', 'quiz', 'result', 'history', 'about'];
const missView = VIEWS.filter((v) => !htmlIds.has('view-' + v));
ok(missView.length === 0,
  '6 个视图容器 #view-* 均存在' + (missView.length ? ' —— 缺失: ' + missView.join(', ') : ''));

// ---------- 测评人信息页字段 ----------
const INFO_IDS = ['view-info', 'infoName', 'infoCompany', 'infoPosition', 'infoBatch', 'infoNotes', 'btnInfoStart'];
const missInfo = INFO_IDS.filter((id) => !htmlIds.has(id));
ok(missInfo.length === 0,
  '测评人信息页 7 个节点齐备' + (missInfo.length ? ' —— 缺失: ' + missInfo.join(', ') : ''));

// 信息页接线: app.js 必须读取这些字段并绑定开始按钮
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
// view-info 由 $('#view-' + name) 动态拼接引用, 故此处只校验表单与按钮的字面量引用
const INFO_REF_IDS = INFO_IDS.filter((id) => id !== 'view-info');
INFO_REF_IDS.forEach((id) => {
  ok(appSrc.indexOf("'#" + id + "'") !== -1, 'app.js 已引用 #' + id);
});
ok(/gotoInfo/.test(appSrc) && /startFromInfo/.test(appSrc), 'app.js 定义 gotoInfo / startFromInfo');
ok(/btnStart'\)\.addEventListener\('click', gotoInfo\)/.test(appSrc), '首页「开始测评」改为先进信息页');
ok(/info: state\.info \|\| null/.test(appSrc), '测评记录写入 info 字段');
ok(/clientId: getClientId\(\)/.test(appSrc), '测评记录写入 clientId');
ok(/syncToServer\(record\)/.test(appSrc), '提交时调用 syncToServer 同步后台');

// ---------- admin.js <-> admin.html (若存在) ----------
const adminHtml = path.join(WEB, 'admin.html');
const adminJs = path.join(WEB, 'admin.js');
if (fs.existsSync(adminHtml) && fs.existsSync(adminJs)) {
  const aHtmlIds = idsInHtml(adminHtml);
  const aJsIds = idsInJs(adminJs);
  const aMissing = [...aJsIds].filter((id) => !aHtmlIds.has(id));
  ok(aMissing.length === 0,
    'admin.js 引用的 ' + aJsIds.size + ' 个元素 id 全部存在于 admin.html' +
    (aMissing.length ? ' —— 缺失: ' + aMissing.join(', ') : ''));
} else {
  console.log('  · admin 页面尚未生成, 跳过该项');
}

// ---------- APCA_DATA 字段引用校验 ----------
// 防"字段名写错"这类只有运行时才暴露的问题(如 D.questionType 少了 s)
const dataCode = fs.readFileSync(path.join(WEB, 'data.js'), 'utf8');
const win = {};
new Function('window', dataCode)(win);
const DATA = win.APCA_DATA || {};
[['app.js', 'web/app.js'], ['admin.js', 'web/admin.js']].forEach(function (pair) {
  const label = pair[0];
  const src = fs.readFileSync(path.join(ROOT, pair[1]), 'utf8');
  const used = new Set();
  const re = /\bD\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(src)) !== null) used.add(m[1]);
  const bad = Array.from(used).filter((k) => !(k in DATA));
  ok(bad.length === 0,
    label + ' 引用的 ' + used.size + ' 个 APCA_DATA 字段均存在' +
    (bad.length ? ' —— 不存在: ' + bad.join(', ') : ''));
});

// questionTypes 是"以 id 为键的对象", 历史上曾被误当数组使用, 此处固化其形态
ok(DATA.questionTypes && !Array.isArray(DATA.questionTypes),
  'questionTypes 为对象形态(代码已按对象归一化处理)');
ok(Array.isArray(DATA.dimensions) && Array.isArray(DATA.levels) && Array.isArray(DATA.core) && Array.isArray(DATA.packs),
  'dimensions / levels / core / packs 均为数组形态');

console.log('');
console.log('==== 结果: ' + pass + ' PASS / ' + fail + ' FAIL ====');
process.exit(fail ? 1 : 0);
