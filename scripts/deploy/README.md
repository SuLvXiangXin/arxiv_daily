# 企业微信中转代理部署指南

GitHub Actions 的出口 IP 不固定，无法加入企业微信的 IP 白名单。  
本方案在一台固定 IP 服务器上部署 HTTP 中转代理，由代理转发消息到企业微信 API。

```
GitHub Actions  ──HTTP POST──▶  中转代理 (固定IP)  ──HTTPS──▶  企业微信 API
```

---

## 1. 前提条件

| 项目 | 要求 |
|------|------|
| 服务器 | 一台有固定公网 IP 的 Linux 服务器 (如阿里云 ECS) |
| Node.js | >= 18 (推荐 20 LTS，部署脚本会自动安装) |
| 端口 | 默认 9000，需在安全组/防火墙开放 |
| 企业微信 | 将服务器公网 IP 添加到应用的 **可信 IP** 白名单 |

---

## 2. 一键部署

将代码上传到服务器后，执行：

```bash
# 上传文件到服务器 (本地执行)
scp scripts/wecom_proxy.js  root@你的服务器IP:/tmp/
scp -r scripts/deploy/       root@你的服务器IP:/tmp/

# SSH 到服务器执行
ssh root@你的服务器IP

# 运行部署脚本 (需要 root 权限)
cd /tmp/deploy
bash setup.sh
```

部署脚本会自动：
- 检测 / 安装 Node.js
- 复制文件到 `/opt/wecom-proxy/`
- 创建 `.env` 配置文件
- 安装 systemd 服务
- 启动服务并设为开机自启

---

## 3. 配置说明

配置文件位于 `/opt/wecom-proxy/.env`：

```env
# 代理鉴权令牌 (GitHub Actions 请求时需携带)
PROXY_TOKEN=4b9c3b50daec1ba4fa3d2d7049be9a4923b60a259f80bf3001bbf644728c8682

# 监听端口
PORT=9000
```

如需更换 Token：
```bash
# 生成新 Token
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 编辑配置
vi /opt/wecom-proxy/.env

# 重启服务生效
systemctl restart wecom-proxy
```

---

## 4. GitHub 仓库配置

在 GitHub 仓库 → **Settings → Secrets and variables → Actions** 中添加：

| Secret 名称          | 值                                                  |
|----------------------|------------------------------------------------------|
| `WECOM_APPS`         | 企业微信应用配置 JSON (同 .env)                       |
| `SITE_URL`           | `https://sulvxiangxin.github.io/arxiv_daily`         |
| `WECOM_PROXY_URL`    | `http://你的服务器IP:9000/relay`                     |
| `WECOM_PROXY_TOKEN`  | `.env` 中的 `PROXY_TOKEN` 值                        |

---

## 5. 运维命令

```bash
# 查看服务状态
systemctl status wecom-proxy

# 查看实时日志
journalctl -u wecom-proxy -f

# 查看最近 50 行日志
journalctl -u wecom-proxy --no-pager -n 50

# 重启服务
systemctl restart wecom-proxy

# 停止服务
systemctl stop wecom-proxy

# 禁止开机启动
systemctl disable wecom-proxy
```

---

## 6. 健康检查

```bash
# 本地检查
curl http://localhost:9000/health

# 远程检查
curl http://你的服务器IP:9000/health
```

返回 `{"status":"ok"}` 即表示服务正常运行。

---

## 7. 手动测试

在服务器上测试代理是否能正确转发消息：

```bash
curl -X POST http://localhost:9000/relay \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 你的PROXY_TOKEN" \
  -d '{
    "corpid": "你的企业ID",
    "corpsecret": "你的应用Secret",
    "agentid": 1000002,
    "touser": "@all",
    "messages": [
      {
        "msgtype": "text",
        "text": { "content": "测试消息 - 来自中转代理" }
      }
    ]
  }'
```

---

## 8. 文件结构

```
scripts/
├── wecom_proxy.js         # 中转代理主程序
├── notify_wecom.js        # GitHub Actions 通知脚本 (自动选择代理或直连)
├── test_notify.js         # 本地测试脚本
└── deploy/
    ├── setup.sh           # 一键部署脚本
    ├── wecom-proxy.service # systemd 服务配置
    ├── .env.example       # 环境变量模板
    └── README.md          # 本文档
```

---

## 9. 安全建议

- `.env` 文件权限已设为 `600`，仅 root 可读
- PROXY_TOKEN 用于鉴权，请勿泄露
- 建议只在安全组中开放 9000 端口给 GitHub Actions 的 IP 段
- 如有条件，可以在代理前面加 nginx 反向代理并启用 HTTPS
