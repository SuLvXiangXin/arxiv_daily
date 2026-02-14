#!/bin/bash
#
# 一键部署企业微信中转代理
# 用法: bash setup.sh
#

set -e

INSTALL_DIR="/opt/wecom-proxy"
SERVICE_NAME="wecom-proxy"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================="
echo "  企业微信中转代理 - 一键部署"
echo "========================================="
echo ""

# 1. 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，正在安装..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

NODE_VER=$(node -v)
echo "✅ Node.js: ${NODE_VER}"

# 2. 创建安装目录
echo ""
echo "📁 安装目录: ${INSTALL_DIR}"
mkdir -p ${INSTALL_DIR}

# 3. 复制代理脚本
cp "${SCRIPT_DIR}/../wecom_proxy.js" ${INSTALL_DIR}/wecom_proxy.js
echo "✅ 代理脚本已复制"

# 4. 创建 .env 配置
if [ ! -f "${INSTALL_DIR}/.env" ]; then
    cp "${SCRIPT_DIR}/.env.example" "${INSTALL_DIR}/.env"
    chmod 600 "${INSTALL_DIR}/.env"
    echo "✅ 配置文件已创建: ${INSTALL_DIR}/.env"
    echo "   ⚠️  请确认 PROXY_TOKEN 是否需要修改"
else
    echo "⚠️  配置文件已存在，跳过覆盖: ${INSTALL_DIR}/.env"
fi

# 5. 安装 systemd 服务
cp "${SCRIPT_DIR}/wecom-proxy.service" /etc/systemd/system/${SERVICE_NAME}.service
systemctl daemon-reload
echo "✅ systemd 服务已安装"

# 6. 启用并启动服务
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}
echo "✅ 服务已启动并设为开机自启"

# 7. 检查状态
echo ""
sleep 1
if systemctl is-active --quiet ${SERVICE_NAME}; then
    echo "🟢 服务运行中"
    echo ""
    # 获取公网 IP
    # 优先从云厂商元数据获取 ECS 绑定的弹性公网 IP (避免 NAT 网关干扰)
    LOCAL_IP=$(hostname -I | awk '{print $1}')
    PUBLIC_IP=""

    # 阿里云 ECS 元数据
    if [ -z "${PUBLIC_IP}" ]; then
        PUBLIC_IP=$(curl -s --max-time 3 http://100.100.100.200/latest/meta-data/eipv4 2>/dev/null || echo "")
    fi

    # 腾讯云 CVM 元数据
    if [ -z "${PUBLIC_IP}" ]; then
        PUBLIC_IP=$(curl -s --max-time 3 http://metadata.tencentyun.com/latest/meta-data/public-ipv4 2>/dev/null || echo "")
    fi

    # 通用方法：通过外部服务探测 (可能返回 NAT 出口 IP)
    if [ -z "${PUBLIC_IP}" ]; then
        PUBLIC_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null \
                 || curl -s --max-time 5 https://ifconfig.me 2>/dev/null \
                 || curl -s --max-time 5 https://icanhazip.com 2>/dev/null \
                 || echo "")
    fi

    if [ -n "${PUBLIC_IP}" ]; then
        DISPLAY_IP="${PUBLIC_IP}"
        echo "  🌐 公网 IP: ${PUBLIC_IP}"
        echo "  🏠 内网 IP: ${LOCAL_IP}"
    else
        DISPLAY_IP="${LOCAL_IP}"
        echo "  ⚠️  未能获取公网 IP，使用内网 IP: ${LOCAL_IP}"
    fi
    PORT=$(grep -oP 'PORT=\K\d+' ${INSTALL_DIR}/.env 2>/dev/null || echo "9000")
    echo "========================================="
    echo "  部署完成！"
    echo "========================================="
    echo ""
    echo "  代理地址:  http://${DISPLAY_IP}:${PORT}/relay"
    echo "  健康检查:  curl http://${DISPLAY_IP}:${PORT}/health"
    echo ""
    echo "  查看日志:  journalctl -u ${SERVICE_NAME} -f"
    echo "  重启服务:  systemctl restart ${SERVICE_NAME}"
    echo "  停止服务:  systemctl stop ${SERVICE_NAME}"
    echo ""
    echo "  GitHub Secrets 需要添加:"
    echo "    WECOM_PROXY_URL   = http://${DISPLAY_IP}:${PORT}/relay"
    PROXY_TOKEN=$(grep -oP 'PROXY_TOKEN=\K.*' ${INSTALL_DIR}/.env 2>/dev/null || echo "")
    echo "    WECOM_PROXY_TOKEN = ${PROXY_TOKEN}"
    echo ""
    echo "  企业微信可信 IP 需要添加: ${DISPLAY_IP}"
    echo "========================================="
else
    echo "🔴 服务启动失败，请检查日志:"
    echo "   journalctl -u ${SERVICE_NAME} --no-pager -n 20"
    exit 1
fi
