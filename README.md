# APCA 个人 AI 办公能力测评 · 网页版

> **版权与许可**：本系统由 **jmount** 个人原创开发，著作权归作者所有。**源代码按 MIT 许可证开源**——可以自由使用、修改、二次分发与商用，只需保留这份版权声明。详见 [LICENSE](./LICENSE)。
> 每个部署实例自带一份许可证副本，由 `LICENSE.template` 渲染生成（`python tools/build-license.py --server=...`）。
>
> **当前形态：网页版（Web）。** 项目最初按微信小程序设计（v0.1–v0.7，源码在 `miniprogram/`），**2026-09 起已取消小程序、改为纯网页版**。当前线上产品即网页版，部署于 http://<服务器IP>:8787/。本文档与 `产物/` 设计文档统一以网页版为准；`miniprogram/` 仅作为历史遗留源码保留，不再维护。

## 一、产品是什么

APCA（AI Personal Capability Assessment）是一套**自我报告式成熟度量表**，用于测评个人在 6 个维度上的 AI 办公应用成熟度：AI 沟通 / 任务拆解 / 流程选择 / 质量管控 / 风险应对 / 经验复用。答题约 5–10 分钟，即时生成：六维雷达图 + 综合等级（L1–L4）+ 维度明细 + 30 天学习地图 + 逐题复盘。

- **通用卷** 32 题（6 维 × 5 题，其中 D3 维度 7 题含 D3-6 Lost in the middle 与 D3-7 多轮上下文锁定）；可选加测 3 个**专项模型**：招投标 / 制造业 / 连锁品牌门店（各 18 题），支持「加测（blended）」与「单独成卷（standalone）」两种入口。
- **计分**：每题 4 选项按成熟度递增，A=0 / B=33.3 / C=66.7 / D=100。**选项在每题乱序呈现，且每题分值映射不同**（详见第六节防作弊设计）。
- **零强制账号**：无需注册登录即可作答。**测评人信息页的姓名 / 所在公司 / 岗位为必填但可虚拟填写**（自 v0.8.2 起，如"张三 / 示例公司 / 产品经理"），用于后台按公司、岗位、批次做汇总分析，不需要提供真实身份信息。个人作答默认仅存浏览器本机；若由 `server.js` 托管，可汇聚到后台做团队汇总。

## 二、在线地址

- 测评站：http://<服务器IP>:8787/
- 管理后台：http://<服务器IP>:8787/admin （需管理员密码）

## 三、目录结构

```
ai-capability-assessment/
├── web/                 网页版前端（部署产物；data.js 由构建脚本生成）
│   ├── index.html       测评站
│   ├── app.js           测评逻辑（答题 / 计分 / 复盘 / 历史 / 分享）
│   ├── data.js          题库（window.APCA_DATA，由 build-web-data.js 生成）
│   ├── style.css
│   └── admin.html / admin.js / admin.css   管理后台（汇总统计 / 人员清单 / 题库查看）
├── server/              零依赖 Node 服务（静态托管 + 后台 API + 记录落库）
│   ├── server.js
│   └── data/records.json
├── tools/               构建与校验
│   ├── build-web-data.js     源题库(miniprogram/data) → web/data.js（含选项乱序）
│   ├── lib/shuffle.js        每题确定性乱序 + 解析字母重映射
│   ├── verify-web.js / verify-web-dom.js / verify-wiring.js / verify-merge.js / verify-server.js   共 430+ 项断言
│   ├── check-option-balance.js       选项长度均衡扫描
│   ├── check-analysis-consistency.js 解析与计分锚点一致性扫描
│   └── build-archive-snapshots.js    真源 → 产物/02-题库.json、04-行业特化题包.json 快照重导（v0.8.4 起）
├── miniprogram/         ⚠️ 历史遗留：小程序源码（v0.6，已废弃，不再维护）
├── 产物/                设计文档（见「七、文档导航」）
├── 系统更新日志.md      版本更新说明（发版必更新，校验门禁强制把关）
├── 系统更新日志.html    同源 HTML 版，发版后自动生成，便于浏览器阅读（`node tools/build-update-html.js`）
└── README.md            本文档
```

