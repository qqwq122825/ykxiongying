#!/bin/bash
# Fisher WebSocket Server - Linux 启动脚本

cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"

echo "=========================================="
echo "  Fisher WebSocket Server - 启动中"
echo "  目录: ${SCRIPT_DIR}"
echo "=========================================="
echo ""

if [ -f "${SCRIPT_DIR}/node_modules/.bin/pm2" ] || command -v pm2 &> /dev/null; then
    echo "[PM2] 使用 PM2 启动服务..."
    if command -v pm2 &> /dev/null; then
        PM2_CMD="pm2"
    else
        PM2_CMD="${SCRIPT_DIR}/node_modules/.bin/pm2"
    fi
    cd "${SCRIPT_DIR}"
    ${PM2_CMD} start pm2-ecosystem.config.cjs
    ${PM2_CMD} save
    echo ""
    echo "[PM2] 服务已启动，查看日志运行: ${PM2_CMD} logs fisher-ws-server"
else
    echo "[INFO] PM2 未安装，使用 node 直接启动（前台模式）"
    echo "[提示] 推荐安装 PM2: npm install -g pm2"
    echo ""
    cd "${SCRIPT_DIR}"
    node src/index.js
fi
