#!/bin/bash
# Fisher WebSocket Server - Linux 停止脚本

cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"

echo "=========================================="
echo "  Fisher WebSocket Server - 停止中"
echo "=========================================="
echo ""

WS_PORT="${WS_PORT:-8889}"

# 先尝试优雅关闭
echo "[1/3] 发送优雅关闭信号..."
curl -s -X POST "http://127.0.0.1:${WS_PORT}/internal/shutdown" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "      信号已发送，等待 3 秒..."
    sleep 3
fi

# 尝试用 PM2 停止
if command -v pm2 &> /dev/null || [ -f "${SCRIPT_DIR}/node_modules/.bin/pm2" ]; then
    echo "[2/3] 通过 PM2 停止服务..."
    if command -v pm2 &> /dev/null; then
        PM2_CMD="pm2"
    else
        PM2_CMD="${SCRIPT_DIR}/node_modules/.bin/pm2"
    fi
    ${PM2_CMD} stop fisher-ws-server 2>/dev/null
    ${PM2_CMD} delete fisher-ws-server 2>/dev/null
fi

# 如果进程还在，强制杀掉
echo "[3/3] 检查残留进程..."
PIDS=$(pgrep -f "node.*src/index.js" 2>/dev/null)
if [ -n "$PIDS" ]; then
    echo "      发现残留进程，强制终止..."
    kill -9 $PIDS 2>/dev/null
    sleep 1
fi

# 再次确认
REMAINING=$(pgrep -f "node.*src/index.js" 2>/dev/null)
if [ -z "$REMAINING" ]; then
    echo ""
    echo "✓ 服务已成功停止"
else
    echo "✗ 仍有进程残留: $REMAINING"
    exit 1
fi