## 四、本地运行 / 构建 / 校验

```bash
# 1) 本地起服务（含后台，默认 http://localhost:8787/）
node server/server.js

# 2) 改了题库源（miniprogram/data/*.js）后，重建 web/data.js
node tools/build-web-data.js

# 3) 全量校验（改完必跑；门禁含"发版须更新 CHANGELOG"）
node tools/verify-web.js          # 计分与一致性（含锚点/长度均衡/版本同步门禁）
node tools/verify-web-dom.js      # 真实 DOM 全流程（需 agent-browser 无头浏览器）
node tools/verify-wiring.js       # 前后台接线静态校验
node tools/verify-merge.js        # 专项合并出分校验
node tools/verify-server.js       # 服务端端到端（托管/鉴权/统计/删除）
```

## 五、部署上线

```bash
# 1) 同步前端到服务器（幂等; 含 web/qrcode.png 海报二维码）
rsync -avz --delete -e "ssh -i ~/.ssh/你的服务器密钥.pem" web/ 部署用户@<服务器IP>:<部署目录>/web/

# 2) 同步版本说明留档 + 上传 HTML 版到 web 根, 便于线上直读
scp 系统更新日志.md 部署用户@<服务器IP>:<部署目录>/系统更新日志.md
scp 系统更新日志.html 部署用户@<服务器IP>:<部署目录>/web/系统更新日志.html

# 3) 重启服务
ssh 部署用户@<服务器IP> "sudo systemctl restart apca.service"

# 4) 线上验证 (版本号 + 海报二维码可访问)
curl -s http://<服务器IP>:8787/data.js | grep questionSetVersion
curl -sI http://<服务器IP>:8787/qrcode.png | head -1
curl -sI http://<服务器IP>:8787/系统更新日志.html | head -1
```

**发版惯例（自 v0.8.2 起固化）**：

1. 改题库 / 计分 / 用户可见行为 → **只改 `tools/build-web-data.js` 里的 `questionSetVersion` 一处** → 重建 `web/data.js`；
2. 同步文档：必须更新 `系统更新日志.md`（新增置顶条目），并同步 `README.md`、`产物/00-总览分析.md`、`产物/05-网页版落地方案.md`；
3. 跑五件套校验——**漏更文档会直接被门禁拦下**：§1.7 系统更新日志条目、§1.8 构建脚本与产物版本号一致、§1.9 README 含当前版本号、§1.10 系统更新日志.html 同步生成且不早于 .md、§1.11 固定单字母期望分在"不可套利"区间、§1.12 学习地图为 30 天、§1.13 产物快照与真源逐题一致；
4. `rsync` 部署 `web/` + `scp` 上传 `系统更新日志.md` → 重启 `apca.service` → 线上验证版本号。
5. **同步至 GitHub 仓库**：`./tools/sync-to-github.sh`（自动跑五件套校验 → 写带版本号的 commit → `git push origin main`）。详细流程见 `GITHUB.md`。

## 五 B、另有一套内网服务器部署（手册不在本仓库）

本项目曾在一家合作方的内网服务器上部署过一套实例，涉及该环境的内网地址、
nginx 反代配置与专用部署脚本。**那套手册与脚本属于该环境的内部物料，不随本仓库分发**，
保存在工作区的 `内部过程文件/合作方物料/` 目录下。

> 本仓库只保留通用的部署说明（见上一节）。如果你要在自己的服务器上部署，
> 照上一节的做法即可，不需要那份内网手册。

## 六、防作弊与数据质量（六轮修复）

