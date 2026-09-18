#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v0.8.1 计分锚点修正补丁:
对 12 道"解析与分值矛盾"的通用题做选项置换——把解析公认最优的行为换到 D (100 分),
最差的换到 A (0 分), 解析字母引用同步重排。纯置换, 不改任何文案内容。

置换表 (新槽位 ← 旧槽位内容):
  D2-1: A←C, B←D, C←B, D←A   (问题驱动上 D, 堆上下文下 A)
  D3-1: A←A, B←D, C←B, D←C   (风险分级上 D)
  D3-3: A←C, B←B, C←D, D←A   (准则外化上 D)
  D3-5: A←D, B←A, C←B, D←C   (可填空模板上 D, 放任下 A)
  D4-1: A←D, B←B, C←C, D←A   (决策驱动核查上 D, 表达层下 A)
  D4-2: A←C, B←B, C←D, D←A   (影响判断范围上 D, 修补式下 A)
  D4-4: A←A, B←D, C←C, D←B   (留用+披露+沉淀上 D, AI自纠降 B)
  D4-5: A←A, B←C, C←D, D←B   (风险矩阵上 D)
  D5-1: A←B, B←D, C←A, D←C   (风险点优先上 D, 表达层下 A)
  D5-4: A←A, B←B, C←D, D←C   (红线条款库上 D)
  D5-5: A←D, B←C, C←A, D←B   (体系化标识上 D, 中心化下 A)
  D6-5: A←A, B←D, C←B, D←C   (可观察标准上 D)
"""
import re, sys

CORE = 'miniprogram/data/core.js'

PATCH = {
    'D2-1': (
        {'A': 'C', 'B': 'D', 'C': 'B', 'D': 'A'},
        '“D 是‘问题驱动’, 在数据任务里是最稳的起点; C 是数据治理, 也重要但只是准备工作; B 是套路驱动; A 是堆上下文, 通常让 AI 答得更泛。”'
    ),
    'D3-1': (
        {'A': 'A', 'B': 'D', 'C': 'B', 'D': 'C'},
        '“D 是按风险/复杂度分级处理流程, 最高级; C 是分阶段, 也不错; B 是‘用详尽输入换一次成型’, 在跨部门任务里风险高; A 是‘一次成型+事后改’。”'
    ),
    'D3-3': (
        {'A': 'C', 'B': 'B', 'C': 'D', 'D': 'A'},
        '“D 是把判断准则外化, 体现系统级能力; C 是判断准则的‘个人版’, 次优; B 是流程价值的解释; A 是结果导向, 略弱。”'
    ),
    'D3-5': (
        {'A': 'D', 'B': 'A', 'C': 'B', 'D': 'C'},
        '“D 是把方法论外化为可填空模板, 最有体系; C 是陪伴式辅导, 适合 1-on-1; B 是给材料; A 是放任。”'
    ),
    'D4-1': (
        {'A': 'D', 'B': 'B', 'C': 'C', 'D': 'A'},
        '“D 是‘决策驱动核查’, 最强; C 是真值回查, 基础; B 是 AI 自检, 适合补充; A 是表达层检查, 弱。”'
    ),
    'D4-2': (
        {'A': 'C', 'B': 'B', 'C': 'D', 'D': 'A'},
        '“D 是‘基于影响判断范围’, 最强; C 是根因追溯, 适合系统性 bug; B 是经验式全面回查; A 是修补式。”'
    ),
    'D4-4': (
        {'A': 'A', 'B': 'D', 'C': 'C', 'D': 'B'},
        '“D 是‘留用+披露+沉淀’, 兼顾时效与复盘, 最高级; C 是规避, 安全但有损; B 是依赖 AI 自纠, 不靠谱; A 是带风险使用, 不可取。”'
    ),
    'D4-5': (
        {'A': 'A', 'B': 'C', 'C': 'D', 'D': 'B'},
        '“D 是风险矩阵, 体系化最强; C 是共建清单, 适合长期; B 是高频清单, 易落地; A 是通用清单, 不分风险等级。”'
    ),
    'D5-1': (
        {'A': 'B', 'B': 'D', 'C': 'A', 'D': 'C'},
        '“D 是‘风险点优先识别’, 最高级; C 是要素清单; B 是依赖 AI 自检; A 是表达层。”'
    ),
    'D5-4': (
        {'A': 'A', 'B': 'B', 'C': 'D', 'D': 'C'},
        '“D 是‘红线条款库+口径前置’, 体系化最高; C 是单点改进; B 是依赖外部复核; A 是放任。”'
    ),
    'D5-5': (
        {'A': 'D', 'B': 'C', 'C': 'A', 'D': 'B'},
        '“D 是体系化标识规则, 最高级; C 是单点规则; B 是流程兜底; A 是中心化, 不可持续。”'
    ),
    'D6-5': (
        {'A': 'A', 'B': 'D', 'C': 'B', 'D': 'C'},
        '“D 是把隐性经验显性化为‘可观察标准’, 最高级; C 是分类教学; B 是引导式; A 是给材料。”'
    ),
}

ID_RE = re.compile(r'"id":\s*"([A-Z0-9-]+)"')
OPT_RE = re.compile(r'^(\s*)"([ABCD])":\s*("(?:[^"\\]|\\.)*")(,?)\s*$')
ANA_RE = re.compile(r'^(\s*)"analysis":\s*("(?:[^"\\]|\\.)*")(,?)\s*$')

with open(CORE, encoding='utf-8') as f:
    lines = f.readlines()

out, i, patched = [], 0, set()
cur_q = None
opts_buf = {}   # 旧字母 -> (缩进, 原始值token, 行尾逗号)

def flush_question():
    """按置换表重排缓冲的选项行后输出; 非补丁题按原序输出"""
    global opts_buf
    if cur_q in PATCH and len(opts_buf) == 4:
        perm, _ = PATCH[cur_q]
        for newL in ['A', 'B', 'C', 'D']:
            indent, val, _ = opts_buf[perm[newL]]
            comma = ',' if newL != 'D' else ''   # 逗号跟新槽位走: A/B/C 带逗号, D 结尾不带
            out.append('%s"%s": %s%s\n' % (indent, newL, val, comma))
    else:
        for L in ['A', 'B', 'C', 'D']:
            if L in opts_buf:
                indent, val, comma = opts_buf[L]
                out.append('%s"%s": %s%s\n' % (indent, L, val, comma))
    opts_buf = {}

while i < len(lines):
    line = lines[i]
    m = ID_RE.search(line)
    if m:
        flush_question()
        cur_q = m.group(1)
        out.append(line)
        i += 1
        continue
    mo = OPT_RE.match(line)
    if mo and cur_q in PATCH:
        opts_buf[mo.group(2)] = (mo.group(1), mo.group(3), mo.group(4))
        i += 1
        continue
    # 任何其他行 (含 options 闭合 "},"): 先冲刷缓冲再输出
    flush_question()
    ma = ANA_RE.match(line)
    if ma and cur_q in PATCH:
        _, new_ana = PATCH[cur_q]
        out.append('%s"analysis": "%s"\n' % (ma.group(1), new_ana))
        patched.add(cur_q)
    else:
        out.append(line)
    i += 1
flush_question()

missing = set(PATCH) - patched
if missing:
    print('✗ 未完成置换的题:', sorted(missing)); sys.exit(1)

with open(CORE, 'w', encoding='utf-8') as f:
    f.writelines(out)

print('✓ 已置换 %d 题: %s' % (len(patched), ', '.join(sorted(patched))))
