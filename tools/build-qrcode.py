#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成入口二维码（海报与首页用）。

每台服务器对外地址不同，二维码不能混用，所以地址**不在本仓库内置**——
部署时按实际地址生成一份即可：

    python tools/build-qrcode.py --url=https://你的域名/assess/
    APCA_ASSESS_URL=https://你的域名/assess/ python tools/build-qrcode.py

参数:
    --url    入口地址（缺省取环境变量 APCA_ASSESS_URL，再缺省为占位串）
    --out    输出路径（默认 web/qrcode.png）

注意：入口地址要写到**子路径**那一层（如 https://域名/assess/），
只写域名根路径扫出来通常是官网首页或 404。

产物 web/qrcode.png 属于部署期物料（含本机地址），已不在版本库内。
"""
import argparse
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DEFAULT_URL = os.environ.get('APCA_ASSESS_URL', 'http://<服务器IP>:8787/')
DEFAULT_OUT = ROOT / 'web' / 'qrcode.png'


def make_qr(url: str, out_path: Path, label: str) -> None:
    import qrcode
    from PIL import Image
    qr = qrcode.QRCode(version=2, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=12, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color='black', back_color='white').convert('RGB')
    img = img.resize((580, 580), Image.LANCZOS)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, format='PNG', optimize=True)
    sz = out_path.stat().st_size / 1024
    print(f'  ✓ {label} {url} -> {out_path.relative_to(ROOT)}  ({sz:.1f} KB)')


def main():
    parser = argparse.ArgumentParser(description='APCA 入口二维码生成')
    parser.add_argument('--url', default=DEFAULT_URL,
                        help='入口地址（含子路径）；也可用环境变量 APCA_ASSESS_URL')
    parser.add_argument('--out', default=str(DEFAULT_OUT),
                        help='输出路径（默认 web/qrcode.png）')
    args = parser.parse_args()

    if '服务器IP' in args.url:
        print('  ⚠ 用的是占位地址，生成的二维码扫出来无效。'
              '请用 --url 或 APCA_ASSESS_URL 指定真实入口。')
    make_qr(args.url, Path(args.out), '入口二维码')


if __name__ == '__main__':
    main()
