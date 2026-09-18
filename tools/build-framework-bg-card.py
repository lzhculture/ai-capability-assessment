#!/usr/bin/env python3
# tools/build-framework-bg-card.py
# 「指标体系背景介绍」竖版图 (1080x1620, 与 PPT 介绍卡同视觉)
# 用途: 群里发二维码介绍图后紧跟一张, 让同事一眼看到"指标体系参考了什么"
# 用法: python tools/build-framework-bg-card.py [输出路径]
import os, sys
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1620
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '产物', '背景介绍卡_v0.8.5_20260911.png')

# 沿用 PPT 卡视觉
BG_TOP   = (34, 93, 224)
BG_BOT   = (12, 46, 128)
INK      = (255, 255, 255)
INK_SOFT = (222, 234, 255)
ACCENT   = (130, 188, 255)
BRAND    = (30, 92, 224)
CARD_BG  = (255, 255, 255)
INK_DARK = (28, 38, 72)
INK_GREY = (90, 108, 144)

def font(sz, bold=False):
    cands = (['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Medium.ttc',
              '/System/Library/Fonts/Supplemental/Arial Bold.ttf'] if bold else
             ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Light.ttc',
              '/System/Library/Fonts/Supplemental/Arial.ttf'])
    for c in cands:
        if os.path.exists(c):
            try: return ImageFont.truetype(c, sz)
            except Exception: continue
    return ImageFont.load_default()

def ctext(d, cx, y, text, f, fill):
    tw = d.textlength(text, font=f)
    d.text((cx - tw/2, y), text, font=f, fill=fill)

def ltext(d, x, y, text, f, fill):
    """左对齐"""
    d.text((x, y), text, font=f, fill=fill)

def wrap_text(d, text, f, max_w):
    """按像素宽度折行（中文逐字, 英文按空格）"""
    lines, cur = [], ''
    for ch in text:
        if d.textlength(cur + ch, font=f) <= max_w:
            cur += ch
        else:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines

def ltext_wrapped(d, x, y, text, f, fill, max_w, line_h):
    """左对齐 + 自动折行, 返回结束 y"""
    for i, ln in enumerate(wrap_text(d, text, f, max_w)):
        d.text((x, y + i * line_h), ln, font=f, fill=fill)
    return y + len(wrap_text(d, text, f, max_w)) * line_h

# ---- 底图 ----
img = Image.new('RGBA', (W, H), BG_TOP)
d = ImageDraw.Draw(img)
for y in range(H):
    t = y / H
    d.line([(0, y), (W, y)], fill=tuple(int(BG_TOP[i]+(BG_BOT[i]-BG_TOP[i])*t) for i in range(3)))
# 光斑
for cx, cy, r, a in [(W-140, 60, 340, 26), (40, H-120, 300, 20)]:
    ov = Image.new('RGBA', (r*2, r*2), (0,0,0,0)); od = ImageDraw.Draw(ov)
    od.ellipse([0,0,r*2,r*2], fill=(255,255,255,a))
    img.paste(ov, (cx-r, cy-r), ov)
d = ImageDraw.Draw(img)

# ---- 顶部 ----
ctext(d, W/2, 70, 'APCA', font(38, True), ACCENT)
d.line([(W/2-60, 138), (W/2+60, 138)], fill=ACCENT, width=4)
ctext(d, W/2, 180, '指标体系背景', font(86, True), INK)
ctext(d, W/2, 290, '个人 AI 办公能力测评 · 框架参照与本土化适配', font(28), INK_SOFT)
ctext(d, W/2, 340, 'International Frameworks → China Workplace Adaptation', font(22), INK_SOFT)

# ---- 大白卡: 先量内容高度, 再画卡（内容自适应, 不留大空白）----
card_l = 60
card_w = 960
CARD_PAD_TOP, CARD_PAD_BOT = 56, 56

# ---- 卡内: 三家权威框架介绍 ----
frameworks = [
    {
        'org': 'UNESCO',
        'name': '《AI 能力框架》',
        'year': '2024 年 9 月 · 数字学习周发布',
        'what': '把「人如何与 AI 相处」拆成 5 大能力域：',
        'pillars': ['以人为中心的态度', 'AI 基础与应用', 'AI 伦理', 'AI 与教学融合', 'AI 支持专业发展'],
        'tie': '→ 我们的 4 级段位，参考了其「获取 → 深化 → 创造」的进阶分级思路',
    },
    {
        'org': 'Microsoft',
        'name': 'AI Literacy Framework',
        'year': '微软 AI 素养框架 · 4 域模型',
        'what': '关注「什么场景介入 AI、怎么评估 AI 输出、谁负责」：',
        'pillars': ['Engage（参与）', 'Create（创作）', 'Manage（管理）', 'Design（设计）'],
        'tie': '→ 我们的 D4 质量管控 / D5 风险应对，在设计思路上参考了 Manage 域关注的问题。',
    },
    {
        'org': 'IBM',
        'name': 'AI Skills',
        'year': 'IBM SkillsBuild 认证体系',
        'what': '强调把 AI 用进日常业务流程的具体能力：',
        'pillars': ['提示词工程', '输出验证', '流程嵌入'],
        'tie': '→ 我们的 D1 AI 沟通 / D2 任务拆解 / D3 流程选择，题型设计参考了这三个方向。',
    },
] 

