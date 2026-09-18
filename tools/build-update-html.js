// tools/build-update-html.js
//
// 从 系统更新日志.md 渲染成自包含的 系统更新日志.html。
// 不引入任何 npm 依赖——项目是零依赖设计——只用 fs + 正则做最小化 Markdown 解析。
//
// 用法: node tools/build-update-html.js
// 输出: 系统更新日志.html（与 md 同级，便于浏览器直接打开或线上挂载）
//
// 设计要点：
//   1) 完全自包含：CSS 内嵌在 <style>，无外部资源，离线可读；
//   2) 与 md 单向绑定：每次发版前先跑一次，确保 HTML 跟 md 同步；
//   3) verify-web.js §1.7 会同时校验两个文件存在 + HTML 仍含当前版本号；
//   4) 解析范围覆盖本日志实际用到的 H1/H2/H3/H4 + 列表 + blockquote + code +
//      hr + 段落 + 加粗 + 行内 code；不够用时加正则即可。

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, '系统更新日志.md');
const DST = path.join(ROOT, '系统更新日志.html');
// v0.8.9 P1-1: 同时输出脱敏版到 web/ (随 rsync --delete 一起部署, 避免手工 scp 遗漏;
//   且 rsync 不会再因线上有而本地没有而误删)
const DST_WEB = path.join(ROOT, 'web', '系统更新日志.html');

if (!fs.existsSync(SRC)) {
  console.error('× 系统更新日志.md 不存在，无法生成 HTML');
  process.exit(1);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// v0.8.9 P1-1: 公网 HTML 脱敏(仅 HTML 输出时生效, 源 md 保留技术细节)
//   - 仓库内 md 是开发者文档, IP/脚本名是有效信息
//   - HTML 部署到公网 web 根目录, 必须屏蔽内网拓扑与部署脚本名
//   - 顺序很重要: 先匹配带具体后缀的(端口/路径), 再匹配裸 IP, 避免部分匹配
function sanitize(md) {
  let s = md;
  // SSH 用户前缀(必须先于裸 IP 替换, 否则 122.51.27.111 已被换掉, 前缀匹配失败)
  s = s.replace(/(ubuntu|root)@(122\.51\.27\.111|124\.160\.40\.164|172\.16\.200\.151)/g, '<SSH_TARGET>');
  // 内网/服务器 IP + 端口
  s = s.replace(/122\.51\.27\.111:8787/g, '老服务器');
  s = s.replace(/122\.51\.27\.111/g, '老服务器');
  s = s.replace(/124\.160\.40\.164/g, '另一台服务器');
  s = s.replace(/172\.16\.200\.151:8787/g, '另一台服务器');
  s = s.replace(/172\.16\.200\.151/g, '另一台服务器');
  // 兜底：其余 172.16/12 私网地址（防后续误写内网 IP 直接上公网）
  s = s.replace(/172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}/g, '内网服务器');
  // 部署路径与备份目录（避免暴露内网目录结构）
  s = s.replace(/\/home\/apca_backup_[0-9_]+/g, '备份目录');
  s = s.replace(/\/home\/apca/g, '部署目录');
  // 还原 SSH 用户前缀为泛称
  s = s.replace(/<SSH_TARGET>/g, '目标服务器');
  // 部署/同步脚本名
  s = s.replace(/tools\/deploy-[a-z]+\.sh/g, '部署脚本');
  s = s.replace(/tools\/sync-to-github\.sh/g, 'GitHub 同步脚本');
  // systemd 服务名 + 重启命令
  s = s.replace(/systemctl restart apca\.service/g, '重启测评服务');
  s = s.replace(/apca\.service/g, '测评服务');
  return s;
}

