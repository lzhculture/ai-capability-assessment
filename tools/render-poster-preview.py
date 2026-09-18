#!/usr/bin/env python3
# tools/render-poster-preview.py
# 用 Pillow 复刻网页版下载海报(drawPosterBody)的视觉, 嵌入真实测评入口二维码,
# 生成一张可本地预览/分享的 PNG, 便于设计评审(不入线上产品代码)。
# 用法: python tools/render-poster-preview.py [输出路径]
# 说明: 这是"设计预览件", 线上实际海报由 web/app.js 实时 canvas 绘制, 本脚本仅用于给你看效果。
import os, sys, re
from PIL import Image, ImageDraw, ImageFont

W, H = 750, 1080
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QR = os.path.join(ROOT, 'web', 'qrcode.png')

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
# 输出在 产物/ 下: 这是设计预览件而非运行时资源, 不该进 web/ 部署目录
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '产物', '海报预览_%s.png' % VER)

# ---- 字体: macOS PingFang / 中易黑体 兜底 ----
def font(sz, bold=False):
    cands = []
    if bold:
        cands += [
            '/System/Library/Fonts/PingFang.ttc',
            '/System/Library/Fonts/STHeiti Medium.ttc',
            '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
        ]
    else:
        cands += [
            '/System/Library/Fonts/PingFang.ttc',
            '/System/Library/Fonts/STHeiti Light.ttc',
            '/System/Library/Fonts/Supplemental/Arial.ttf',
        ]
    for c in cands:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, sz)
            except Exception:
                continue
    return ImageFont.load_default()

def vgrad(draw, w, h, top, bottom):
    for y in range(h):
        t = y / max(h - 1, 1)
        col = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        draw.line([(0, y), (w, y)], fill=col)

def rrect(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)

def center_text(draw, cx, y, text, f, fill):
    tw = draw.textlength(text, font=f)
    draw.text((cx - tw / 2, y), text, font=f, fill=fill)

img = Image.new('RGBA', (W, H), '#1746c4')
d = ImageDraw.Draw(img)

# 背景渐变  #2f6bff -> #1746c4
vgrad(d, W, H, (47, 107, 255), (23, 70, 196))

# 装饰光斑
for (cx, cy, r, alpha) in [(W - 60, 40, 200, 40), (30, H - 80, 120, 30)]:
    ov = Image.new('RGBA', (r * 2, r * 2), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    od.ellipse([0, 0, r * 2, r * 2], fill=(255, 255, 255, alpha))
    img.paste(ov, (cx - r, cy - r), ov)

# 标题
center_text(d, W / 2, 58, '个人AI办公能力测评', font(40, True), (255, 255, 255))
center_text(d, W / 2, 108, 'APCA · ' + VER, font(22), (255, 255, 255))

# 分数卡 (半透明白卡, 用独立 overlay 再合成, 避免被实心白盖字)
card_ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
cod = ImageDraw.Draw(card_ov)
cod.rounded_rectangle([75, 165, W - 75, 365], radius=24, fill=(255, 255, 255, 36))
img = Image.alpha_composite(img, card_ov)
d = ImageDraw.Draw(img)
center_text(d, W / 2, 205, '流程模式', font(30, True), (255, 255, 255))
center_text(d, W / 2, 250, '68', font(96, True), (255, 255, 255))
center_text(d, W / 2, 330, '/ 100 · 招投标专项', font(24), (230, 240, 255))

# 六维简略刻度(视觉示意, 非真实雷达)
cx, cy = W / 2, 600
d.ellipse([cx - 150, cy - 150, cx + 150, cy + 150], outline=(200, 215, 255, 255), width=2)
d.ellipse([cx - 100, cy - 100, cx + 100, cy + 100], outline=(200, 215, 255, 255), width=1)
d.ellipse([cx - 50, cy - 50, cx + 50, cy + 50], outline=(200, 215, 255, 255), width=1)
labels = ['AI沟通', '任务拆解', '流程选择', '质量管控', '风险应对', '经验复用']
import math
pts = []
for i in range(6):
    a = math.radians(-90 + i * 60)
    sx = cx + math.cos(a) * 130
    sy = cy + math.sin(a) * 130
    d.line([(cx, cy), (sx, sy)], fill=(200, 215, 255, 255), width=1)
    # 标签
    lx = cx + math.cos(a) * 185
    ly = cy + math.sin(a) * 185
    tf = font(18)
    tw = d.textlength(labels[i], font=tf)
    d.text((lx - tw / 2, ly - 10), labels[i], font=tf, fill=(255, 255, 255))
    pts.append((sx, sy))
d.polygon(pts, fill=(31, 92, 255, 90))
d.polygon(pts, outline=(110, 160, 255, 255), width=3)

# 强弱项
d.text((75, 820), '待提升：D4 质量管控、D6 经验复用', font=font(24, True), fill=(255, 255, 255))
d.text((75, 862), '优势：D1 AI沟通、D3 流程选择', font=font(24, True), fill=(255, 255, 255))

# 二维码块 (白底 + QR)
qr = Image.open(QR).convert('RGB').resize((130, 130), Image.LANCZOS)
qx, qy, qsize = 75, 885, 150
qr_ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
qod = ImageDraw.Draw(qr_ov)
qod.rounded_rectangle([qx, qy, qx + qsize, qy + qsize], radius=16, fill=(255, 255, 255, 255))
img = Image.alpha_composite(img, qr_ov)
d = ImageDraw.Draw(img)
img.paste(qr, (qx + 10, qy + 10))

# 右侧引导文案
tx = qx + qsize + 30
d.text((tx, qy + 10), '扫码测你的 AI 段位', font=font(30, True), fill=(255, 255, 255))
d.text((tx, qy + 52), '6 维度 · 4 等级 · 约 8 分钟', font=font(20), fill=(235, 242, 255))
d.text((tx, qy + 84), VER + ' · 招投标专项 · 网页版直入', font=font(16), fill=(215, 228, 255))
d.text((tx, qy + 112), '生成于 2026-09-04', font=font(16), fill=(190, 205, 240))

img.save(OUT, 'PNG')
print('✓ 海报预览已生成 ->', OUT, '  (750x1080)')
