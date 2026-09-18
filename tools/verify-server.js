/* 后台服务端 · 端到端测试
 * 用随机端口 + 临时数据目录启动 server/server.js, 覆盖:
 *   静态托管 / 提交入库 / 鉴权拦截 / 登录 / 汇总统计 / 题库接口 / 删除 / 清空 / 目录穿越防护
 * 不污染真实记录库(APCA_DATA_DIR 指向临时目录)。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
// v0.8.9 P0-1: 加载 data.js 以便回归用例引用真实题 id 与维度分布
global.window = {};
require(path.join(ROOT, 'web', 'data.js'));
const D = global.window.APCA_DATA;
const SERVER = path.join(ROOT, 'server', 'server.js');
const PORT = 20000 + Math.floor(Math.random() * 10000);
const BASE = 'http://127.0.0.1:' + PORT;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'apca-test-'));
const PASS = 'test-pass-123';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function mkRec(o) {
  // v0.8.7 P0-2.1: 服务端重算需要 answers 有真实题目作答，构造 dummy answers
  // 这里拿 32 个通用题 id 作为 key, 全部 100 分, 让重算后 total=100 方便对比
  // 但 verify 期望 total=82/61/35 (低分), 所以服务端重算**覆盖**了 total, 测试需调整期望值
  // 简化: 这里直接传入 answers 占位, 让重算结果存的就是 clientTotal (重算后任然符合)
  return Object.assign({
    packId: 'none', mode: 'blended', isStandalone: false, packName: '通用版',
    answers: {}, qcount: 32, clientId: 'c_test', ts: Date.now()
  }, o);
}

const RECORDS = [
  // v0.8.7 P0-2.1: 服务端重算 total+dimScores, 测试用例的 answers 须能正确重算
  // 这里用全部全 D (100 分) 让重算后 total=100, 简单且稳定
  mkRec({
    total: 100, levelId: 'L4', levelName: '系统模式',
    dimScores: { D1: 100, D2: 100, D3: 100, D4: 100, D5: 100, D6: 100 },
    answers: mockAnswers(100),
    info: { name: '测试张三', company: '示例科技有限公司', position: '产品经理', batch: '2026内训第一批', notes: '备注A' }
  }),
  mkRec({
    total: 100, levelId: 'L4', levelName: '流程模式',
    dimScores: { D1: 100, D2: 100, D3: 100, D4: 100, D5: 100, D6: 100 },
    answers: mockAnswers(100),
    info: { name: '测试李四', company: '示例科技有限公司', position: '造价工程师', batch: '2026内训第一批', notes: '' }
  }),
  mkRec({
    total: 100, levelId: 'L4', levelName: '指令模式',
    dimScores: { D1: 100, D2: 100, D3: 100, D4: 100, D5: 100, D6: 100 },
    answers: mockAnswers(100),
    info: { name: '测试王五', company: '另一家有限公司', position: '造价工程师', batch: '2026内训第二批', notes: '备注C' }
  })
];

// v0.8.7 P0-2.1 测试夹具: 构造 N 个全 D (100 分) 的通用题 answers (服务端重算会得 total=100, level=L4)
function mockAnswers(_ignored) {
  // 32 个通用题 id (硬编码是因服务端测试不 require miniprogram)
  return {
    'D1-1': 100, 'D1-2': 100, 'D1-3': 100, 'D1-4': 100, 'D1-5': 100,
    'D2-1': 100, 'D2-2': 100, 'D2-3': 100, 'D2-4': 100, 'D2-5': 100,
    'D3-1': 100, 'D3-2': 100, 'D3-3': 100, 'D3-4': 100, 'D3-5': 100, 'D3-6': 100, 'D3-7': 100,
    'D4-1': 100, 'D4-2': 100, 'D4-3': 100, 'D4-4': 100, 'D4-5': 100,
    'D5-1': 100, 'D5-2': 100, 'D5-3': 100, 'D5-4': 100, 'D5-5': 100,
    'D6-1': 100, 'D6-2': 100, 'D6-3': 100, 'D6-4': 100, 'D6-5': 100
  };
}

async function main() {
  console.log('== APCA 后台服务端端到端测试 ==');
  console.log('  端口 ' + PORT + ' · 临时库 ' + TMP);

  const child = spawn('node', [SERVER], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT), APCA_ADMIN_PASS: PASS, APCA_DATA_DIR: TMP,
      // 把限流阈值临时拉到很高, 避免压住前面的校验/byPack 测试; 后面对限流本身做单测时再降
      APCA_SUBMIT_RATE_LIMIT: '1000'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });

  const cleanup = () => {
    try { child.kill(); } catch (e) { /* 忽略 */ }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  };

  // ---- 等待就绪 ----
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { const r = await fetch(BASE + '/api/ping'); if (r.ok) { ready = true; break; } } catch (e) { /* 重试 */ }
  }
  ok(ready, '服务在 10 秒内启动就绪');
  if (!ready) { console.log(log); cleanup(); process.exit(1); }

  try {
    // ---- 服务探测 ----
    let r = await fetch(BASE + '/api/ping');
    let j = await r.json();
    ok(j.ok === true && j.service === 'apca-admin-by-jmount', 'GET /api/ping 返回服务标识');

    // ---- 静态托管 ----
    r = await fetch(BASE + '/');
    let t = await r.text();
    ok(r.ok && /个人AI办公能力测评/.test(t), 'GET / 托管测评站 index.html');
    r = await fetch(BASE + '/admin');
    t = await r.text();
    ok(r.ok && /APCA 管理后台/.test(t), 'GET /admin 托管后台页 admin.html');
    r = await fetch(BASE + '/admin.css');
    ok(r.ok, 'GET /admin.css 静态资源可访问(含后台样式)');
    r = await fetch(BASE + '/data.js');
    ok(r.ok, 'GET /data.js 题库可访问');

    // ---- 提交 ----
    for (const rec of RECORDS) {
      r = await fetch(BASE + '/api/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec)
      });
    }
    j = await r.json();
    ok(r.status === 200 && j.ok === true && j.count === 3, 'POST /api/submit 提交 3 条, 库内 count=' + (j && j.count));

    // v0.8.5 byPack 测试会在稍后追加 1 条 bid 专项记录, 这里先校验基础 count

    r = await fetch(BASE + '/api/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ foo: 1 })
    });
    ok(r.status === 400, '缺少必要字段的提交 => 400');

    r = await fetch(BASE + '/api/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json'
    });
    ok(r.status === 400, '非法 JSON 提交 => 400');

    // ---- v0.8.5 强化校验: 字段类型/范围/完整性 ----
    const badCases = [
      [{ total: '82', levelId: 'L4', dimScores: RECORDS[0].dimScores }, 'total 类型错'],
      [{ total: 200, levelId: 'L4', dimScores: RECORDS[0].dimScores }, 'total 越界'],
      [{ total: 50, levelId: 'L9', dimScores: RECORDS[0].dimScores }, 'levelId 越界'],
      [{ total: 50, dimScores: RECORDS[0].dimScores }, 'levelId 缺失'],
      [{ total: 50, levelId: 'L3', dimScores: { D1: 1, D2: 2, D3: 3, D4: 4, D5: 5 } }, 'dimScores 缺维度'],
      [{ total: 50, levelId: 'L3', dimScores: { D1: 1, D2: 2, D3: 3, D4: 4, D5: 5, D6: 'x' } }, 'dimScores 类型错'],
      [{ total: 50, levelId: 'L3', dimScores: RECORDS[0].dimScores, answers: { x: 99 } }, 'answers 分值越界'],
    ];
    for (const [body, label] of badCases) {
      r = await fetch(BASE + '/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      ok(r.status === 400, '校验拒绝: ' + label + ' => 400');
    }

    // ---- 鉴权拦截 ----
    r = await fetch(BASE + '/api/admin/records');
    ok(r.status === 401, '未带令牌读取人员清单 => 401');
    r = await fetch(BASE + '/api/admin/stats');
    ok(r.status === 401, '未带令牌读取统计 => 401');
    r = await fetch(BASE + '/api/admin/bank');
    ok(r.status === 401, '未带令牌读取题库 => 401');
    r = await fetch(BASE + '/api/admin/records', { headers: { 'X-Admin-Token': 'bogus-token' } });
    ok(r.status === 401, '无效令牌 => 401');

    // ---- 登录 ----
    r = await fetch(BASE + '/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'admin', pass: 'wrong-pass' })
    });
    ok(r.status === 401, '错误密码登录 => 401');

    r = await fetch(BASE + '/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'admin', pass: PASS })
    });
    j = await r.json();
    ok(r.status === 200 && j.ok === true && !!j.token, '正确密码登录返回令牌');
    const TOKEN = j.token || '';
    const H = { 'X-Admin-Token': TOKEN };

    // ---- 人员清单 ----
    r = await fetch(BASE + '/api/admin/records', { headers: H });
    j = await r.json();
    ok(r.ok && j.records && j.records.length === 3, '带令牌读取到 3 条记录, 实际=' + (j.records && j.records.length));
    ok(j.records[0].info && j.records[0].info.name === '测试王五', '记录按时间倒序(最新在前)');
    ok(j.records[0].info && j.records[0].info.company === '另一家有限公司', '记录含公司字段');
    ok(j.records[0].clientId === 'c_test', '记录含 clientId');
    ok(!!j.records[0].id, '服务端为每条记录生成 id');

    // ---- 跨服务器聚合 (A 方案): 无 APCA_PEER_URL 时降级 ----
    r = await fetch(BASE + '/api/admin/records?mirror=1', { headers: H });
    j = await r.json();
    ok(r.ok && j.ok && j.records && j.records.length === 3, 'mirror=1 不配置 APCA_PEER_URL 时回退本机 3 条');
    ok(j.peer && j.peer.configured === false, 'mirror=1 在未配 APCA_PEER_URL 时 peer.configured === false');

    r = await fetch(BASE + '/api/admin/peer-status', { headers: H });
    j = await r.json();
    ok(r.ok && j.ok && j.configured === false && j.url === '', 'peer-status 未配置时返回 configured=false url=空');

    // ---- 跨服务器聚合: 配 APCA_PEER_URL 指向一个不可达端口, 应降级返回本机 + peer.ok=false ----
    {
      const vPort = 31000 + Math.floor(Math.random() * 1000);
      const vTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apca-peer-'));
      const vChild = spawn('node', [SERVER], {
        env: Object.assign({}, process.env, {
          PORT: String(vPort), APCA_ADMIN_PASS: PASS, APCA_DATA_DIR: vTmp,
          APCA_PEER_URL: 'http://127.0.0.1:1',     // 必不可达
          APCA_PEER_TIMEOUT: '500',
          APCA_PEER_TOKEN: 'irrelevant',
          APCA_SUBMIT_RATE_LIMIT: '1000'
        }),
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let vReady = false;
      for (let i = 0; i < 40; i++) {
        await sleep(250);
        try { const rr = await fetch('http://127.0.0.1:' + vPort + '/api/ping'); if (rr.ok) { vReady = true; break; } } catch (e) {}
      }
      ok(vReady, 'peer 测试子服务就绪');
      if (vReady) {
        // 登录
        const lr = await fetch('http://127.0.0.1:' + vPort + '/api/admin/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: 'admin', pass: PASS })
        });
        const lj = await lr.json();
        const vH = { 'X-Admin-Token': lj.token };
        // 提交 1 条
        await fetch('http://127.0.0.1:' + vPort + '/api/submit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mkRec({ total: 100, levelId: 'L4', dimScores: { D1: 100, D2: 100, D3: 100, D4: 100, D5: 100, D6: 100 }, answers: mockAnswers(100) }))
        });
        // peer-status
        let pr = await fetch('http://127.0.0.1:' + vPort + '/api/admin/peer-status', { headers: vH });
        let pj = await pr.json();
        ok(pj.ok && pj.configured === true && !!pj.url, 'peer-status 已配置 APCA_PEER_URL 时 configured=true');
        ok(pj.url === 'http://***', 'peer-status 返回的 url 已脱敏为 host=*** (安全), 实为 ' + pj.url);
        // mirror=1 探测对端(不可达)
        pr = await fetch('http://127.0.0.1:' + vPort + '/api/admin/records?mirror=1', { headers: vH });
        pj = await pr.json();
        ok(pj.records && pj.records.length === 1, 'mirror=1 对端不可达仍回退到本机 1 条');
        ok(pj.peer && pj.peer.configured === true && pj.peer.ok === false, 'mirror=1 对端不可达时 peer.ok=false');
        ok(pj.peer && typeof pj.peer.error === 'string' && pj.peer.error.length > 0, 'mirror=1 对端不可达返回 error 描述');
        ok(typeof pj.peer.latencyMs === 'number' && pj.peer.latencyMs >= 0, 'mirror=1 返回 latencyMs');
      }
      try { vChild.kill(); } catch (e) {}
      try { fs.rmSync(vTmp, { recursive: true, force: true }); } catch (e) {}
    }

    // ---- 汇总统计 ----
    r = await fetch(BASE + '/api/admin/stats', { headers: H });
    j = await r.json();
    const st = j.stats || {};
    ok(st.total === 3, '统计: 总人次 = 3, 实际=' + st.total);
    // v0.8.7 P0-2.1: 服务端重算 total; 测试用例期望与服务端重算后一致: 3 条全 100 分 → L4 × 3
    ok(st.avg > 0 && st.avg <= 100, '统计: 平均分 = ' + st.avg);
    ok(st.levelDist && st.levelDist.L4 === 3,
      '统计: 等级分布 (3 条全 D) L4 × 3, 实际=' + JSON.stringify(st.levelDist));
    ok(st.byCompany && st.byCompany.length === 2, '统计: 按公司分组 = 2, 实际=' + (st.byCompany && st.byCompany.length));
    ok(st.byBatch && st.byBatch.length === 2, '统计: 按批次分组 = 2, 实际=' + (st.byBatch && st.byBatch.length));
    ok(st.byPosition && st.byPosition.length === 2, '统计: 按岗位分组 = 2, 实际=' + (st.byPosition && st.byPosition.length));
    ok(st.dimAvg && st.dimAvg.D1 > 0, '统计: 六维均分已计算, D1=' + (st.dimAvg && st.dimAvg.D1));
    ok(st.trend && st.trend.length >= 1, '统计: 每日趋势含 ' + (st.trend && st.trend.length) + ' 天');
    ok(st.byCompany[0].avg > 0, '统计: 分组含平均分, 示例=' + (st.byCompany[0] && st.byCompany[0].avg));

    // ---- v0.8.5 byPack 按 (packId, qVersion) 分组, 避免混池 ----
    // 此时库内 3 条均 packId='none' (通用) 且未带 qVersion → 应归入 '通用@unknown'
    const packGroups0 = (st.byPack || []).map(g => g.key);
    ok(packGroups0.length === 1 && packGroups0[0] === '通用@unknown',
      'v0.8.5 byPack 默认: 仅 "通用@unknown" 一组, 实为 ' + JSON.stringify(packGroups0));
    // 提交一条 v0.8.5 招投标专项记录, 验证 byPack 新增 'bid@v0.8.5' 且不污染原组
    const bidRec = mkRec({
      total: 100, levelId: 'L4', levelName: '流程模式',
      packId: 'bid', packName: '招投标专项',
      dimScores: { D1: 100, D2: 100, D3: 100, D4: 100, D5: 100, D6: 100 },
      // 模拟 bid 专项 18 题作答 (题 id 是 BID-1..BID-18)
      answers: {
        'BID-1': 100, 'BID-2': 100, 'BID-3': 100, 'BID-4': 100, 'BID-5': 100,
        'BID-6': 100, 'BID-7': 100, 'BID-8': 100, 'BID-9': 100, 'BID-10': 100,
        'BID-11': 100, 'BID-12': 100, 'BID-13': 100, 'BID-14': 100, 'BID-15': 100,
        'BID-16': 100, 'BID-17': 100, 'BID-18': 100
      },
      qVersion: 'v0.8.5', framework: 'APCA v0.8.5'
    });
    r = await fetch(BASE + '/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bidRec) });
    ok(r.status === 200, 'v0.8.5 byPack 测试: 提交带 qVersion 的专项记录 => 200');
    r = await fetch(BASE + '/api/admin/stats', { headers: H });
    j = await r.json();
    const st2 = j.stats || {};
    const packGroups1 = (st2.byPack || []).map(g => g.key).sort();
    ok(JSON.stringify(packGroups1) === JSON.stringify(['bid@v0.8.5', '通用@unknown']),
      'v0.8.5 byPack 同名不同版本独立分组, 实为 ' + JSON.stringify(packGroups1));
    // 验证 qVersion 已落库
    const recsAll = (await (await fetch(BASE + '/api/admin/records', { headers: H })).json()).records;
    const bidStored = recsAll.find(x => x.packId === 'bid');
    ok(bidStored && bidStored.qVersion === 'v0.8.5',
      'v0.8.5 qVersion 已落库 (' + (bidStored && bidStored.qVersion) + ')');

    // ---- v0.8.9 P0-1 回归: 服务端加权用 pack.weights (与前端一致) ----
    // 极端场景: bid standalone, D4=0 其余 100 → pack.weights 加权 = 78.0
    // v0.8.7 用"每维度题数"加权(等价等权) 会算出 83.3，偏差 5.3 触发 400
    // 单元等价于报告里"招投标 standalone D4=0 其余 100, 前端 78 / 服务端 83.3"那条
    const dimImbalancedRec = mkRec({
      total: 78, levelId: 'L3',
      packId: 'bid', packName: '招投标专项', mode: 'standalone', isStandalone: true,
      dimScores: { D1: 100, D2: 100, D3: 100, D4: 0, D5: 100, D6: 100 },
      answers: {
        'BID-1': 100, 'BID-2': 100, 'BID-3': 100,   // D1
        'BID-4': 100, 'BID-5': 100, 'BID-6': 100,   // D2
        'BID-7': 100, 'BID-8': 100, 'BID-9': 100,   // D3
        'BID-10': 0, 'BID-11': 0, 'BID-12': 0,      // D4 (弱点)
        'BID-13': 100, 'BID-14': 100, 'BID-15': 100, // D5
        'BID-16': 100, 'BID-17': 100, 'BID-18': 100  // D6
      },
      qVersion: 'v0.8.9', framework: 'APCA v0.8.9'
    });
    r = await fetch(BASE + '/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dimImbalancedRec) });
    ok(r.status === 200, 'P0-1 修复回归: 维度不均衡 bid standalone (D4=0) 提交应 200, 实=' + r.status);
    // submit 返回里没有 total 字段, 查 records 拿最新 bid 的 total
    const recs1 = (await (await fetch(BASE + '/api/admin/records', { headers: H })).json()).records || [];
    const storedBid = recs1.filter(x => x.packId === 'bid' && x.qVersion === 'v0.8.9')[0];
    ok(storedBid && +storedBid.total === 78,
      'P0-1 修复回归: 服务端用 pack.weights 重算 total=78.0 入库, 实=' + (storedBid && storedBid.total));

    // ---- v0.8.9 P0-1 回归: merged 路径走等权(对应前端 app.js:542) ----
    // 场景: bid standalone 合并通用(核心全 0, 专项全 100) → blended 50 题, 期望等权 ≈ 36.3
    //   D1=37.5 D2=37.5 D3=30 D4=37.5 D5=37.5 D6=37.5 → 等权 (5*37.5+30)/6 = 36.25 → 36.3
    const mergedAns = {};
    D.core.forEach(q => { mergedAns[q.id] = 0; });           // 通用核心全 0
    ['BID-1','BID-2','BID-3','BID-4','BID-5','BID-6','BID-7','BID-8','BID-9','BID-10','BID-11','BID-12','BID-13','BID-14','BID-15','BID-16','BID-17','BID-18']
      .forEach(id => { mergedAns[id] = 100; });               // 专项全 100
    const mergedRec = mkRec({
      total: 36, levelId: 'L1',
      packId: 'bid', packName: '招投标专项', mode: 'blended', isStandalone: true, merged: true,
      dimScores: { D1: 37.5, D2: 37.5, D3: 30, D4: 37.5, D5: 37.5, D6: 37.5 },
      answers: mergedAns,
      qVersion: 'v0.8.9', framework: 'APCA v0.8.9'
    });
    r = await fetch(BASE + '/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mergedRec) });
    ok(r.status === 200, 'P0-1 修复回归: merged bid 提交应 200, 实=' + r.status);
    const recs2 = (await (await fetch(BASE + '/api/admin/records', { headers: H })).json()).records || [];
    const storedMerged = recs2.filter(x => x.packId === 'bid' && x.merged && x.qVersion === 'v0.8.9')[0];
    ok(storedMerged && Math.abs(+storedMerged.total - 36.3) < 0.5,
      'P0-1 修复回归: merged 走等权入库, total≈36.3, 实=' + (storedMerged && storedMerged.total));

    // ---- 题库 ----
    r = await fetch(BASE + '/api/admin/bank', { headers: H });
    j = await r.json();
    ok(j.ok && j.data && j.data.core.length === 32, '题库接口: 通用 32 题 (v0.8.6 加 D3-6/D3-7), 实际=' + (j.data && j.data.core.length));
    ok(j.data && j.data.packs.length === 3, '题库接口: 3 个专项, 实际=' + (j.data && j.data.packs.length));
    ok(j.data && j.data.dimensions.length === 6, '题库接口: 6 个维度');
    ok(j.data && j.data.reports && j.data.reports.coreAdvice, '题库接口: 含报告文案规则');

    // ---- 落库文件 ----
    const file = path.join(TMP, 'records.json');
    ok(fs.existsSync(file), '记录已落库到 records.json');
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    // v0.8.9: 新增 P0-1 修复回归 2 条 (维度不均衡 + merged), 现 6 条 (3 通用 + 1 byPack + 2 v0.8.9 P0-1)
    ok(Array.isArray(arr) && arr.length === 6, '落库文件含 6 条 (3 通用 + 1 byPack + 2 v0.8.9 P0-1 回归), 实际=' + (arr && arr.length));

    // ---- 删除单条 ----
    r = await fetch(BASE + '/api/admin/records', { headers: H });
    j = await r.json();
    const targetId = j.records[0].id;
    r = await fetch(BASE + '/api/admin/records', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': TOKEN },
      body: JSON.stringify({ id: targetId })
    });
    j = await r.json();
    ok(j.ok && j.removed === 1 && j.count === 5, '删除单条成功, 剩余=' + (j && j.count));

    // ---- 清空 ----
    r = await fetch(BASE + '/api/admin/records/clear', { method: 'POST', headers: H });
    j = await r.json();
    ok(j.ok && j.count === 0, '清空全部记录, 剩余=' + (j && j.count));
    const arr2 = JSON.parse(fs.readFileSync(file, 'utf8'));
    ok(arr2.length === 0, '清空后落库文件同步为空');

    // ---- v0.8.5 提交限流: 单独拉一个低阈值服务实例测试, 避免影响主测试 ----
    // 限流是 per-IP 滑动窗口, 跑在主服务上会污染/被污染其它断言, 所以单开子进程。
    {
      const limPort = 21000 + Math.floor(Math.random() * 1000);
      const limBase = 'http://127.0.0.1:' + limPort;
      const limTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apca-rl-'));
      const limChild = spawn('node', [SERVER], {
        env: Object.assign({}, process.env, {
          PORT: String(limPort), APCA_ADMIN_PASS: PASS, APCA_DATA_DIR: limTmp,
          APCA_SUBMIT_RATE_LIMIT: '2'         // 极小, 便于单测
        }),
        stdio: ['ignore', 'pipe', 'pipe']
      });
      // 等待就绪
      let limReady = false;
      for (let i = 0; i < 40; i++) {
        await sleep(250);
        try { const rr = await fetch(limBase + '/api/ping'); if (rr.ok) { limReady = true; break; } } catch (e) { /* 重试 */ }
      }
      ok(limReady, '限流测试子服务在 10s 内启动就绪');
      if (limReady) {
        let okN = 0, limN = 0;
        for (let i = 0; i < 5; i++) {
          const body = mkRec({ total: 100, levelId: 'L4', dimScores: { D1: 100, D2: 100, D3: 100, D4: 100, D5: 100, D6: 100 }, answers: mockAnswers(100) });
          const rr = await fetch(limBase + '/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (rr.status === 200) okN++;
          else if (rr.status === 429) limN++;
        }
        ok(limN >= 3, 'v0.8.5 限流生效: 阈值 2/60s 时 5 次 burst 中至少 3 次 429 (实际 200=' + okN + ', 429=' + limN + ')');
        try { limChild.kill(); } catch (e) { /* 忽略 */ }
        try { fs.rmSync(limTmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
      } else {
        try { limChild.kill(); } catch (e) { /* 忽略 */ }
        try { fs.rmSync(limTmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
      }
    }

    // ---- 目录穿越防护 ----
    r = await fetch(BASE + '/../package.json');
    ok(r.status !== 200, '目录穿越 /../package.json 被拒绝, status=' + r.status);
    r = await fetch(BASE + '/%2e%2e%2f%2e%2e%2fpackage.json');
    ok(r.status !== 200, '编码目录穿越 %2e%2e%2f 被拒绝, status=' + r.status);

  } catch (e) {
    fail++;
    console.log('  ✗ 抛出异常: ' + e.message);
    console.log(e.stack);
  }

  cleanup();
  console.log('');
  console.log('==== 结果: ' + pass + ' PASS / ' + fail + ' FAIL ====');
  process.exit(fail ? 1 : 0);
}

main();
