#!/bin/bash
# Fisher Project - Linux 服务管理脚本 (替代 Windows start.bat)
# 支持: Ubuntu 22.04 LTS / 24.04 LTS + 宝塔面板

set -e

cd "$(dirname "$0")"
DEPLOY_DIR="$(pwd)"
PROJECT_ROOT="$(dirname "${DEPLOY_DIR}")"
BT_PANEL="/www/server/panel"  # 宝塔Linux默认安装路径
SHARED_ENV="${PROJECT_ROOT}/.env"

read_env_value() {
    local key="$1"
    [ -f "${SHARED_ENV}" ] || return 0
    awk -F= -v wanted="${key}" '
        /^[[:space:]]*#/ || /^[[:space:]]*$/ || /^[[:space:]]*\[/ { next }
        {
            k=$1; gsub(/^[[:space:]]+|[[:space:]]+$/, "", k)
            if (k == wanted) {
                v=substr($0, index($0, "=")+1)
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
                gsub(/^['\"']|['\"']$/, "", v)
                print v
                exit
            }
        }
    ' "${SHARED_ENV}"
}

EXTERNAL_HOST="$(read_env_value EXTERNAL_HOST)"
EXTERNAL_PORT="$(read_env_value EXTERNAL_PORT)"
FRPS_DASHBOARD_PORT="$(read_env_value FRPS_DASHBOARD_PORT)"
EXTERNAL_HOST="${EXTERNAL_HOST:-$(read_env_value FRPS_ADDR)}"
EXTERNAL_HOST="${EXTERNAL_HOST:-127.0.0.1}"
EXTERNAL_PORT="${EXTERNAL_PORT:-8889}"
FRPS_DASHBOARD_PORT="${FRPS_DASHBOARD_PORT:-7500}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()    { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

# 检测宝塔服务
check_bt() {
    if [ -d "${BT_PANEL}" ]; then
        return 0
    else
        return 1
    fi
}

# 启动宝塔服务
start_bt_services() {
    log_info "启动宝塔面板服务 (MySQL/PHP/Nginx/Redis)..."
    if check_bt; then
        /etc/init.d/mysqld start 2>/dev/null || systemctl start mysqld 2>/dev/null || true
        /etc/init.d/php-fpm-{74,80,81,82,83} start 2>/dev/null || true
        /etc/init.d/nginx start 2>/dev/null || systemctl start nginx 2>/dev/null || true
        /etc/init.d/redis start 2>/dev/null || systemctl start redis 2>/dev/null || true
        sleep 2
        log_info "宝塔服务启动完成"
    else
        log_warn "未检测到宝塔面板，跳过宝塔服务启动"
        log_info "请手动启动 MySQL/Nginx/PHP/Redis"
    fi
}

# 停止宝塔服务 (只停PHP，保留MySQL/Nginx运行)
stop_bt_services() {
    log_info "停止 PHP-FPM 服务..."
    if check_bt; then
        /etc/init.d/php-fpm-{74,80,81,82,83} stop 2>/dev/null || true
        log_info "PHP 服务已停止"
    fi
}

# 启动 frps
start_frps() {
    FRPS_DIR="${HOME}/frp"
    FRPS_BIN="${FRPS_DIR}/frps"
    # ★ 2026-09-18 修复：FRP v0.61.x 起 TOML 报 unknown field，统一改用 INI 格式 frps.ini
    FRPS_CONFIG="${FRPS_DIR}/frps.ini"

    if [ ! -f "${FRPS_BIN}" ]; then
        # 尝试常见位置（宝塔/系统自带等）
        FRPS_BIN="$(command -v frps 2>/dev/null || true)"
        [ -z "${FRPS_BIN}" ] && [ -x "/usr/bin/frps" ] && FRPS_BIN="/usr/bin/frps"
        [ -z "${FRPS_BIN}" ] && [ -x "/usr/local/bin/frps" ] && FRPS_BIN="/usr/local/bin/frps"
        FRPS_CONFIG="/etc/frp/frps.ini"
    fi

    # 如果 frps.ini 不存在但 frps.toml 存在，保留兜底但优先 INI
    if [ ! -f "${FRPS_CONFIG}" ] && [ -f "${FRPS_DIR}/frps.toml" ]; then
        FRPS_CONFIG="${FRPS_DIR}/frps.toml"
    fi

    if [ -f "${FRPS_BIN}" ] && [ -f "${FRPS_CONFIG}" ]; then
        log_info "启动 frps 服务 (bin=${FRPS_BIN}, conf=${FRPS_CONFIG})..."
        # 检查是否已在运行
        if pgrep -x "frps" > /dev/null; then
            log_warn "frps 已在运行，跳过启动"
        else
            nohup "${FRPS_BIN}" -c "${FRPS_CONFIG}" > "${FRPS_DIR}/frps.log" 2>&1 &
            sleep 2
            if pgrep -x "frps" > /dev/null; then
                log_info "frps 启动成功 (PID: $(pgrep -x frps))"
            else
                log_error "frps 启动失败，请检查日志: ${FRPS_DIR}/frps.log"
            fi
        fi
    else
        log_warn "未找到 frps 可执行文件或配置"
        log_info "  预期位置:"
        log_info "    ${FRPS_DIR}/frps + ${FRPS_DIR}/frps.ini"
        log_info "    或 /usr/bin/frps + /etc/frp/frps.ini"
    fi
}

