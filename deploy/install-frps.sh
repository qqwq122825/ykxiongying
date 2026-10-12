#!/usr/bin/env bash
# 星辰项目 frps 离线安装器。从项目内置包安装，不依赖 GitHub 下载。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
ENV_FILE="${PROJECT_ROOT}/.env"
INSTALL_DIR="${PROJECT_ROOT}/frps"
CONFIG_DIR="${PROJECT_ROOT}/frps"
DRY_RUN=0

usage() {
    cat <<'EOF'
用法: bash deploy/install-frps.sh [选项]
  --env FILE          指定共享 .env（默认：项目根目录/.env）
  --prefix DIR        frps 安装目录（默认：项目根目录/frps）
  --config-dir DIR    配置目录（默认：与 frps 安装目录相同）
  --dry-run           只检查配置、架构和内置包
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --env) ENV_FILE="$2"; shift 2 ;;
        --prefix) INSTALL_DIR="$2"; CONFIG_DIR="$2"; shift 2 ;;
        --config-dir) CONFIG_DIR="$2"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "[ERROR] 未知参数: $1" >&2; usage >&2; exit 2 ;;
    esac
done

log() { printf '[frps] %s\n' "$*"; }
die() { printf '[frps][ERROR] %s\n' "$*" >&2; exit 1; }

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

is_port() {
    case "$1" in *[!0-9]*|'') return 1 ;; esac
    [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

is_safe_scalar() {
    printf '%s' "$1" | grep -Eq '^[][[:alnum:]_.:@-]+$'
}

sha256_file() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        die "缺少 sha256sum/shasum，不会在无法校验时安装二进制"
    fi
}

[ -f "${ENV_FILE}" ] || die "找不到共享配置: ${ENV_FILE}；请先访问 /install/ 完成网页配置"

case "$(uname -m)" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) die "当前 CPU 架构尚未内置: $(uname -m)" ;;
esac

BUNDLE="${SCRIPT_DIR}/frp/frps_0.61.1_linux_${ARCH}.gz"
CHECKSUMS="${SCRIPT_DIR}/frp/SHA256SUMS"
[ -f "${BUNDLE}" ] || die "缺少内置 frps: ${BUNDLE}"
[ -f "${CHECKSUMS}" ] || die "缺少校验文件: ${CHECKSUMS}"
EXPECTED_SHA="$(awk -v f="$(basename "${BUNDLE}")" '$2 == f {print $1; exit}' "${CHECKSUMS}")"
[ -n "${EXPECTED_SHA}" ] || die "SHA256SUMS 中没有 $(basename "${BUNDLE}")"
ACTUAL_SHA="$(sha256_file "${BUNDLE}")"
[ "${ACTUAL_SHA}" = "${EXPECTED_SHA}" ] || die "frps 内置包 SHA256 不匹配"

FRPS_ADDR="$(read_env_value FRPS_ADDR)"
FRPS_PORT="$(read_env_value FRPS_PORT)"; FRPS_PORT="${FRPS_PORT:-7000}"
FRPS_TOKEN="$(read_env_value FRPS_TOKEN)"
DASH_HOST="$(read_env_value FRPS_DASHBOARD_HOST)"; DASH_HOST="${DASH_HOST:-127.0.0.1}"
DASH_PORT="$(read_env_value FRPS_DASHBOARD_PORT)"; DASH_PORT="${DASH_PORT:-7500}"
DASH_USER="$(read_env_value FRPS_DASHBOARD_USER)"; DASH_USER="${DASH_USER:-admin}"
DASH_PASSWORD="$(read_env_value FRPS_DASHBOARD_PASSWORD)"
PORT_MIN="$(read_env_value FRPS_REMOTE_PORT_MIN)"; PORT_MIN="${PORT_MIN:-19902}"
PORT_MAX="$(read_env_value FRPS_REMOTE_PORT_MAX)"; PORT_MAX="${PORT_MAX:-29999}"

[ -n "${FRPS_ADDR}" ] || die ".env 缺少 FRPS_ADDR"
[ -n "${FRPS_TOKEN}" ] || die ".env 缺少 FRPS_TOKEN"
[ "${#FRPS_TOKEN}" -ge 32 ] || die "FRPS_TOKEN 至少 32 个字符"
[ -n "${DASH_PASSWORD}" ] || die ".env 缺少 FRPS_DASHBOARD_PASSWORD"
is_safe_scalar "${FRPS_ADDR}" || die "FRPS_ADDR 包含不允许的字符"
is_safe_scalar "${FRPS_TOKEN}" || die "FRPS_TOKEN 包含不允许的字符"
is_safe_scalar "${DASH_HOST}" || die "FRPS_DASHBOARD_HOST 包含不允许的字符"
is_safe_scalar "${DASH_USER}" || die "FRPS_DASHBOARD_USER 包含不允许的字符"
is_safe_scalar "${DASH_PASSWORD}" || die "FRPS_DASHBOARD_PASSWORD 包含不允许的字符"
is_port "${FRPS_PORT}" || die "FRPS_PORT 无效: ${FRPS_PORT}"
is_port "${DASH_PORT}" || die "FRPS_DASHBOARD_PORT 无效: ${DASH_PORT}"
is_port "${PORT_MIN}" || die "FRPS_REMOTE_PORT_MIN 无效: ${PORT_MIN}"
is_port "${PORT_MAX}" || die "FRPS_REMOTE_PORT_MAX 无效: ${PORT_MAX}"
[ "${PORT_MIN}" -le "${PORT_MAX}" ] || die "隐道端口范围顺序错误"

