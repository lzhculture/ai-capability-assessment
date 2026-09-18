# GitHub 上传与同步指南

> 适用对象：APCA 个人 AI 办公能力测评项目
> 仓库：https://github.com/lzhculture/ai-capability-assessment（**Private**；2026-09-18 业主定：先私有落地）
> 同步策略：本地 `main` 分支 = GitHub `main` 分支，发版后即推
>
> **2026-09-18 更正两处旧错误**（此前一直没对上，导致推送从未成功）：
> 1. 账号是 **`lzhculture`**，本文旧版多写了一个 u（`lzhu…`）——那是公司域名的拼法，不是 GitHub 账号（公司域名不在本仓库出现，仓库只保留这个账号名）。
> 2. 该仓库此前**并不存在**。2026-09-18 才首次建库并推送，此前"v0.8.5 已推送"的记载不实。
> 3. 仓库可见性定为**私有**：涉及另一主体的物料与运维细节，不对外暴露；将来要对外展示时再一键转公开（已推内容不受影响）。

---

## 一、前置准备（一次性）

### 1.1 GitHub 上建仓库

1. 登录 https://github.com/lzhculture
2. 右上角 **+** → **New repository**
3. 填写：
   - **Repository name**: `ai-capability-assessment`
   - **Description**: `APCA · 个人 AI 办公能力测评 · 6 维度 / 4 等级 / 题库 v0.8.10`
   - **Visibility**: ◉ **Private**（2026-09-18 业主定：先私有；对外展示决策明确后再转公开）
   - ☐ **Initialize this repository with a README**（**不勾选**——我们本地已有 README）
   - ☐ Add .gitignore / ☐ Choose a license（**不选**——本地已有 .gitignore）
4. 点 **Create repository**
5. 创建后页面会显示仓库地址（SSH 形式）：
   ```
   git@github.com:lzhculture/ai-capability-assessment.git
   ```

### 1.2 添加 SSH 公钥（首次推送前必做）

本机已有 SSH key：`~/.ssh/tencent_lzhuculture`（私钥）+ `tencent_lzhuculture.pub`（公钥）。无需新建。

1. GitHub → 右上角头像 → **Settings** → **SSH and GPG keys** → **New SSH key**
2. **Title**: `MacBook-AI评测-2026`
3. **Key type**: Authentication Key
4. **Key**: 把下面命令的输出贴进去：
   ```bash
   cat ~/.ssh/tencent_lzhuculture.pub
   ```
5. 点 **Add SSH key**（GitHub 可能要求输入密码验证）

测试连通：
```bash
ssh -T git@github.com
# 预期输出：Hi lzhculture! You've successfully authenticated...
```

### 1.3 关联远程仓库（本地仓库里执行一次）

```bash
cd /Users/jmount/Documents/ZW/研发/AI评测/ai-capability-assessment

# 默认分支从 master 改 main（GitHub 新建仓库默认 main）
git branch -M main

# 关联远程仓库
git remote add origin git@github.com:lzhculture/ai-capability-assessment.git

# 验证
git remote -v
# 预期输出两个 origin 行，都指向 git@github.com:...
```

---

## 二、首次推送

### 2.1 一次性提交

```bash
cd /Users/jmount/Documents/ZW/研发/AI评测/ai-capability-assessment

# 检查待提交内容（应仅含核心目录和文档）
git status --short

# 首次提交
git add .
git commit -m "v0.8.5 · 初始公开版本（个人 AI 办公能力测评）"

# 推送到 GitHub（首次需 -u 建立追踪）
git push -u origin main
```

### 2.2 推送后验证

1. 浏览器打开 https://github.com/lzhculture/ai-capability-assessment
2. 应能看到 README.md / web/ / miniprogram/ / server/ / tools/ / 产物/ / 系统更新日志.md 等
3. 不应看到：`.DS_Store` / `.npm-cache/` / `e2e-shots/` / 旧版本预览物料（v0.8.3/v0.8.4）/ `server/records.json`

---

## 三、日常同步（每次发版后）

### 3.1 一键同步脚本

已封装到 `tools/sync-to-github.sh`，运行：

```bash
./tools/sync-to-github.sh
```

脚本会自动：
1. 检查当前是否有未提交修改
2. 跑五件套校验（任一 FAIL 则拒绝推送并提示先修）
3. 跑 `check-qVersion-bump.sh`（自动门禁：未升版禁止推送）
4. 生成带版本号的 commit message
5. 推送 `main`

### 3.2 手动同步

如需手动控制：

```bash
# 1. 校验
for t in verify-web verify-web-dom verify-wiring verify-merge verify-server; do
  node tools/$t.js || { echo "$t FAILED"; exit 1; }
done

# 2. 提交
git add .
git commit -m "v0.8.X · <本次发版简述>"

# 3. 推送
git push origin main
```

---

## 四、commit message 规范

```
v<版本号> · <一句话变更摘要>

可选详细段落：
- 变更1
- 变更2
- 关联 issue #N（如有）
```

**示例**：
```
v0.8.5 · 服务端限流 + 记录补 qVersion + byPack 分组按版本

- 服务端 submit 增加字段校验与单 IP 10/60s 限流
- 记录/分享补 qVersion，admin 详情卡显示题目版本
- byPack 统计按 (packId, qVersion) 分组，避免混池
- 五件套 480 PASS / 0 FAIL
```

---

## 五、故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| `Permission denied (publickey)` | GitHub 未加 SSH key 或公钥不匹配 | 重新粘贴 `tencent_lzhuculture.pub` 到 GitHub |
| `failed to push some refs` | 远程有新提交 | `git pull --rebase origin main && git push` |
| `! [rejected] main -> main (non-fast-forward)` | 本地落后于远程 | 同上 |
| `fatal: refusing to merge unrelated histories` | 本地与远程没有共同祖先 | `git pull origin main --allow-unrelated-histories` |
| 推送后 GitHub 显示 web/data.js 已过时 | 这正常，data.js 是产物可重建 | 在 README "维护说明"已注明；无需处理 |
| 推送脚本拒绝并提示 "FAIL" | 五件套校验未全绿 | 先跑 `node tools/verify-web.js` 看哪条失败，修完再推 |

---

## 六、安全自查清单（推送前确认）

- [ ] 仓库中**不含** `records.json`（后台真实测评数据）
- [ ] 仓库中**不含** `.workbuddy/`（项目工作记忆，含个人偏好）
- [ ] 仓库中**不含** SSH 私钥、API Key、邮箱密码
- [ ] 仓库中**不含** `.npm-cache/`（含历史 npm 包下载，含敏感路径）
- [ ] README 不含具体公司名（按文档产出规范保留通用主体）
- [ ] 系统更新日志不含线上服务器 IP（已在 v0.8.3 后改为域名或备注）

---

## 七、未来可选增强

- **GitHub Actions CI**：在仓库根建 `.github/workflows/ci.yml`，跑 `node tools/verify-web.js`，自动门禁；
- **自动发布 Release**：每个版本 tag（如 `v0.8.5`）触发，自动生成 Release Notes；
- **gh-pages 托管前端 demo**：若想 GitHub 直接演示，启用 Pages 即可（不影响腾讯云生产）；
- **Issue / PR 模板**：`.github/ISSUE_TEMPLATE/` 与 `PULL_REQUEST_TEMPLATE.md`。

需我帮你配置其中任何一项，告诉我即可。