# 停止 frps
stop_frps() {
    log_info "停止 frps 服务..."
    if pgrep -x "frps" > /dev/null; then
        pkill -x "frps"
        sleep 1
        if pgrep -x "frps" > /dev/null; then
            pkill -9 -x "frps"
        fi
        log_info "frps 已停止"
    else
        log_info "frps 未运行"
    fi
}

# 启动 Node.js WS 服务
start_node_ws() {
    log_info "启动 Node.js WebSocket 服务..."
    bash "${PROJECT_ROOT}/node-ws/start.sh"
}

# 停止 Node.js WS 服务
stop_node_ws() {
    log_info "停止 Node.js WebSocket 服务..."
    bash "${PROJECT_ROOT}/node-ws/stop.sh"
}

# 查看服务状态
show_status() {
    echo ""
    echo "=========================================="
    echo "  Fisher 服务状态检查"
    echo "  $(date '+%Y-%m-%d %H:%M:%S')"
    echo "=========================================="
    echo ""
    
    log_info "MySQL:"
    if command -v mysql &> /dev/null; then
        systemctl is-active mysqld 2>/dev/null && echo "      Active: active" || echo "      Active: inactive"
    else
        echo "      未安装或未检测到"
    fi
    
    echo ""
    log_info "Redis:"
    if command -v redis-cli &> /dev/null; then
        redis-cli ping 2>/dev/null | head -1 | awk '{print "      " $0}'
    else
        echo "      未安装或未检测到"
    fi
    
    echo ""
    log_info "Nginx:"
    if command -v nginx &> /dev/null; then
        systemctl is-active nginx 2>/dev/null && echo "      Active: active" || echo "      Active: inactive"
    else
        echo "      未安装或未检测到"
    fi
    
    echo ""
    log_info "PHP-FPM:"
    for v in 74 80 81 82 83; do
        if pgrep -f "php-fpm.*${v}" > /dev/null; then
            echo "      PHP ${v:0:1}.${v:1}: active"
        fi
    done
    
    echo ""
    log_info "Node.js (fisher-ws):"
    if pgrep -f "node.*src/index.js" > /dev/null; then
        echo "      Active: active (PID: $(pgrep -f 'node.*src/index.js' | xargs))"
    else
        echo "      Active: inactive"
    fi
    if command -v pm2 &> /dev/null; then
        pm2 status fisher-ws-server 2>/dev/null | head -5 | tail -3
    fi
    
    echo ""
    log_info "frps:"
    if pgrep -x "frps" > /dev/null; then
        echo "      Active: active (PID: $(pgrep -x frps | xargs))"
    else
        echo "      Active: inactive"
    fi
    
    echo ""
    log_info "监听端口:"
    for PORT in 80 443 3306 6379 7000 7500 8888 8889; do
        if ss -tlnp 2>/dev/null | grep -q ":${PORT} "; then
            PROCESS=$(ss -tlnp 2>/dev/null | grep ":${PORT} " | awk '{print $NF}' | head -1)
            printf "      端口 %-6s %s %s\n" "${PORT}" "LISTEN" "${PROCESS}"
        elif netstat -tlnp 2>/dev/null | grep -q ":${PORT} "; then
            PROCESS=$(netstat -tlnp 2>/dev/null | grep ":${PORT} " | awk '{print $NF}' | head -1)
            printf "      端口 %-6s %s %s\n" "${PORT}" "LISTEN" "${PROCESS}"
        fi
    done
    echo ""
}

