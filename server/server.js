/* ===== APCA 管理后台服务 · 零依赖 Node HTTP 服务 =====
 *
 * 职责:
 *   1) 静态托管 web/ 目录 —— 测评站(index.html) 与 后台页(admin.html) 一体
 *   2) 接收测评提交, 集中落库到 server/data/records.json
 *   3) 为后台提供: 密码登录鉴权 / 汇总统计 / 人员清单 / 题库与规则库 / 删除与清空
 *
 * 启动:
 *   node server/server.js
 * 可用环境变量覆盖:
 *   PORT              端口, 默认 8787
 *   APCA_ADMIN_USER   管理员账号, 默认 admin
 *   APCA_ADMIN_PASS   管理员密码, 必填
 *
 *   ⚠ v0.8.11 起不再内置任何默认口令: 未设置 APCA_ADMIN_PASS 时服务**拒绝启动**。
 *     原因——把口令写死在代码里, 仓库一旦公开等于把后台密码公之于众;
 *     而"照文档跑起来却忘了设密码"的情况恰恰最常见。现在不给值就起不来,
 *     反而是最省心的提醒方式。只想体验问卷可以直接用浏览器打开 web/index.html,
 *     不必启动本服务。
 *
 * 注意: 纯静态方式(直接双击 index.html)打开测评站时, 不存在本服务,
 *       测评结果只存本机 localStorage, 后台页退化为"本地模式"。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
// 记录库目录: 默认 server/data, 可用 APCA_DATA_DIR 覆盖(便于测试隔离与部署到指定位置)
const DATA_DIR = process.env.APCA_DATA_DIR
  ? path.resolve(process.env.APCA_DATA_DIR)
  : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'records.json');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;
const ADMIN_USER = process.env.APCA_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.APCA_ADMIN_PASS || '';

// v0.8.11: 未显式指定管理员密码 → 拒绝启动(v0.8.10 及以前兜底为内置默认口令, 已移除)。
// 本机纯浏览器打开 web/index.html 做测评不受影响, 那条路径根本不经过本服务。
if (!ADMIN_PASS) {
  console.error('');
  console.error('  [FATAL] 未设置环境变量 APCA_ADMIN_PASS, 服务拒绝启动。');
  console.error('');
  console.error('  请先指定一个自己的管理员密码, 例如:');
  console.error('    APCA_ADMIN_PASS=你的强密码 node server/server.js');
  console.error('');
  console.error('  只想做测评的话不必启动本服务: 浏览器直接打开 web/index.html,');
  console.error('  作答结果保存在你自己的电脑里(本机模式)。');
  console.error('');
  process.exit(1);
}

const TOKEN_TTL = 8 * 60 * 60 * 1000;   // 登录有效期 8 小时
const MAX_RECORDS = 20000;              // 库容量上限, 防止无限增长
const MAX_BODY = 4 * 1024 * 1024;       // 请求体上限 4MB
const MAX_FAIL = 8;                     // 登录失败次数上限
const LOCK_MS = 10 * 60 * 1000;         // 触发后锁定时长 10 分钟

// v0.8.5: 提交限流 (单 IP 滑动窗口) — 防止被刷数据/写满磁盘
const SUBMIT_RATE_LIMIT = parseInt(process.env.APCA_SUBMIT_RATE_LIMIT || '10', 10);
const SUBMIT_WINDOW_MS = 60 * 1000;    // 窗口长度
const submitLog = new Map();            // ip -> [ts1, ts2, ...]

// 跨服务器聚合（后台视图层合并对端 records）
//   设为空即不聚合; APCA_PEER_URL = 对端 base url, APCA_PEER_TOKEN = 对端 APCA_ADMIN_PASS
const PEER_URL  = (process.env.APCA_PEER_URL  || '').replace(/\/+$/, '');
const PEER_USER = process.env.APCA_PEER_USER || 'admin';
const PEER_TOKEN = process.env.APCA_PEER_TOKEN || process.env.APCA_ADMIN_PASS || '';
const PEER_TIMEOUT_MS = parseInt(process.env.APCA_PEER_TIMEOUT || '3000', 10);
const PEER_CACHE_MS  = parseInt(process.env.APCA_PEER_CACHE_MS || '30000', 10);
let peerCache = { at: 0, records: null, status: 'unknown', latencyMs: 0, error: '' };
let peerLoginCache = { token: '', at: 0 };

function checkSubmitRate(ip) {
  const now = Date.now();
  const arr = submitLog.get(ip) || [];
  const fresh = arr.filter((t) => now - t < SUBMIT_WINDOW_MS);
  if (fresh.length >= SUBMIT_RATE_LIMIT) {
    submitLog.set(ip, fresh);
    return false;
  }
  fresh.push(now);
  submitLog.set(ip, fresh);
  return true;
}

// v0.8.5: 提交载荷校验 — 类型、范围、字段完整性
const VALID_LEVELS = new Set(['L1', 'L2', 'L3', 'L4']);
const VALID_DIMS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
const VALID_SCORE = [0, 33.3, 66.7, 100];
function isValidScore(s) {
  return typeof s === 'number' && VALID_SCORE.some((v) => Math.abs(v - s) < 0.01);
}
/* v0.8.7: 服务端独立重算, 防止客户端伪造 total/dimScores 提交入库 (P0-2.1) */
const LEVEL_THRESHOLDS = [
  { id: 'L1', name: '尝试·起步', min: 0 },
  { id: 'L2', name: '熟练·应用', min: 40 },
  { id: 'L3', name: '体系·协作', min: 65 },
  { id: 'L4', name: '系统·输出', min: 85 }
];
function serverLevelOf(total) {
  let lv = LEVEL_THRESHOLDS[0];
  for (const t of LEVEL_THRESHOLDS) if (total >= t.min) lv = t;
  return { id: lv.id, name: lv.name };
}
function serverBuildQuestions(packId, mode) {
  if (!APCA) return [];
  if (!packId || packId === 'general' || packId === 'none') {
    return mode === 'standalone' && packId === 'none' ? APCA.core.slice() : APCA.core.slice();
  }
  const pack = APCA.packs.find((p) => p.id === packId);
  if (!pack) return APCA.core.slice();   // 兜底: 找不到的 packId 也走通用卷 (避免 undefined pack)
  if (mode === 'blended') return [...APCA.core, ...pack.questions];
  return pack.questions.slice();
}
// v0.8.9 P0-1: 加权模型与前端 app.js:439/452 → 94-99 对齐
//   - 通用卷(blended)/合并出分(merged): 等权(按实际作答维度数归一化)
//   - 专项卷(blended/standalone): 用 pack.weights(声明权重), 不是「每维度题目数」等价等权
//   - 前端 app.js:439 无条件设 state.weights=packWeights(packId); app.js:542 合并跳才传 null
function serverCalcResult(packId, mode, answers, merged) {
  const qs = serverBuildQuestions(packId, mode);
  const dimScores = {}, dimCount = {};
  Object.keys(answers || {}).forEach((qid) => {
    const v = answers[qid];
    if (v == null) return;
    const q = qs.find((x) => x.id === qid);
    if (!q) return;
    dimScores[q.dimension] = (dimScores[q.dimension] || 0) + v;
    dimCount[q.dimension] = (dimCount[q.dimension] || 0) + 1;
  });
  Object.keys(dimScores).forEach((d) => {
    dimScores[d] = +(dimScores[d] / dimCount[d]).toFixed(1);
  });
  const pack = packId && packId !== 'general' && packId !== 'none' ? APCA.packs.find((p) => p.id === packId) : null;
  let total;
  if (merged) {
    // v0.8.9 P0-1: 合并出分(merged)按前端 app.js:542 传 null 同口径走等权
    const dn = Object.keys(dimScores).length;
    total = dn > 0 ? Object.keys(dimScores).reduce((a, d) => a + dimScores[d], 0) / dn : 0;
  } else if (pack && pack.weights) {
    // 专项卷: 用声明权重(与前端 app.js:94-99 同源)
    let ws = 0, sw = 0;
    Object.keys(dimScores).forEach((d) => { const w = pack.weights[d] || 0; ws += dimScores[d] * w; sw += w; });
    total = sw > 0 ? ws / sw : 0;
  } else {
    // 通用/blended 无 weights: 六维等权(按实际作答维度数归一化, 防缺答稀释)
    const dn = Object.keys(dimScores).length;
    total = dn > 0 ? Object.keys(dimScores).reduce((a, d) => a + dimScores[d], 0) / dn : 0;
  }
  let answered = 0;
  Object.keys(answers || {}).forEach((k) => { if (answers[k] != null) answered++; });
  const completeness = qs.length > 0 ? +(answered / qs.length).toFixed(3) : 0;
  // v0.8.9 P0-2: 只有全答完才出等级; 缺答不显示具体等级, 但总分/维度分仍计算(用于画像与建议)
  const lv = completeness < 1 ? { id: null, name: '未答完 · 不出等级' } : serverLevelOf(total);
  return { total: +total.toFixed(1), dimScores, answered, completeness, level: lv };
}
function validateRecord(rec) {
  if (!rec || typeof rec !== 'object') return '数据格式错误';
  if (typeof rec.total !== 'number' || rec.total < 0 || rec.total > 100) return 'total 需为 0-100 的数字';
  if (typeof rec.levelId !== 'string' || !VALID_LEVELS.has(rec.levelId)) return 'levelId 需为 L1-L4 之一';
  if (typeof rec.dimScores !== 'object' || rec.dimScores === null) return 'dimScores 缺失';
  for (const d of VALID_DIMS) {
    const v = rec.dimScores[d];
    if (typeof v !== 'number' || v < 0 || v > 100) return `dimScores.${d} 需为 0-100 的数字`;
  }
  if (rec.info != null) {
    if (typeof rec.info !== 'object') return 'info 需为对象';
    for (const k of ['name', 'company', 'position']) {
      const v = rec.info[k];
      if (v == null) continue;
      if (typeof v !== 'string') return `info.${k} 需为字符串`;
      if (v.length > 100) return `info.${k} 长度超限 (≤100)`;
    }
  }
  if (rec.answers != null) {
    if (typeof rec.answers !== 'object' || Array.isArray(rec.answers)) return 'answers 需为对象';
    const keys = Object.keys(rec.answers);
    if (keys.length > 84) return 'answers 数量异常 (>84)';
    for (const qid of keys) {
      if (typeof qid !== 'string' || qid.length === 0 || qid.length > 32) return 'qid 异常';
      if (!isValidScore(rec.answers[qid])) return `${qid} 分值需为 0/33.3/66.7/100`;
    }
  }
  if (rec.packId != null && typeof rec.packId !== 'string') return 'packId 需为字符串';
  if (rec.qVersion != null && typeof rec.qVersion !== 'string') return 'qVersion 需为字符串';
  if (rec.framework != null && typeof rec.framework !== 'string') return 'framework 需为字符串';
  if (rec.ts != null && (typeof rec.ts !== 'number' || rec.ts < 0)) return 'ts 需为正数';
  return null;   // 校验通过
}

