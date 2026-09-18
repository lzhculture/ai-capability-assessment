# APCA 后台服务

一个**零依赖**的 Node HTTP 服务，只做三件事：

1. 静态托管 `web/` 目录 —— 测评站（`index.html`）与后台页（`admin.html`）一体发布
2. 接收测评提交，把结果**集中落库**到 `server/data/records.json`
3. 为后台提供：密码登录鉴权 / 汇总统计 / 人员清单 / 题库与规则库 / 删除与清空

## 启动

```bash
# APCA_ADMIN_PASS 必填(v0.8.11 起无默认口令)
APCA_ADMIN_PASS=你的强密码 node server/server.js
```

启动后输出：

```
测评站:   http://localhost:8787/
管理后台: http://localhost:8787/admin
记录库:   server/data/records.json
```

## 账号与密码

| 项 | 默认值 | 覆盖方式 |
|---|---|---|
| 端口 | `8787` | `PORT=9000` |
| 管理员账号 | `admin` | `APCA_ADMIN_USER=xxx` |
| 管理员密码 | **无默认值（必填）** | `APCA_ADMIN_PASS=yyy` |
| 记录库目录 | `server/data` | `APCA_DATA_DIR=/path/to/dir` |

> **v0.8.11 起：不设密码就起不来。** 之前版本兜底为一个写死在代码里的默认口令，
> 一旦仓库公开等于把后台密码公之于众。现在未设置 `APCA_ADMIN_PASS` 时服务直接退出并给出提示。

```bash
APCA_ADMIN_USER=admin APCA_ADMIN_PASS=你的强密码 node server/server.js
```

登录有效期 8 小时；同一 IP 连续输错 8 次密码会锁定 10 分钟。

## 两种运行模式

| | 服务端模式（推荐） | 本地模式 |
|---|---|---|
| 触发条件 | 由 `server.js` 托管访问 | 直接双击 `admin.html`（`file://`） |
| 数据来源 | 服务端集中库，**能看到所有测评人** | 仅本浏览器 localStorage，**只有自己** |
| 密码校验 | 服务端校验（真实安全边界） | 前端校验（仅防随手点开） |
| 统计范围 | 全部提交记录 | 本机记录 |

> ⚠️ 常见疑问：**"我把链接发给别人测了，为什么后台看不到他们？"**
> 因为纯静态分发（如 GitHub Pages / 对象存储）时，每个人的答案只存在他自己的浏览器里。
> 要汇聚所有人的结果，**必须由 `server.js` 托管站点**——此时测评页提交时会额外同步一份到服务端。

## 接口一览

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/ping` | 否 | 服务探测，后台页据此判断模式 |
| POST | `/api/submit` | 否 | 提交测评结果入库 |
| POST | `/api/admin/login` | 否 | 登录，成功返回 `token` |
| GET | `/api/admin/ping` | 是 | 校验令牌是否有效 |
| GET | `/api/admin/stats` | 是 | 汇总统计（等级/维度/公司/岗位/批次/趋势） |
| GET | `/api/admin/records` | 是 | 人员清单（按时间倒序） |
| DELETE | `/api/admin/records` | 是 | 删除单条（body: `{id}`） |
| POST | `/api/admin/records/clear` | 是 | 清空全部记录 |
| GET | `/api/admin/bank` | 是 | 题库与规则库原始数据 |

鉴权方式：请求头 `X-Admin-Token: <token>`（调试时也可用 `?token=`）。

## 数据文件

- 路径：`server/data/records.json`（可用 `APCA_DATA_DIR` 改）
- 写入方式：先写 `.tmp` 再原子 `rename`，避免写一半损坏
- 容量上限：20000 条，超出后保留最新的

每条记录包含：总分 / 等级 / 六维得分 / 测评卷 / 逐题作答 / 测评人信息（姓名·公司·岗位·批次·备注）/ 终端 `clientId` / 时间戳。

## 部署建议

- **内网使用**：直接在内网机器上 `node server/server.js`，把 `http://<内网IP>:8787` 发出去即可。
- **公网使用**：务必 ① 设置一个强密码（`APCA_ADMIN_PASS`）② 用 Nginx 做 HTTPS 反向代理 ③ 限制访问来源。
- **进程守护**：用 `pm2` / `systemd` / `docker restart: always` 保证常驻。
- **备份**：定期备份 `server/data/records.json`。

## 测试

```bash
node tools/verify-server.js    # 服务端端到端(40 项): 托管/鉴权/统计/删除/穿越防护
node tools/verify-wiring.js    # 前后台接线静态校验(19 项)
node tools/verify-web.js       # 计分与一致性校验(含锚点/长度均衡/系统更新日志 门禁)
```
