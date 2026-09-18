#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成随部署实例分发的 LICENSE 副本 + 同步 web/data.js 的部署登记字段。

每台服务器的部署登记信息（站点名、对外域名）不同，**本仓库不内置任何真实域名**，
部署时由命令行或环境变量传入：

    python tools/build-license.py --server=站点名 --domain=你的域名 --name=显示名
    APCA_LICENSE_DOMAIN=你的域名 python tools/build-license.py

不传域名时按占位值渲染（仅供本地预览，不要拿去部署）。

产物:
- web/LICENSE (按域名重渲染；该文件属部署期物料，不在版本库内)
- web/data.js: meta.licenseNote / meta.authorizedDomain 同步覆盖
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 仓库内不保存任何真实域名/站点名；缺省值只是占位
PLACEHOLDER_DOMAIN = 'example.com'


def resolve_cfg(args):
    domain = args.domain or os.environ.get('APCA_LICENSE_DOMAIN', PLACEHOLDER_DOMAIN)
    server = args.server or os.environ.get('APCA_SERVER', 'default')
    name = args.name or os.environ.get('APCA_LICENSE_NAME', f'部署实例 ({server})')
    return {'name': name, 'domain': domain, 'short': server}


def read_version():
    p = os.path.join(ROOT, 'tools', 'build-web-data.js')
    with open(p, 'r', encoding='utf-8') as f:
        src = f.read()
    m = re.search(r"framework:\s*['\"]([^'\"]*)['\"]", src)
    return m.group(1) if m else 'unknown'


def render(template, mapping):
    out = template
    for k, v in mapping.items():
        out = out.replace('{{' + k + '}}', v)
    return out


def patch_data_js_meta(server, domain, version):
    """把 data.js 里的 licenseNote / 新加 authorizedDomain 同步覆盖"""
    p = os.path.join(ROOT, 'web', 'data.js')
    if not os.path.exists(p):
        print(f'  skip: {p} not found (run node tools/build-web-data.js first)')
        return
    with open(p, 'r', encoding='utf-8') as f:
        src = f.read()
    note = f'部署于 {domain}（{server}）。协议见同目录 LICENSE。'
    # 替换 licenseNote 字段 (data.js meta 是 JSON 风格: "licenseNote": "...")
    src = re.sub(
        r'"licenseNote"\s*:\s*"[^"]*"',
        f'"licenseNote": "{note}"',
        src, count=1
    )
    # 替换/添加 authorizedDomain 字段 (JSON 风格)
    if '"authorizedDomain"' in src:
        src = re.sub(
            r'"authorizedDomain"\s*:\s*"[^"]*"',
            f'"authorizedDomain": "{domain}"',
            src, count=1
        )
    else:
        # 在 generatedAt 后插入 (若没该字段则插到 framework 后)
        if '"generatedAt"' in src:
            src = re.sub(
                r'("authorizedDomain"\s*:\s*"",)', f'\\1\n      "authorizedDomain": "{domain}",' if False else src,
                src, count=1
            )
            # 简化方案: 直接覆盖空字符串
            src = src.replace(
                '"authorizedDomain": ""',
                f'"authorizedDomain": "{domain}"',
                1
            )
    with open(p, 'w', encoding='utf-8') as f:
        f.write(src)
    print(f'OK: updated meta in web/data.js (licenseNote + authorizedDomain)')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--server', default=None,
                    help='站点标识（自由字符串，默认 default）')
    ap.add_argument('--domain', default=None,
                    help='对外域名（也可用环境变量 APCA_LICENSE_DOMAIN）')
    ap.add_argument('--name', default=None,
                    help='部署位置显示名（也可用环境变量 APCA_LICENSE_NAME）')
    ap.add_argument('--out', default=None,
                    help='输出路径（默认 web/LICENSE）')
    ap.add_argument('--skip-data', action='store_true',
                    help='不更新 web/data.js (只生成 LICENSE)')
    args = ap.parse_args()
    cfg = resolve_cfg(args)
    if cfg['domain'] == PLACEHOLDER_DOMAIN:
        print('  ⚠ 未指定域名，按占位值渲染（仅供本地预览，勿用于部署）。')
    tpl_path = os.path.join(ROOT, 'LICENSE.template')
    with open(tpl_path, 'r', encoding='utf-8') as f:
        tpl = f.read()
    mapping = {
        'SERVER_NAME': cfg['name'],
        'AUTHORIZED_DOMAIN': cfg['domain'],
        'VERSION': read_version(),
    }
    out_license = render(tpl, mapping)
    out_path = args.out or os.path.join(ROOT, 'web', 'LICENSE')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(out_license)
    print(f'OK: write {out_path}')
    print(f'  server={args.server} domain={cfg["domain"]} version={mapping["VERSION"]}')
    if not args.skip_data:
        patch_data_js_meta(args.server, cfg['domain'], mapping['VERSION'])


if __name__ == '__main__':
    main()