log "内置版本=0.61.1 架构=${ARCH} SHA256=${ACTUAL_SHA}"
log "配置来源=${ENV_FILE} FRPS_ADDR=${FRPS_ADDR} bind_port=${FRPS_PORT} allow_ports=${PORT_MIN}-${PORT_MAX}"

if [ "${DRY_RUN}" -eq 1 ]; then
    log "DRY_RUN_OK"
    exit 0
fi

mkdir -p "${INSTALL_DIR}" "${CONFIG_DIR}" "${INSTALL_DIR}/log"
TMP_BIN="${INSTALL_DIR}/.frps.new.$$"
gzip -dc "${BUNDLE}" > "${TMP_BIN}"
chmod 0755 "${TMP_BIN}"
mv -f "${TMP_BIN}" "${INSTALL_DIR}/frps"

TMP_CONFIG="${CONFIG_DIR}/.frps.ini.new.$$"
cat > "${TMP_CONFIG}" <<EOF
[common]
bind_port = ${FRPS_PORT}
vhost_http_port = 7400
vhost_https_port = 7401
authentication_method = token
token = ${FRPS_TOKEN}
allow_ports = ${PORT_MIN}-${PORT_MAX}
max_ports_per_client = 8
max_pool_count = 50
dashboard_addr = ${DASH_HOST}
dashboard_port = ${DASH_PORT}
dashboard_user = ${DASH_USER}
dashboard_pwd = ${DASH_PASSWORD}
log_file = ${INSTALL_DIR}/log/frps.log
log_level = info
log_max_days = 7
disable_log_color = true
EOF
chmod 0600 "${TMP_CONFIG}"
mv -f "${TMP_CONFIG}" "${CONFIG_DIR}/frps.ini"

cat > "${INSTALL_DIR}/package.json" <<'EOF'
{
  "name": "xingchen-frps",
  "private": true,
  "version": "0.61.1",
  "scripts": {
    "start": "./frps -c ./frps.ini"
  }
}
EOF
chmod 0644 "${INSTALL_DIR}/package.json"

# 宝塔 Node 项目默认使用 www 账号：只给它读配置和写日志的权限。
if [ "$(id -u)" -eq 0 ] && getent group www >/dev/null 2>&1; then
    chown root:www "${INSTALL_DIR}/frps" "${CONFIG_DIR}/frps.ini" "${INSTALL_DIR}/package.json"
    chown -R www:www "${INSTALL_DIR}/log"
    chmod 0640 "${CONFIG_DIR}/frps.ini"
    chmod 0750 "${INSTALL_DIR}/log"
else
    chmod 0750 "${INSTALL_DIR}/log"
fi

if [ "$(id -u)" -eq 0 ]; then
    if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
        ufw allow "${FRPS_PORT}/tcp" >/dev/null
        ufw allow "${PORT_MIN}:${PORT_MAX}/tcp" >/dev/null
        log "UFW 已放行 ${FRPS_PORT}/tcp 和 ${PORT_MIN}:${PORT_MAX}/tcp"
    elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
        firewall-cmd --permanent --add-port="${FRPS_PORT}/tcp" >/dev/null
        firewall-cmd --permanent --add-port="${PORT_MIN}-${PORT_MAX}/tcp" >/dev/null
        firewall-cmd --reload >/dev/null
        log "firewalld 已放行 ${FRPS_PORT}/tcp 和 ${PORT_MIN}-${PORT_MAX}/tcp"
    else
        log "未检测到活动的 UFW/firewalld；请在云安全组放行 ${FRPS_PORT}/tcp 和 ${PORT_MIN}-${PORT_MAX}/tcp"
    fi
fi

log "安装完成: ${INSTALL_DIR}/frps"
log "配置完成: ${CONFIG_DIR}/frps.ini"
log "宝塔 Node 项目目录: ${INSTALL_DIR}"
log "启动选项: start（实际命令 ./frps -c ./frps.ini）"
log "云服务器安全组必须放行: ${FRPS_PORT}/tcp, ${PORT_MIN}-${PORT_MAX}/tcp"
