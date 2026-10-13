#!/usr/bin/env bash
# 验证一键安装生成的共享配置、FRPS 配置与（可选）实时服务状态。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
ENV_FILE="${PROJECT_ROOT}/.env"
REQUIRE_LIVE=0

usage() {
    cat <<'EOF'
用法: bash deploy/verify-install.sh [选项]
  --root DIR       项目根目录
  --env FILE       共享 .env 路径
  --static-only    只检查文件和配置（默认）
  --require-live   同时要求 FRPS、Node WS 和 Dashboard 已运行
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --root) PROJECT_ROOT="$2"; shift 2 ;;
        --env) ENV_FILE="$2"; shift 2 ;;
        --static-only) REQUIRE_LIVE=0; shift ;;
        --require-live) REQUIRE_LIVE=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "[verify][ERROR] 未知参数: $1" >&2; usage >&2; exit 2 ;;
    esac
done

log() { printf '[verify] %s\n' "$*"; }
die() { printf '[verify][ERROR] %s\n' "$*" >&2; exit 1; }

read_env_value() {
    local key="$1"
    awk -F= -v wanted="${key}" '
        /^[[:space:]]*#/ || /^[[:space:]]*$/ || /^[[:space:]]*\[/ { next }
        {
            k=$1; gsub(/^[[:space:]]+|[[:space:]]+$/, "", k)
            if (k == wanted) {
                v=substr($0, index($0, "=")+1)
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
                gsub(/^[\047\042]|[\047\042]$/, "", v)
                print v
                exit
            }
        }
    ' "${ENV_FILE}"
}

ini_value() {
    local key="$1" file="$2"
    awk -F= -v wanted="${key}" '
        /^[[:space:]]*[#;]/ || /^[[:space:]]*$/ || /^[[:space:]]*\[/ { next }
        {
            k=$1; gsub(/^[[:space:]]+|[[:space:]]+$/, "", k)
            if (k == wanted) {
                v=substr($0, index($0, "=")+1)
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
                print v
                exit
            }
        }
    ' "${file}"
}

port_listening() {
    local port="$1"
    if command -v ss >/dev/null 2>&1; then
        ss -lnt 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:|\\])${port}$"
    else
        netstat -lnt 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:|\\])${port}$"
    fi
}

wait_for_port() {
    local port="$1" label="$2" i
    for i in $(seq 1 20); do
        if port_listening "${port}"; then
            log "${label} 端口 ${port} 已监听"
            return 0
        fi
        sleep 1
    done
    die "${label} 端口 ${port} 未监听"
}

[ -f "${ENV_FILE}" ] || die "找不到共享配置 ${ENV_FILE}"
[ -f "${PROJECT_ROOT}/app/controller/TunnelController.php" ] || die "缺少 TunnelController.php"
[ -x "${PROJECT_ROOT}/deploy/install-frps.sh" ] || die "install-frps.sh 不可执行"
[ -x "${PROJECT_ROOT}/frps/frps" ] || die "frps 二进制未安装"
[ -f "${PROJECT_ROOT}/frps/frps.ini" ] || die "frps.ini 未生成"

if [ -L "${PROJECT_ROOT}/node-ws/.env" ]; then
    [ "$(readlink "${PROJECT_ROOT}/node-ws/.env")" = "../.env" ] || die "node-ws/.env 链接目标错误"
else
    cmp -s "${ENV_FILE}" "${PROJECT_ROOT}/node-ws/.env" || die "node-ws/.env 与根 .env 不一致"
fi

FRPS_ADDR="$(read_env_value FRPS_ADDR)"
FRPS_PORT="$(read_env_value FRPS_PORT)"; FRPS_PORT="${FRPS_PORT:-7000}"
FRPS_TOKEN="$(read_env_value FRPS_TOKEN)"
DASH_HOST="$(read_env_value FRPS_DASHBOARD_HOST)"; DASH_HOST="${DASH_HOST:-127.0.0.1}"
DASH_PORT="$(read_env_value FRPS_DASHBOARD_PORT)"; DASH_PORT="${DASH_PORT:-7500}"
DASH_USER="$(read_env_value FRPS_DASHBOARD_USER)"; DASH_USER="${DASH_USER:-admin}"
DASH_PASSWORD="$(read_env_value FRPS_DASHBOARD_PASSWORD)"
WS_PORT="$(read_env_value WS_PORT)"; WS_PORT="${WS_PORT:-8889}"

[ -n "${FRPS_ADDR}" ] || die "FRPS_ADDR 为空"
[ "${#FRPS_TOKEN}" -ge 32 ] || die "FRPS_TOKEN 缺失或过短"
[ -n "${DASH_PASSWORD}" ] || die "FRPS_DASHBOARD_PASSWORD 为空"
[ "$(ini_value token "${PROJECT_ROOT}/frps/frps.ini")" = "${FRPS_TOKEN}" ] || die "frps.ini token 与 .env 不一致"
[ "$(ini_value dashboard_pwd "${PROJECT_ROOT}/frps/frps.ini")" = "${DASH_PASSWORD}" ] || die "frps.ini Dashboard 密码与 .env 不一致"

php -l "${PROJECT_ROOT}/app/controller/TunnelController.php" >/dev/null
grep -q "FRPS_DASHBOARD_PASSWORD" "${PROJECT_ROOT}/app/controller/TunnelController.php" || die "PHP Dashboard 配置回退逻辑缺失"
bash "${PROJECT_ROOT}/deploy/install-frps.sh" --env "${ENV_FILE}" --dry-run >/dev/null
log "静态配置检查通过（服务器=${FRPS_ADDR}，FRPS=${FRPS_PORT}，Dashboard=${DASH_HOST}:${DASH_PORT}）"

if [ "${REQUIRE_LIVE}" -eq 1 ]; then
    command -v curl >/dev/null 2>&1 || die "缺少 curl"
    wait_for_port "${FRPS_PORT}" "FRPS"
    wait_for_port "${DASH_PORT}" "FRPS Dashboard"
    wait_for_port "${WS_PORT}" "Node WS"

    DASH_RESPONSE="$(curl -fsS --connect-timeout 3 --max-time 5 -u "${DASH_USER}:${DASH_PASSWORD}" "http://${DASH_HOST}:${DASH_PORT}/api/proxy/tcp")" \
        || die "FRPS Dashboard 鉴权失败"
    printf '%s' "${DASH_RESPONSE}" | php -r '
        $data = json_decode(stream_get_contents(STDIN), true);
        if (!is_array($data) || !isset($data["proxies"]) || !is_array($data["proxies"])) exit(1);
    ' || die "FRPS Dashboard 返回格式无效"
    log "FRPS Dashboard 鉴权与 JSON 返回验证通过"
fi

log "VERIFY_OK"
