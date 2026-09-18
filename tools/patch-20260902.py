#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""补丁: 2026-09-02 剩余改动落盘 (改名 + 单独成卷合并出分)
对 app.js / index.html 做精确字符串替换, 逐项报告成功/失败。"""
import io, sys

BASE = '/Users/jmount/WorkBuddy/2026-09-02-11-38-04/ai-capability-assessment/web/'
ok, fail = [], []

def patch(path, pairs):
    p = BASE + path
    with io.open(p, 'r', encoding='utf-8') as f:
        s = f.read()
    for i, (old, new) in enumerate(pairs):
        if new in s and old not in s:
            ok.append('%s#%d (已生效,跳过)' % (path, i + 1))
        elif old not in s:
            fail.append('%s#%d 未找到目标串!' % (path, i + 1))
        elif s.count(old) != 1:
            fail.append('%s#%d 目标串出现 %d 次,不唯一!' % (path, i + 1, s.count(old)))
        else:
            s = s.replace(old, new, 1)
            ok.append('%s#%d' % (path, i + 1))
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(s)

# ---------------- index.html ----------------
patch('index.html', [
    # 1. title
    ('<title>个人AI能力评测 · APCA</title>',
     '<title>个人AI办公能力测评 · APCA</title>'),
    # 2. description meta
    ('content="通用个人 AI 能力测评：6 维度 + 4 级能力模型',
     'content="通用个人 AI 办公能力测评：6 维度 + 4 级能力模型'),
    # 3. appbar 标题
    ('id="appbarTitle" data-page-node-id="cv8FashCBt18b8SmNh1ezb">个人AI能力评测</div>',
     'id="appbarTitle" data-page-node-id="cv8FashCBt18b8SmNh1ezb">个人AI办公能力测评</div>'),
    # 4. hero 标题
    ('class="hero-title" data-page-node-id="rbU5WNe5vghk81pFRfzKdj">个人AI能力评测</h1>',
     'class="hero-title" data-page-node-id="rbU5WNe5vghk81pFRfzKdj">个人AI办公能力测评</h1>'),
    # 5. 单独成卷默认文案 (JS 会按是否有通用记录动态覆盖)
    ('id="modeStandaloneDesc" data-page-node-id="JipENCF3jHhLZ9riz467VH">只做本专项 N 题</i>',
     'id="modeStandaloneDesc" data-page-node-id="JipENCF3jHhLZ9riz467VH">只做本专项 N 题（需先完成通用测评）</i>'),
])

# ---------------- app.js ----------------
patch('app.js', [
    # 1. 文件头注释
    ('/* ===== 个人AI能力评测 · 网站版逻辑层 (APCA Web) =====',
     '/* ===== 个人AI办公能力测评 · 网站版逻辑层 (APCA Web) ====='),
    # 2. submit(): 单独成卷与最近通用记录合并出分
    ("""      clientId: getClientId(),
      ts: Date.now()
    };
    saveHistory(record);""",
     """      clientId: getClientId(),
      ts: Date.now()
    };
    // 单独成卷: 与最近一次含通用 30 题作答的记录合并, 按 blended 同口径重新出分
    if (record.isStandalone) {
      var g = findGeneralRecord();
      if (g && g.answers) {
        var coreIds = {};
        D.core.forEach(function (q) { coreIds[q.id] = 1; });
        var mergedAnswers = {};
        Object.keys(g.answers).forEach(function (qid) { if (coreIds[qid]) mergedAnswers[qid] = g.answers[qid]; });
        Object.keys(state.answers).forEach(function (qid) { mergedAnswers[qid] = state.answers[qid]; });
        var bq = buildQuestions(state.packId, 'blended');
        var mres = calcResult(bq, mergedAnswers, null);
        record.merged = true;
        record.mergedFromTs = g.ts || null;
        record.mergedFromPack = g.packName || '通用版';
        record.standaloneTotal = res.total;
        record.standaloneLevelId = res.level.id;
        record.standaloneLevelName = res.level.name;
        record.answers = mergedAnswers;
        record.total = mres.total;
        record.levelId = mres.level.id;
        record.levelName = mres.level.name;
        record.dimScores = mres.dimScores;
        record.qcount = bq.length;
      }
    }
    saveHistory(record);"""),
    # 3. renderResult 等级卡: 合并展示 + 专项单独得分提示
    ("""      '<div class="level-pack">' + esc(record.packName) + (record.isStandalone ? ' · 单独成卷' : '') + '</div>' +""",
     """      '<div class="level-pack">' + esc(record.packName) +
        (record.isStandalone ? (record.merged ? ' · 单独成卷 · 已合并通用测评' : ' · 单独成卷') : '') + '</div>' +
      (record.isStandalone && record.merged ?
        '<div class="level-merge-note">本卷已与你 ' + esc(dateStrOf(record.mergedFromTs)) + ' 的「' + esc(record.mergedFromPack || '通用版') +
        '」记录合并出分（通用 30 题 + 本专项）。专项单独得分：' + (record.standaloneTotal != null ? record.standaloneTotal : '—') +
        ' 分' + (record.standaloneLevelId ? '（' + esc(record.standaloneLevelId) + ' ' + esc(record.standaloneLevelName || '') + '）' : '') + '</div>' : '') +"""),
    # 4. dateStrOf 辅助函数 (挂在 levelSub 之后)
    ("""  function levelSub(id) {
    var l = D.levels.find(function (x) { return x.id === id; });
    return l ? l.subtitle : '';
  }""",
     """  function levelSub(id) {
    var l = D.levels.find(function (x) { return x.id === id; });
    return l ? l.subtitle : '';
  }
  function dateStrOf(ts) {
    if (!ts) return '之前';
    var d = new Date(Number(ts));
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }"""),
    # 5. buildShareURL: 携带 merged 系列字段
    ("""      levelName: record.levelName, dimScores: record.dimScores, answers: record.answers,
      qcount: record.qcount, ts: record.ts
    };
    return location.href.split('#')[0] + '#r=' + b64encodeUnicode(JSON.stringify(payload));""",
     """      levelName: record.levelName, dimScores: record.dimScores, answers: record.answers,
      qcount: record.qcount, ts: record.ts,
      merged: record.merged || false, mergedFromTs: record.mergedFromTs || null,
      mergedFromPack: record.mergedFromPack || '', standaloneTotal: record.standaloneTotal,
      standaloneLevelId: record.standaloneLevelId || '', standaloneLevelName: record.standaloneLevelName || ''
    };
    return location.href.split('#')[0] + '#r=' + b64encodeUnicode(JSON.stringify(payload));"""),
    # 6. buildTextSummary: 改名 + 合并说明行
    ("""    lines.push('【个人AI能力评测 · ' + D.meta.framework + '】');
    lines.push('综合得分：' + record.total + ' / 100 · 等级：' + record.levelId + ' ' + record.levelName);
    lines.push('测评卷：' + record.packName + (record.isStandalone ? '（单独成卷）' : ''));""",
     """    lines.push('【个人AI办公能力测评 · ' + D.meta.framework + '】');
    lines.push('综合得分：' + record.total + ' / 100 · 等级：' + record.levelId + ' ' + record.levelName);
    lines.push('测评卷：' + record.packName +
      (record.isStandalone ? (record.merged ? '（单独成卷 · 已合并通用测评出分）' : '（单独成卷）') : ''));
    if (record.isStandalone && record.merged) {
      lines.push('已与 ' + dateStrOf(record.mergedFromTs) + ' 的「' + (record.mergedFromPack || '通用版') +
        '」记录合并出分；专项单独得分：' + (record.standaloneTotal != null ? record.standaloneTotal : '—') +
        ' 分' + (record.standaloneLevelId ? '（' + record.standaloneLevelId + ' ' + (record.standaloneLevelName || '') + '）' : ''));
    }"""),
    # 7. 文字摘要页脚改名
    ("""    lines.push('—— 由「个人AI能力评测」生成，数据仅保存在本机浏览器 ——');""",
     """    lines.push('—— 由「个人AI办公能力测评」生成，数据仅保存在本机浏览器 ——');"""),
    # 8. 海报标题改名
    ("""    ctx.fillText('个人AI能力评测', W / 2, 90);""",
     """    ctx.fillText('个人AI办公能力测评', W / 2, 90);"""),
    # 9. 海报下载文件名
    ("""      a.href = url; a.download = 'AI能力测评_' + record.total + '分.png';""",
     """      a.href = url; a.download = 'AI办公能力测评_' + record.total + '分.png';"""),
    # 10. tryLoadShared: 重建 merged 系列字段
    ("""        levelId: payload.levelId, levelName: payload.levelName, dimScores: payload.dimScores,
        qcount: payload.qcount, ts: payload.ts
      }, { shared: true });""",
     """        levelId: payload.levelId, levelName: payload.levelName, dimScores: payload.dimScores,
        qcount: payload.qcount, ts: payload.ts,
        merged: payload.merged || false, mergedFromTs: payload.mergedFromTs || null,
        mergedFromPack: payload.mergedFromPack || '', standaloneTotal: payload.standaloneTotal,
        standaloneLevelId: payload.standaloneLevelId || '', standaloneLevelName: payload.standaloneLevelName || ''
      }, { shared: true });"""),
])

print('=== OK (%d) ===' % len(ok))
for x in ok: print(' ', x)
if fail:
    print('=== FAIL (%d) ===' % len(fail))
    for x in fail: print(' ', x)
    sys.exit(1)
print('全部落盘成功')