# 全部启动
start_all() {
    log_info "========== 启动全部服务 =========="
    start_bt_services
    start_frps
    start_node_ws
    echo ""
    log_info "✓ 全部服务启动命令已执行"
    echo ""
    echo "  访问地址:"
    echo "    前端:    http://${EXTERNAL_HOST}:8888"
    echo "    后端API: http://${EXTERNAL_HOST}"
    echo "    WS端口:  ws://${EXTERNAL_HOST}:${EXTERNAL_PORT}"
    echo "    frp面板: http://${EXTERNAL_HOST}:${FRPS_DASHBOARD_PORT}"
    echo ""
}

# 全部停止
stop_all() {
    log_info "========== 停止全部服务 =========="
    stop_node_ws
    stop_frps
    stop_bt_services
    echo ""
    log_info "✓ 全部服务停止命令已执行"
}

# 全部重启
restart_all() {
    log_info "========== 重启全部服务 =========="
    stop_all
    echo ""
    sleep 3
    start_all
}

# 显示菜单
show_menu() {
    clear
    echo "=========================================="
    echo "  Fisher Project - Linux 服务管理"
    echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "  系统: $(lsb_release -ds 2>/dev/null || uname -srm)"
    echo "=========================================="
    echo ""
    echo "  [1] 启动全部服务"
    echo "  [2] 停止全部服务"
    echo "  [3] 重启全部服务"
    echo "  [4] 仅启动 Node.js WS"
    echo "  [5] 仅停止 Node.js WS"
    echo "  [6] 仅启动 frps"
    echo "  [7] 仅停止 frps"
    echo "  [8] 启动宝塔服务 (MySQL/PHP/Nginx/Redis)"
    echo "  [9] 查看服务状态"
    echo "  [0] 退出"
    echo ""
    read -p "请选择操作 (0-9): " choice
    echo ""

    case "$choice" in
        1) start_all  ; read -p "按回车返回菜单..." dummy ; show_menu ;;
        2) stop_all   ; read -p "按回车返回菜单..." dummy ; show_menu ;;
        3) restart_all; read -p "按回车返回菜单..." dummy ; show_menu ;;
        4) start_node_ws ; read -p "按回车返回菜单..." dummy ; show_menu ;;
        5) stop_node_ws  ; read -p "按回车返回菜单..." dummy ; show_menu ;;
        6) start_frps    ; read -p "按回车返回菜单..." dummy ; show_menu ;;
        7) stop_frps     ; read -p "按回车返回菜单..." dummy ; show_menu ;;
        8) start_bt_services ; read -p "按回车返回菜单..." dummy ; show_menu ;;
        9) show_status ; read -p "按回车返回菜单..." dummy ; show_menu ;;
        0) exit 0 ;;
        *) log_warn "无效选择，请重新输入"; sleep 1; show_menu ;;
    esac
}

# 命令行参数支持
if [ $# -gt 0 ]; then
    case "$1" in
        start|start-all)   start_all ;;
        stop|stop-all)     stop_all ;;
        restart)           restart_all ;;
        start-node)        start_node_ws ;;
        stop-node)         stop_node_ws ;;
        start-frps)        start_frps ;;
        stop-frps)         stop_frps ;;
        start-bt)          start_bt_services ;;
        status)            show_status ;;
        menu)              show_menu ;;
        *)
            echo "用法: $0 [命令]"
            echo ""
            echo "命令:"
            echo "  start|start-all    启动全部服务"
            echo "  stop|stop-all     停止全部服务"
            echo "  restart            重启全部服务"
            echo "  start-node         仅启动 Node.js WS"
            echo "  stop-node          仅停止 Node.js WS"
            echo "  start-frps         仅启动 frps"
            echo "  stop-frps          仅停止 frps"
            echo "  start-bt           启动宝塔服务"
            echo "  status             查看服务状态"
            echo "  menu               显示交互菜单 (默认)"
            exit 1
            ;;
    esac
else
    show_menu
fi
