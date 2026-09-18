#!/usr/bin/env python3
# tools/build-ppt-qr-card.py
# 以二维码为中心的 PPT 单页介绍卡 (竖版 2:3, 高清 1080x1620)
# 用途: 插入 PPT 作为独立一页 / 宣讲投放页。
# 用法:
#   python tools/build-ppt-qr-card.py [输出路径]
#   python tools/build-ppt-qr-card.py --qr=产物/_qr_work_site-b.png \
#                                     --url=<内网域名>/ai-assess \
#                                     --out=产物/PPT二维码介绍页_site-b_v0.8.5.png
# 参数:
#   --qr=PATH   二维码 PNG 源(默认 web/qrcode.png, 即老公网入口)
#   --url=TEXT  卡面展示的可读地址(留空则不显示地址行)
#   --out=PATH  输出路径
#   (位置参数 [输出路径] 仍兼容)
import os, sys, re
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1620
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QR = os.path.join(ROOT, 'web', 'qrcode.png')
SHOW_URL = ''   # 卡面可读地址行, 由 --url= 覆盖

# ---- 参数解析 (--qr/--url/--out + 兼容位置参数) ----
_args = sys.argv[1:]
_pos = []
for a in _args:
    if a.startswith('--qr='):
        QR = a.split('=', 1)[1]
        if not os.path.isabs(QR):
            QR = os.path.join(ROOT, QR)
    elif a.startswith('--url='):
        SHOW_URL = a.split('=', 1)[1].strip()
    elif a.startswith('--out='):
        _pos.append(a.split('=', 1)[1])
    else:
        _pos.append(a)
CLI_OUT = _pos[0] if _pos else None

# v0.8.4: 版本号不再硬编码, 从单点真值 tools/build-web-data.js 读取, 发版无需改脚本。
def cur_version():
    try:
        with open(os.path.join(ROOT, 'tools', 'build-web-data.js'), encoding='utf-8') as f:
            m = re.search(r"questionSetVersion:\s*'([^']+)'", f.read())
            if m:
                return m.group(1)
    except Exception:
        pass
    return 'v0.8.4'

VER = cur_version()
# 输出在 产物/ 下: 这是物料件而非运行时资源, 不该进 web/ 部署目录
OUT = CLI_OUT or os.path.join(ROOT, '产物', 'PPT二维码介绍页_%s.png' % VER)
if not os.path.isabs(OUT):
    OUT = os.path.join(ROOT, OUT)

BG_TOP   = (34, 93, 224)     # 深蓝渐变顶
BG_BOT   = (12, 46, 128)     # 深蓝渐变底
INK      = (255, 255, 255)
INK_SOFT = (222, 234, 255)
ACCENT   = (130, 188, 255)
BRAND    = (30, 92, 224)

def font(sz, bold=False):
    if bold:
        cands = ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Medium.ttc',
                 '/System/Library/Fonts/Supplemental/Arial Bold.ttf']
    else:
        cands = ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Light.ttc',
                 '/System/Library/Fonts/Supplemental/Arial.ttf']
    for c in cands:
        if os.path.exists(c):
            try: return ImageFont.truetype(c, sz)
            except Exception: continue
    return ImageFont.load_default()

def ctext(d, cx, y, text, f, fill):
    tw = d.textlength(text, font=f)
    d.text((cx - tw/2, y), text, font=f, fill=fill)

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

# ---- 顶部区 (y 40..560) ----
ctext(d, W/2, 70, 'APCA', font(38, True), ACCENT)
d.line([(W/2-60, 138), (W/2+60, 138)], fill=ACCENT, width=4)
ctext(d, W/2, 180, '扫码测一测', font(88, True), INK)
ctext(d, W/2, 300, '你的 AI 办公能力段位', font(88, True), INK)
ctext(d, W/2, 440, '个人 AI 办公能力测评 · 6 维度 / 4 等级', font(32), INK_SOFT)