| 版本 | 修复 | 效果 |
|---|---|---|
| v0.7.1 | **选项长度均衡** | 每题四选项字数均衡，消除"长的就是答案"的视觉线索 |
| v0.8 | **选项乱序呈现** | 每题 4 选项按题 ID 确定性乱序，分值随选项一起换位。**固定单字母策略期望分实测 A 47.2 / B 55.2 / C 48.4 / D 49.2**（随机≈50），最高不达 L4，无固定字母可套利（此前"约 35 分"的宣称有误，v0.8.4 已勘误并加 §1.11 回归断言） |
| v0.8.1 | **计分锚点修正** | 12 道早期题的满分选项与解析矛盾（解析贬低满分项），已纯置换修正；历史记录自动迁移 |
| v0.8.2 | **测评人信息必填** | 姓名 / 公司 / 岗位改为必填但可虚拟填写，保证后台按公司、岗位汇总的样本完整可用；未填写无法开始答题 |
| v0.8.3 | **日志双载体 + 入口二维码** | 更新日志同步产出可读 HTML 版（§1.10 门禁）；结果海报嵌入测评入口二维码，扫码直达测评站 |
| v0.8.4 | **解析裁决 + 宣称勘误 + 产物门禁** | 15 题解析未把最高级定性落在满分项（含 D1-2 推崇 66.7 分选项而弱化 100 分选项），已逐题改写，软警示 15→0；产物快照（02/04）与真源脱节已重导并纳入 §1.13 逐题门禁；学习地图由 6 天修为真正的 30 天 |
| v0.8.5 | **计分归一化 + 乱序独立校验 + 服务端加固** | blended 分母按实际作答维度归一化（避免有维度漏答时低估总分）；新增 `shuffle-indep.js` 独立校验乱序结果（防"用自己验自己"）；服务端 `/api/submit` 强化字段类型/范围校验 + 单 IP 60s 10 次限流；记录/分享带 `qVersion` 字段；后台 `byPack` 按 `(packId, qVersion)` 分组避免同名不同版本混池 |
| v0.8.6 | **个体化解读 + D3 +2 题** | "最该做的 3 件事"基于作答画像生成（不再同段位同建议），30 天路线绑定 72 条具体动作；D3 维度新增 2 题：Lost in the middle（80 页合同场景）、多轮对话上下文锁定（场景跨 8 轮 AI 失忆）；通用卷 30 → 32 题；错题回看默认折叠到本次解读相关题，按钮可展开全部 |
| v0.8.7 | **外部工作台交叉审查整改 P0** | calcResult 增 completeness（<0.5 不出综合等级，防缺答刷满分）；服务端 /api/submit 独立重算 total+dimScores（不信客户端）；buildAdviceForRecord 改按"dimScores 升序→最弱维度内最弱能力点"（不再偏 D1）；buildLearningMap 固定 6×5=30 天（不再 21-36 天）；LICENSE.template+build-license.py（主站→<你的域名> / 创建→<内网域名> 双服务器差异授权）；findGeneralRecord 加 qVersion 隔离；复盘兜底真实现；同步失败 toast + 本地持久化重试；二维码默认改域名 |
| v0.8.8 | **第三方工作台二次审查整改** | web/admin.js 移除明文 LOCAL_USER/LOCAL_PASS，本地模式 fallback 加 isLocalHost() 守卫（仅 file:// / 127.0.0.1 / localhost 允许，公网部署一律强制走服务端鉴权）；admin.js:415 + index.html:43 + index.html:115 + app.js:3 的"通用 30 题"硬编码全部改动态（D.core.length 或"启动后自动填充"占位避免首屏闪现旧值）；app.js:620 + index.html:167 的"0/33/67/100"文案改为与 scoreMap 一致的"0/33.3/66.7/100"；server.js /api/ping 删除 count 字段；sendJSON 加 4 个安全响应头（X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Content-Security-Policy）；app.js b64encodeUnicode 改 0x8000 分块防栈溢出 |
| v0.8.9 | **Codex 回归审查全量整改** | **P0 计分口径对齐**：server.js `serverCalcResult` 弃用「每维度题目数」加权，改用 `pack.weights` 与前端同源，并识别 `merged` 走等权——修复 v0.8.7 引入的严重回归（专项 standalone 被拒 77~81%、blended 57~69%，最大偏差 6.6 分 → 现偏差 ≤0.5 全部入库）；完整度门槛 `< 0.5` → `< 1`（只有全答完才出等级，堵住 18/32 拿 L4 的刷分缺口）；verify-server 补维度不均衡专项回归用例（此前用例全是「全 100 分」，两套模型结果相同，天然漏检）。**P1 安全**：公网更新日志 HTML 脱敏（屏蔽服务器 IP / SSH 目标 / 部署脚本名 / systemd 服务名，源 md 保留细节）；CSV 导出对 `=+-@` 开头字段加单引号前缀防公式注入；静态资源（HTML/JS/CSS）补 X-Frame-Options + CSP（此前只在 JSON 接口加，作用不到文档响应）；分享链接不再携带 total/levelId/dimScores，一律按 answers 重算（防伪造）；二维码改双服务器版本——主站版走 **IP 入口** `http://<服务器IP>:8787/`、内网版走域名 `https://<内网域名>/ai-assess/`（`web/qrcode.png` + `产物/qrcode_site-b.png`）。**P2 内容**：海报版本号硬编码 `v0.8.3` 改动态；D3-6/D3-7 解析中的机构/厂商名（Chroma / Laban / Morph / LawVu / 豆包工作 / QwenWork / WorkBuddy / ChatGPT）中性化；复盘默认折叠关联题由 `globalWeakAbilities` 改为「维度分升序取 3 维、每维取最弱能力点」，D1 偏置 35.5% → 17.6% |
| v0.8.10 | **专项卷复盘降级文案** | 专项卷作答（`packId !== 'none'`）显示「本次为专项卷作答（X 题），能力点级解读需配合通用 32 题作答开启；建议先做一次通用 32 题获得能力点级画像」明确引导（此前统一写「画像信息缺失」不明不白）；通用卷/分享链接异常路径保留原兜底说明。**未改题库/算法**，abilities 标签覆盖现状 32/100% 通用 vs 0/54 专项，专项标签由 v0.9.0 题库能力点 V2 专项处理 |
| v0.8.11 | **移除内置默认口令 + 开源许可证落定** | `server/server.js` 不再写死管理员密码——未设置 `APCA_ADMIN_PASS` 时服务拒绝启动并打印处置指引（此前兜底为一个写死在代码里的口令，仓库转公开即等于公开后台密码）；启动日志不再打印明文口令（一律 `******`）；新增根目录 MIT 许可证正本（此前 README 引用的 `./LICENSE` 并不存在），`LICENSE.template` 由「限域名、禁商用」的个人作品许可改为 MIT 副本 + 部署登记信息，根 README 版权声明同步改写。**注意**：新装实例必须先设 `APCA_ADMIN_PASS`，已在用的两台服务器配置里都已带该变量，升级重启不受影响 |