// 转义后再做极简 inline 解析：加粗、行内 code、em
function inline(s) {
  let out = escapeHtml(s);
  // 行内代码先做（避免被其它规则干扰反引号内的星号）
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 加粗：**...**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 斜体：*...*（不会被上面吃掉，因为内层无星号了）
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const html = [];
  let listType = null;  // 'ul' | 'ol' | null
  let inCode = false;
  let codeLang = '';
  let codeBuf = [];

  const closeList = () => {
    if (listType) { html.push(`</${listType}>`); listType = null; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块 ``` ``` 围栏
    if (!inCode && /^```/.test(line)) {
      closeList();
      inCode = true;
      codeLang = line.replace(/^```\s*/, '').trim();
      codeBuf = [];
      continue;
    }
    if (inCode && /^```\s*$/.test(line)) {
      html.push(`<pre><code class="lang-${escapeHtml(codeLang)}">${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
      inCode = false;
      codeBuf = [];
      codeLang = '';
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    // 空行 = 段落分隔
    if (line.trim() === '') { closeList(); continue; }

    // 水平线
    if (/^-{3,}\s*$/.test(line) || /^\*{3,}\s*$/.test(line)) {
      closeList();
      html.push('<hr/>');
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.+?)\s*$/);
    if (h) {
      closeList();
      const lv = h[1].length;
      const text = inline(h[2]);
      const id = h[2]
        .toLowerCase()
        .replace(/[\[\]\(\)`*_~!]/g, '')
        .replace(/[^\w\u4e00-\u9fff\- ]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 64);
      html.push(`<h${lv} id="${id}">${text}${lv >= 2 ? `<a class="anchor" href="#${id}">#</a>` : ''}</h${lv}>`);
      continue;
    }

    // 引用块
    if (/^>\s?/.test(line)) {
      closeList();
      html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    // 无序列表
    const ul = line.match(/^[\s]*[-*+]\s+(.+)$/);
    if (ul) {
      if (listType !== 'ul') { closeList(); html.push('<ul>'); listType = 'ul'; }
      html.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    // 有序列表
    const ol = line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (ol) {
      if (listType !== 'ol') { closeList(); html.push('<ol>'); listType = 'ol'; }
      html.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    // 普通段落（向后看，若下一行仍是普通文本则合并；这里先单行处理，浏览器会自动包段落）
    closeList();
    html.push(`<p>${inline(line)}</p>`);
  }

  closeList();
  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  }
  return html.join('\n');
}

const md = fs.readFileSync(SRC, 'utf8');
const sanitizedMd = sanitize(md);
const bodyHtml = mdToHtml(sanitizedMd);

// 自包含样式：清爽浅色 + 左侧 anchor + 醒目标题 + 代码块
const style = `
:root { --fg:#1f2a44; --muted:#64748b; --brand:#1f5cff; --code-bg:#f1f4fa; --quote-bg:#f5f8ff; --hr:#e6ebf5; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 48px 20px 80px;
  background: #f4f6fb;
  color: var(--fg);
  font-family: -apple-system, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif;
  font-size: 15px; line-height: 1.75;
}
.wrap { max-width: 920px; margin: 0 auto; background: #fff; border-radius: 16px;
  box-shadow: 0 6px 32px rgba(20,40,90,0.08); padding: 40px 56px; }
h1 { font-size: 28px; margin: 0 0 8px; line-height: 1.3; }
h2 { font-size: 21px; margin: 36px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--hr); line-height: 1.3; }
h3 { font-size: 17px; margin: 24px 0 10px; color: var(--brand); line-height: 1.3; }
h4 { font-size: 15px; margin: 18px 0 8px; color: var(--muted); }
h1, h2, h3, h4 { position: relative; }
.anchor { position: absolute; left: -1.4em; top: 0; opacity: 0; transition: opacity .15s;
  color: var(--brand); text-decoration: none; font-weight: 400; }
h1:hover .anchor, h2:hover .anchor, h3:hover .anchor, h4:hover .anchor { opacity: 1; }
p { margin: 10px 0; }
ul, ol { padding-left: 1.6em; margin: 10px 0; }
li { margin: 4px 0; }
blockquote { margin: 14px 0; padding: 10px 16px; border-left: 4px solid var(--brand);
  background: var(--quote-bg); border-radius: 0 8px 8px 0; color: var(--muted); }
hr { border: 0; height: 1px; background: var(--hr); margin: 28px 0; }
code { background: var(--code-bg); padding: 1px 6px; border-radius: 4px; font-size: 13px; color: var(--brand); }
pre { background: var(--code-bg); padding: 14px 16px; border-radius: 8px; overflow: auto; margin: 14px 0; }
pre code { background: transparent; padding: 0; color: var(--fg); font-size: 13px; }
strong { color: var(--fg); font-weight: 700; }
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
.meta { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
.toc { background: #fafbff; border: 1px solid #e3e8f5; border-radius: 10px;
  padding: 14px 18px; margin: 20px 0 32px; font-size: 13.5px; }
.toc b { display: block; margin-bottom: 6px; color: var(--brand); }
.toc ul { margin: 4px 0 0; padding-left: 1.4em; }
.toc a { color: var(--muted); }
.toc a:hover { color: var(--brand); }
@media (max-width: 720px) { .wrap { padding: 24px 20px; } h1 { font-size: 22px; } h2 { font-size: 18px; } }
`;

const titleMatch = md.match(/^#\s+(.+)$/m);
const title = titleMatch ? titleMatch[1].trim() : '系统更新日志';

// 自动生成一个目录（抓 H2）
const tocItems = [];
const tocRegex = /^##\s+(.+)$/gm;
let m;
while ((m = tocRegex.exec(md)) !== null) {
  const t = m[1].trim();
  const id = t.toLowerCase().replace(/[\[\]\(\)`*_~!]/g, '')
    .replace(/[^\w\u4e00-\u9fff\- ]/g, '').replace(/\s+/g, '-').slice(0, 64);
  tocItems.push({ id, text: t });
}
const tocHtml = tocItems.length
  ? `<nav class="toc"><b>目录</b><ul>${tocItems.map(x => `<li><a href="#${x.id}">${escapeHtml(x.text)}</a></li>`).join('')}</ul></nav>`
  : '';

const generatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${style}</style>
</head>
<body>
<main class="wrap">
<h1>${escapeHtml(title)}</h1>
<div class="meta">最后同步: ${generatedAt} · 与 <code>系统更新日志.md</code> 同源 · 浏览请访问 <a href="#">本网页</a></div>
${tocHtml}
${bodyHtml}
<hr/>
<p style="text-align:center;color:var(--muted);font-size:12.5px;">
APCA · 个人AI办公能力测评 · 系统更新日志（HTML 版，由 <code>tools/build-update-html.js</code> 生成）
</p>
</main>
</body>
</html>
`;

fs.writeFileSync(DST, html, 'utf8');
fs.writeFileSync(DST_WEB, html, 'utf8');
const sz = fs.statSync(DST).size / 1024;
console.log(`✓ 系统更新日志.html 已生成 -> ${DST}  (${sz.toFixed(1)} KB)`);
console.log(`✓ 脱敏版同步至 web/ (随 rsync 部署) -> ${DST_WEB}`);