# ---- 布局度量（在临时 draw 上算高度, 不落笔）----
probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))
F_TAG, F_NAME, F_YEAR = font(26, True), font(28, True), font(20)
F_WHAT, F_PILL, F_TIE, F_FOOT = font(24), font(22), font(22), font(22, True)
INNER_W = card_w - 110

def block_height(fw):
    """单个框架块的内容高度"""
    h = 96                                            # 色块头
    h += len(wrap_text(probe, fw['what'], F_WHAT, INNER_W)) * 36 + 10
    left_n = (len(fw['pillars']) + 1) // 2
    h += left_n * 38 + 14
    h += len(wrap_text(probe, fw['tie'], F_TIE, INNER_W)) * 34 + 22
    h += 20                                            # 分隔 + 间距
    return h

content_h = sum(block_height(fw) for fw in frameworks)
FOOT_H = 88
card_h = CARD_PAD_TOP + content_h + FOOT_H + CARD_PAD_BOT
card_t = 410
# 卡不越界（底部留 70 给卡外小字）
if card_t + card_h > H - 70:
    card_t = max(380, H - 70 - card_h)

# ---- 画大白卡 ----
card = Image.new('RGBA', (W, H), (0,0,0,0))
cd = ImageDraw.Draw(card)
cd.rounded_rectangle([card_l, card_t, card_l+card_w, card_t+card_h], radius=44, fill=CARD_BG)
img = Image.alpha_composite(img, card)
d = ImageDraw.Draw(img)

# ---- 卡内: 三家权威框架介绍 ----
fy = card_t + CARD_PAD_TOP
for fw in frameworks:
    tag_y = fy
    d.rectangle([card_l+40, tag_y, card_l+200, tag_y+50], fill=BRAND)
    ctext(d, card_l+120, tag_y+10, fw['org'], F_TAG, CARD_BG)
    ltext(d, card_l+220, tag_y+12, fw['name'], F_NAME, INK_DARK)
    ltext(d, card_l+220, tag_y+54, fw['year'], F_YEAR, INK_GREY)
    fy += 96

    fy = ltext_wrapped(d, card_l+40, fy, fw['what'], F_WHAT, INK_DARK, INNER_W, 36) + 10

    pillars = fw['pillars']
    left_n = (len(pillars) + 1) // 2
    col_x = [card_l+60, card_l+540]
    for i, p in enumerate(pillars):
        if i < left_n:
            x, row = col_x[0], i
        else:
            x, row = col_x[1], i - left_n
        y = fy + row * 38
        d.ellipse([x-6, y+10, x+6, y+22], fill=BRAND)
        ltext(d, x+14, y, p, F_PILL, INK_DARK)
    fy += left_n * 38 + 14

    fy = ltext_wrapped(d, card_l+40, fy, fw['tie'], F_TIE, (180, 56, 56), INNER_W, 34) + 22
    d.line([(card_l+40, fy), (card_l+card_w-40, fy)], fill=(220, 230, 250), width=2)
    fy += 20

# ---- 卡底: 落地说明 ----
d.rectangle([card_l+30, fy, card_l+card_w-30, fy+FOOT_H], fill=(245, 248, 255))
ctext(d, W/2, fy+6, '所有题目均为面向中国职场原创 · 维度划分参照三大框架的组织逻辑', F_FOOT, INK_DARK)
ctext(d, W/2, fy+36, '属框架参考，非 UNESCO / 微软 / IBM 官方认证或背书', font(19), (150, 100, 60))

# ---- 卡外: 底部一行小字 ----
# 卡面地址不内置，由 APCA_CARD_URL 传入（不设则不显示地址行）
CARD_URL = os.environ.get('APCA_CARD_URL', '').strip()
if CARD_URL:
    ctext(d, W/2, H-50, '扫码体验 → ' + CARD_URL + ' · by jmount', font(20), INK_SOFT)

img.convert('RGB').save(OUT, 'PNG')
print('✓ 背景介绍卡已生成 ->', OUT, f'  ({W}x{H}, 卡高 {card_h})')