# ---- 白色大卡 (y 560..1360) ----
card_l, card_t = 120, 560
card_w, card_h = 840, 800
card = Image.new('RGBA', (W, H), (0,0,0,0))
cd = ImageDraw.Draw(card)
cd.rounded_rectangle([card_l, card_t, card_l+card_w, card_t+card_h], radius=44, fill=(255,255,255))
img = Image.alpha_composite(img, card)
d = ImageDraw.Draw(img)
# 卡片上沿小标签
tag = '测评入口 · 手机扫码即可'
tf = font(28, True); tw = d.textlength(tag, font=tf)
d.rounded_rectangle([W/2 - tw/2 - 30, card_t+44, W/2 + tw/2 + 30, card_t+112], radius=34, fill=BRAND)
ctext(d, W/2, card_t+58, tag, font(26, True), (255,255,255))

# 大二维码: 白卡内含二维码, 居中
# 有卡面地址行时: 二维码略缩 + 略上移, 让下方两行文字呼吸
if SHOW_URL:
    block_size = 540
    block_l = card_l + (card_w - block_size)//2      # 120 + 150 = 270
    block_t = card_t + 132                           # 692
else:
    block_size = 580
    block_l = card_l + (card_w - block_size)//2      # 120 + 130 = 250
    block_t = card_t + 130                           # 690
qr_block = Image.new('RGBA', (block_size, block_size), (0,0,0,0))
qb = ImageDraw.Draw(qr_block)
qb.rounded_rectangle([0, 0, block_size, block_size], radius=32, fill=(255,255,255))
# 二维码自带宽白边, 放大到 block 内留 34 静默边
qr_raw = Image.open(QR).convert('L')
qr_disp = block_size - 68
qr_sized = qr_raw.resize((qr_disp, qr_disp), Image.NEAREST)
qr_block.paste(qr_sized.convert('RGB'), (34, 34))
img.paste(qr_block, (block_l, block_t), qr_block)
d = ImageDraw.Draw(img)

# 卡片内二维码下方说明 (卡片 560..1360; 块底 1270; 说明行置于卡内底部 ~1305)
if SHOW_URL:
    # 有可读地址时: 地址行醒目(蓝色) + 说明行下移, 两行拉开间距
    ctext(d, W/2, 1290, SHOW_URL, font(30, True), BRAND)
    ctext(d, W/2, 1338, '约 8 分钟 · 作答完成即出报告与解读', font(24), (110, 124, 158))
else:
    ctext(d, W/2, 1305, '约 8 分钟 · 作答完成即出报告与解读', font(28), (80, 96, 140))

# ---- 卡片下方三卖点 (贴卡底之下, 底部留白 40; y ~1380..1580) ----
caps = [('6 大能力维度', 'AI沟通 / 拆解 / 流程 / 质量 / 风险 / 复用'),
        ('4 级能力段位', '从摸索到系统化进阶'),
        ('结果可分享', '雷达图 + 逐题复盘 + 海报')]
cap_top = 1410
span = 0   # 竖向内容总高, 用于辅助(可不居中, 统一从 cap_top 起排)
for i, (cap, sub) in enumerate(caps):
    x = 80 + i * 320
    # 顶层序号圈
    d.ellipse([x+118, cap_top, x+118+44, cap_top+44], fill=(255,255,255,40))
    ctext(d, x+140, cap_top+6, str(i+1), font(24, True), INK)
    ctext(d, x+140, cap_top+78, cap, font(34, True), INK)
    ctext(d, x+140, cap_top+128, sub, font(21), INK_SOFT)

img.convert('RGB').save(OUT, 'PNG')
print('✓ PPT 二维码介绍页已生成 ->', OUT, f'  ({W}x{H})')
print('  二维码源:', os.path.relpath(QR, ROOT))
if SHOW_URL:
    print('  卡面地址:', SHOW_URL)