/* ---------------- 题库数据(供 /api/admin/bank 与统计使用) ---------------- */
let APCA = null;
try {
  const code = fs.readFileSync(path.join(WEB, 'data.js'), 'utf8');
  const win = {};
  new Function('window', code)(win);   // data.js 会做 window.APCA_DATA = {...}
  APCA = win.APCA_DATA || null;
} catch (e) {
  APCA = null;
}
const DIM_IDS = APCA ? APCA.dimensions.map((d) => d.id) : ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];

/* ---------------- 存储 ---------------- */
let records = [];

function loadStore() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, '[]', 'utf8');
      records = [];
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    records = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('[warn] 读取记录库失败, 以空库启动:', e.message);
    records = [];
  }
}

let saving = false;
function saveStore() {
  if (saving) return;
  saving = true;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);   // 原子替换, 避免写一半损坏
  } catch (e) {
    console.error('[error] 写入记录库失败:', e.message);
  } finally {
    saving = false;
  }
}

/* ---------------- 跨服务器聚合（仅后台视图层用） ---------------- */
async function fetchPeerRecords() {
  if (!PEER_URL) return { ok: false, configured: false, error: '未配 APCA_PEER_URL' };
  // 30 秒内存缓存, 避免频繁拉取
  const now = Date.now();
  if (peerCache.records && now - peerCache.at < PEER_CACHE_MS) {
    return Object.assign({}, peerCache, { latencyMs: 0 });
  }
  const t0 = Date.now();
  try {
    // 1) 登录拿 token (复用 8 小时 TTL, 缓存到过期前 60s)
    const TTL = 8 * 60 * 60 * 1000;
    let tk = peerLoginCache.token;
    if (!tk || now - peerLoginCache.at > TTL - 60000) {
      const loginResp = await fetchWithTimeout(`${PEER_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: PEER_USER, pass: PEER_TOKEN })
      });
      const loginJson = await loginResp.json().catch(() => ({}));
      if (!loginJson.ok || !loginJson.token) {
        throw new Error(`对端登录失败 ${loginResp.status}`);
      }
      tk = loginJson.token;
      peerLoginCache = { token: tk, at: Date.now() };
    }
    // 2) 拉对端 records
    const resp = await fetchWithTimeout(`${PEER_URL}/api/admin/records`, {
      headers: { 'X-Admin-Token': tk }
    });
    const j = await resp.json().catch(() => ({}));
    if (!j.ok || !Array.isArray(j.records)) {
      throw new Error(`对端返回非 ok 或 records 缺失 (status=${resp.status})`);
    }
    const latency = Date.now() - t0;
    peerCache = {
      at: now,
      records: j.records,
      status: 'ok',
      latencyMs: latency,
      error: ''
    };
    return { ok: true, configured: true, records: j.records, latencyMs: latency, error: '' };
  } catch (e) {
    const latency = Date.now() - t0;
    peerCache = {
      at: now,
      records: null,
      status: 'unreachable',
      latencyMs: latency,
      error: String(e.message || e)
    };
    return { ok: false, configured: true, records: [], latencyMs: latency, error: String(e.message || e) };
  }
}

function fetchWithTimeout(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PEER_TIMEOUT_MS);
  return fetch(url, Object.assign({}, options, { signal: ctrl.signal }))
    .finally(() => clearTimeout(timer));
}

/* ---------------- 鉴权 ---------------- */
const tokens = new Map();          // token -> 过期时间戳
const failMap = new Map();         // ip -> {n, lockedUntil}

function isLocked(ip) {
  const r = failMap.get(ip);
  return !!(r && r.lockedUntil && r.lockedUntil > Date.now());
}
function noteFail(ip) {
  const r = failMap.get(ip) || { n: 0, lockedUntil: 0 };
  r.n += 1;
  if (r.n >= MAX_FAIL) { r.lockedUntil = Date.now() + LOCK_MS; r.n = 0; }
  failMap.set(ip, r);
}
function clearFail(ip) { failMap.delete(ip); }

function newToken() {
  const t = crypto.randomBytes(24).toString('hex');
  tokens.set(t, Date.now() + TOKEN_TTL);
  return t;
}
function sweepTokens() {
  const now = Date.now();
  tokens.forEach((exp, t) => { if (exp < now) tokens.delete(t); });
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
// 令牌来源: 优先请求头 X-Admin-Token, 其次 ?token=(便于直接调试)
function readToken(req, url) {
  const h = req.headers['x-admin-token'];
  if (h && typeof h === 'string') return h;
  const q = url.searchParams.get('token');
  return q || '';
}
function isAuthed(req, url) {
  sweepTokens();
  const t = readToken(req, url);
  if (!t) return false;
  const exp = tokens.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { tokens.delete(t); return false; }
  return true;
}

/* ---------------- 汇总统计 ---------------- */
function round1(n) { return Math.round(n * 10) / 10; }

function groupBy(list, keyFn) {
  const m = new Map();
  list.forEach((r) => {
    const k = keyFn(r) || '未填写';
    const cur = m.get(k) || { key: k, count: 0, sum: 0 };
    cur.count += 1;
    cur.sum += r.total || 0;
    m.set(k, cur);
  });
  return Array.from(m.values())
    .map((g) => ({ key: g.key, count: g.count, avg: round1(g.sum / g.count) }))
    .sort((a, b) => b.count - a.count || b.avg - a.avg);
}

function computeStats(list) {
  const n = list.length;
  const scores = list.map((r) => r.total || 0).slice().sort((a, b) => a - b);
  const sum = scores.reduce((a, b) => a + b, 0);
  const avg = n ? round1(sum / n) : 0;
  const median = n
    ? (n % 2 ? scores[(n - 1) / 2] : round1((scores[n / 2 - 1] + scores[n / 2]) / 2))
    : 0;

  const levelDist = { L1: 0, L2: 0, L3: 0, L4: 0 };
  list.forEach((r) => { if (Object.prototype.hasOwnProperty.call(levelDist, r.levelId)) levelDist[r.levelId] += 1; });

  const dimAvg = {};
  DIM_IDS.forEach((d) => {
    const vals = list.map((r) => (r.dimScores && r.dimScores[d]) || 0).filter((v) => typeof v === 'number');
    dimAvg[d] = vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  });

  const info = (r) => r.info || {};
  const byDay = {};
  list.forEach((r) => {
    const d = new Date(r.ts || Date.now());
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    byDay[k] = (byDay[k] || 0) + 1;
  });
  const trend = Object.keys(byDay).sort().map((k) => ({ key: k, count: byDay[k] }));

  return {
    total: n,
    avg: avg,
    median: median,
    max: n ? scores[n - 1] : 0,
    min: n ? scores[0] : 0,
    levelDist: levelDist,
    dimAvg: dimAvg,
    byCompany: groupBy(list, (r) => info(r).company),
    byPosition: groupBy(list, (r) => info(r).position),
    byBatch: groupBy(list, (r) => info(r).batch),
    // v0.8.5: byPack 按 (packId, qVersion) 分组, 避免同名不同版本题包被混在一个池里
    // packId='none' 在前端表示"通用卷", 在统计里归一为 '通用', 与 packName 保持一致
    byPack: groupBy(list, (r) => (r.packId && r.packId !== 'none' ? r.packId : '通用') + '@' + (r.qVersion || 'unknown')),
    trend: trend
  };
}

/* ---------------- HTTP 工具 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

 function sendJSON(res, code, obj) {
   const body = Buffer.from(JSON.stringify(obj), 'utf8');
   res.writeHead(code, {
     'Content-Type': 'application/json; charset=utf-8',
     'Content-Length': body.length,
     'Cache-Control': 'no-store',
     'X-Powered-By': 'APCA by jmount',
     'X-Author': 'jmount',
     // v0.8.8 S-04: 加 4 个安全响应头 (防 MIME 嗅探 / 点击劫持 / Referer 泄露 / XSS 注入)
     // img/data: 用于海报生成 canvas.toDataURL 内联, default-src 'self' 允许本站资源
     'X-Content-Type-Options': 'nosniff',
     'X-Frame-Options': 'DENY',
     'Referrer-Policy': 'no-referrer',
     'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'"
   });
   res.end(body);
 }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > MAX_BODY) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) reject(new Error('请求体过大'));
      else resolve(buf);
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';

  // 防目录穿越: 规范化后必须仍在 WEB 目录内
  const target = path.normalize(path.join(WEB, rel));
  if (!target.startsWith(WEB)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }
  fs.readFile(target, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + rel);
      return;
    }
    const ext = path.extname(target).toLowerCase();
    // v0.8.9 P1-3: 静态资源(HTML/JS/CSS)也补 4 个安全响应头
    //   之前 v0.8.8 S-04 只在 sendJSON() 加, 但 CSP/X-Frame-Options 必须作用在文档响应才能生效
    //   对纯文本/data:image 类非文档资源只加 nosniff + Referrer-Policy(避免 CSP 不必要的副作用)
    const isDoc = ['.html', '.htm', '.js', '.css'].indexOf(ext) !== -1;
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    };
    if (isDoc) {
      headers['X-Frame-Options'] = 'DENY';
      headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'";
    }
    res.writeHead(200, headers);
    res.end(buf);
  });
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname;
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');

  try {
    /* --- 提交测评结果 --- */
    if (pathname === '/api/submit' && req.method === 'POST') {
      // v0.8.5: 限流(单 IP 滑动窗口) + 强化校验
      if (!checkSubmitRate(ip)) {
        return sendJSON(res, 429, { ok: false, error: '提交过于频繁, 请稍后再试' });
      }
      const raw = await readBody(req);
      let rec;
      try { rec = JSON.parse(raw); } catch (e) { return sendJSON(res, 400, { ok: false, error: 'JSON 解析失败' }); }
      const err = validateRecord(rec);
      if (err) return sendJSON(res, 400, { ok: false, error: err });
      // v0.8.7 P0-2.1 + v0.8.9 P0-1: 服务端独立重算, 不信任客户端 total/dimScores;
      // 加权模型已与前端 app.js 对齐(用 pack.weights + 识别 merged 走等权)
      const svRec = serverCalcResult(rec.packId, rec.mode, rec.answers || {}, !!rec.merged);
      const clientTotal = +rec.total;
      const sentDiff = Math.abs(svRec.total - clientTotal);
      if (sentDiff > 0.5) {
        return sendJSON(res, 400, { ok: false, error: `total 校验失败: 服务端重算 ${svRec.total} 与提交 ${clientTotal} 偏差 ${sentDiff.toFixed(2)} (>0.5)` });
      }
      // 入库用服务端结果（防客户端事后改 dimScores 做假数据）
      rec.total = svRec.total;
      rec.dimScores = svRec.dimScores;
      rec.completeness = svRec.completeness;
      rec.answered = svRec.answered;
      rec.id = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
      rec.receivedAt = Date.now();
      // v0.8.5: 兼容历史缺 qVersion 的记录; 缺则记为 unknown 以便后台 byPack 仍能分组
      if (!rec.qVersion) rec.qVersion = 'unknown';
      records.push(rec);
      if (records.length > MAX_RECORDS) records = records.slice(-MAX_RECORDS);
      saveStore();
      return sendJSON(res, 200, { ok: true, id: rec.id, count: records.length });
    }

    /* --- 管理员登录 --- */
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      if (isLocked(ip)) {
        return sendJSON(res, 429, { ok: false, error: '尝试次数过多, 请 10 分钟后再试' });
      }
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch (e) { body = {}; }
      if (safeEqual(body.user || '', ADMIN_USER) && safeEqual(body.pass || '', ADMIN_PASS)) {
        clearFail(ip);
        return sendJSON(res, 200, { ok: true, token: newToken(), ttl: TOKEN_TTL });
      }
      noteFail(ip);
      return sendJSON(res, 401, { ok: false, error: '账号或密码错误' });
    }

    /* --- 服务探测(免鉴权, 供后台页判断是否为服务端模式) --- */
    if (pathname === '/api/ping') {
      // v0.8.8 S-03: 不暴露记录总数, 仅返回存活状态 + service 标识, count 字段已移除
      return sendJSON(res, 200, { ok: true, service: 'apca-admin-by-jmount' });
    }

    /* --- 以下接口均需鉴权 --- */
    if (pathname.startsWith('/api/admin/')) {
      if (!isAuthed(req, url)) return sendJSON(res, 401, { ok: false, error: '未登录或登录已过期' });

      if (pathname === '/api/admin/ping') {
        return sendJSON(res, 200, { ok: true, count: records.length, hasBank: !!APCA });
      }

      if (pathname === '/api/admin/stats') {
        return sendJSON(res, 200, { ok: true, stats: computeStats(records) });
      }

      if (pathname === '/api/admin/records' && req.method === 'GET') {
        // 倒序返回(最新在前)
        const list = records.slice().reverse();
        const wantMirror = url.searchParams.get('mirror') === '1';
        if (!wantMirror || !PEER_URL) {
          return sendJSON(res, 200, {
            ok: true,
            records: list,
            peer: { configured: !!PEER_URL }
          });
        }
        // 异步拉对端, 合并返回; 不去重(两台独立提交即两条 record)
        fetchPeerRecords().then((peer) => {
          const peerRecords = peer.ok ? peer.records : [];
          const merged = list.concat(peerRecords).sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0));
          sendJSON(res, 200, {
            ok: true,
            records: merged,
            peer: {
              ok: peer.ok,
              configured: true,
              count: peerRecords.length,
              latencyMs: peer.latencyMs,
              url: PEER_URL.replace(/\/\/[^/]+/, '//' + (PEER_URL.includes('@') ? '***@***' : '***')),
              error: peer.error || ''
            }
          });
        }).catch((e) => {
          sendJSON(res, 200, {
            ok: true,
            records: list,
            peer: { ok: false, configured: true, error: String(e.message || e) }
          });
        });
        return;
      }

      if (pathname === '/api/admin/peer-status' && req.method === 'GET') {
        // 仅探活/连通性, 不拉数据
        return sendJSON(res, 200, {
          ok: true,
          configured: !!PEER_URL,
          url: PEER_URL ? PEER_URL.replace(/\/\/[^/]+/, '//***') : ''
        });
      }

      if (pathname === '/api/admin/records' && req.method === 'DELETE') {
        const raw = await readBody(req);
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch (e) { body = {}; }
        const before = records.length;
        if (body.id) records = records.filter((r) => r.id !== body.id);
        saveStore();
        return sendJSON(res, 200, { ok: true, removed: before - records.length, count: records.length });
      }

      if (pathname === '/api/admin/records/clear' && req.method === 'POST') {
        const before = records.length;
        records = [];
        saveStore();
        return sendJSON(res, 200, { ok: true, removed: before, count: 0 });
      }

      if (pathname === '/api/admin/bank') {
        return sendJSON(res, 200, { ok: true, data: APCA });
      }

      return sendJSON(res, 404, { ok: false, error: '未知接口' });
    }

    /* --- 静态资源 --- */
    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res, pathname);
    }

    sendJSON(res, 405, { ok: false, error: 'Method Not Allowed' });
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: e.message || '服务器内部错误' });
  }
});

/* ---------------- 启动 ---------------- */
loadStore();
server.listen(PORT, () => {
  console.log('');
  console.log('  APCA 管理后台服务已启动');
  console.log('  ------------------------------------------');
  console.log('  测评站:   http://localhost:' + PORT + '/');
  console.log('  管理后台: http://localhost:' + PORT + '/admin');
  console.log('  记录库:   ' + DATA_FILE + '  (当前 ' + records.length + ' 条)');
  console.log('  管理员:   ' + ADMIN_USER + ' / ******');
  console.log('  ------------------------------------------');
  if (!APCA) console.log('  ⚠ 未能加载 web/data.js, 题库接口将返回空');
  console.log('');
});