## 七、文档导航

| 文档 | 内容 |
|---|---|
| `系统更新日志.md` | 版本更新说明（v0.1→v0.8.5）与发版惯例 |
| `GITHUB.md` | GitHub 上传与日常同步操作指南（含 SSH 配置、首次推送、commit 规范、故障排查） |
| `产物/00-总览分析.md` | 指标体系 / 题库设计 / 落地形态演进 |
| `产物/05-网页版落地方案.md` | 技术落地方案（网页版架构 / 数据流 / 部署 / 路线图） |
| `产物/01-指标体系.json` `02-题库.*` `04-行业特化题包.json` | 框架与题库原始数据 |
| `tools/sync-to-github.sh` | 一键同步到 GitHub（自动跑五件套校验 + push） |
| `miniprogram/README.md` | ⚠️ 历史遗留，小程序源码说明，已废弃 |

## 八、隐私与安全

- 测评人信息（姓名 / 公司 / 岗位）为必填但**允许虚拟填写**，不强制真实身份、不做身份核验；个人作答默认仅存浏览器本机，由 `server.js` 托管时同步落库到服务端（用于后台汇总），不绑身份、不对外披露个人结果。
- 自我报告式量表，非对错考试；结果仅用于个人能力定位与提升规划。
- 公网部署务必修改后台默认密码、加 HTTPS 反向代理、限制访问来源（详见 `server/README.md`）。
