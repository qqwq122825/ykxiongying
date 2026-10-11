#!/bin/bash
# Fisher WebSocket Server - Linux 重启脚本

cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"

echo "=========================================="
echo "  Fisher WebSocket Server - 重启中"
echo "=========================================="
echo ""

# 停止
bash "${SCRIPT_DIR}/stop.sh"

echo ""
echo "等待 2 秒..."
sleep 2

# 启动
bash "${SCRIPT_DIR}/start.sh"

echo ""
echo "✓ 重启流程完成"
